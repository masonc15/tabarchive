import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import {
  Browser,
  By,
  Builder,
  until,
  type WebDriver,
  type WebElement,
} from 'selenium-webdriver';
import * as firefox from 'selenium-webdriver/firefox';
import {
  buildFirefoxDist,
  firefoxExtensionId,
  getFirefoxNativeManifestPath,
  installFirefoxNativeHost,
  nativeHostName,
  removeTempRoot,
  seedArchivedTabs,
} from './tabarchive-e2e-utils';

type FirefoxHarness = {
  driver: WebDriver;
  downloadsDir: string;
  homeDir: string;
  popupUrl: string;
  tempRoot: string;
};

const firefoxBinaryCandidates = [
  process.env.TABARCHIVE_FIREFOX_BIN,
  '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox',
  '/Applications/Firefox.app/Contents/MacOS/firefox',
  '/usr/bin/firefox-developer-edition',
  '/usr/bin/firefox',
].filter((candidate): candidate is string => Boolean(candidate));

const firefoxBinary = resolveFirefoxBinary();
const firefoxWidgetIdPrefix = firefoxExtensionId.replace(/[^a-zA-Z0-9_-]/g, '_');
const firefoxActionButtonId = `${firefoxWidgetIdPrefix}-BAP`;

let firefoxBuildRoot: string | null = null;
let firefoxDist: string | null = null;

function resolveFirefoxBinary() {
  for (const candidate of firefoxBinaryCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const whichCandidates = ['firefoxdeveloperedition', 'firefox-developer-edition', 'firefox'];
  for (const candidate of whichCandidates) {
    try {
      const resolved = execFileSync('which', [candidate], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (resolved) {
        return resolved;
      }
    } catch {
      // Ignore missing candidates and continue through fallbacks.
    }
  }

  return null;
}

function ariaLabelSelector(label: string) {
  const escaped = label.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `[aria-label="${escaped}"]`;
}

function buttonTextSelector(text: string) {
  const escaped = text.replace(/"/g, '\\"');
  return `//button[normalize-space()="${escaped}"]`;
}

async function waitForVisible(driver: WebDriver, locator: By, timeoutMs = 15_000) {
  const element = await driver.wait(until.elementLocated(locator), timeoutMs);
  await driver.wait(until.elementIsVisible(element), timeoutMs);
  return element;
}

async function withChromeContext<T>(driver: WebDriver, callback: () => Promise<T>) {
  const previousContext = await (driver as WebDriver & firefox.Driver).getContext();
  if (previousContext !== firefox.Context.CHROME) {
    await (driver as WebDriver & firefox.Driver).setContext(firefox.Context.CHROME);
  }

  try {
    return await callback();
  } finally {
    if (previousContext !== firefox.Context.CHROME) {
      await (driver as WebDriver & firefox.Driver).setContext(previousContext);
    }
  }
}

async function getBrowserActionPopupUrl(driver: WebDriver) {
  let popupUrl: string | null = null;

  return withChromeContext(driver, async () => {
    await waitForVisible(driver, By.id('unified-extensions-button'));
    await driver.findElement(By.id('unified-extensions-button')).click();
    await waitForVisible(driver, By.id(firefoxActionButtonId));
    await driver.findElement(By.id(firefoxActionButtonId)).click();

    await expect
      .poll(
        async () => {
          popupUrl = await driver.executeScript(`
            const win = Services.wm.getMostRecentWindow('navigator:browser');
            const popupBrowser = Array.from(win.document.querySelectorAll('browser[type="content"]')).find(
              (browserEl) => browserEl.currentURI?.spec?.includes('/popup/popup.html'),
            );
            return popupBrowser?.currentURI?.spec ?? null;
          `);
          return popupUrl;
        },
        { timeout: 15_000 },
      )
      .not.toBeNull();

    return popupUrl as string;
  });
}

async function sendRuntimeMessage<T = Record<string, any>>(
  driver: WebDriver,
  message: Record<string, unknown>,
) {
  return driver.executeAsyncScript(
    `
const payload = arguments[0];
const done = arguments[arguments.length - 1];

try {
  if (typeof browser !== 'undefined' && browser?.runtime?.sendMessage) {
    browser.runtime.sendMessage(payload).then(
      (response) => done(response ?? null),
      (error) => done({ ok: false, error: String(error) }),
    );
    return;
  }

  if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
    chrome.runtime.sendMessage(payload, (response) => {
      const error = chrome.runtime.lastError?.message;
      if (error) {
        done({ ok: false, error });
        return;
      }
      done(response ?? null);
    });
    return;
  }

  done({ ok: false, error: 'runtime messaging unavailable' });
} catch (error) {
  done({ ok: false, error: String(error) });
}
`,
    message,
  ) as Promise<T | null>;
}

// Marionette can open the real browser-action popup, but the panel browser is not
// exposed as a normal browsing context for deeper DOM automation. Once the real
// popup is verified and its URL is known, the same document is exercised in a tab.
async function openPopupDocument(driver: WebDriver, popupUrl: string) {
  await driver.get(popupUrl);
  await expect
    .poll(async () => {
      const response = await sendRuntimeMessage<Record<string, any>>(driver, { action: 'stats' });
      return response?.ok === true;
    }, { timeout: 15_000 })
    .toBe(true);
}

async function setSelectValue(driver: WebDriver, select: WebElement, value: string) {
  await driver.executeScript(
    `
const [element, nextValue] = arguments;
element.value = nextValue;
element.dispatchEvent(new Event('input', { bubbles: true }));
element.dispatchEvent(new Event('change', { bubbles: true }));
`,
    select,
    value,
  );
}

async function getBodyText(driver: WebDriver) {
  return (await driver.findElement(By.css('body')).getText()).replace(/\s+/g, ' ').trim();
}

async function waitForDownload(downloadsDir: string) {
  let downloadPath: string | null = null;

  await expect
    .poll(() => {
      const entries = fs.readdirSync(downloadsDir, { withFileTypes: true });
      const completedJson = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => path.join(downloadsDir, entry.name))
        .find((candidate) => {
          const partialPath = `${candidate}.part`;
          return !fs.existsSync(partialPath) && fs.statSync(candidate).size > 0;
        });
      downloadPath = completedJson ?? null;
      return downloadPath;
    }, { timeout: 15_000 })
    .not.toBeNull();

  return downloadPath as string;
}

async function createHarness() {
  if (!firefoxBinary) {
    throw new Error('Firefox binary not found');
  }
  if (!firefoxDist) {
    throw new Error('Firefox build output not prepared');
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tabarchive-firefox-e2e-'));
  const downloadsDir = path.join(tempRoot, 'downloads');
  const homeDir = path.join(tempRoot, 'home');
  fs.mkdirSync(downloadsDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });

  installFirefoxNativeHost(homeDir);

  const options = new firefox.Options()
    .setBinary(firefoxBinary)
    .addArguments('-headless')
    .addArguments('--remote-allow-system-access')
    .setPreference('browser.download.folderList', 2)
    .setPreference('browser.download.dir', downloadsDir)
    .setPreference('browser.download.useDownloadDir', true)
    .setPreference('browser.download.alwaysOpenPanel', false)
    .setPreference('browser.download.manager.showWhenStarting', false)
    .setPreference(
      'browser.helperApps.neverAsk.saveToDisk',
      'application/json,application/octet-stream,text/json,text/plain',
    )
    .setPreference('extensions.autoDisableScopes', 0)
    .setPreference('extensions.enabledScopes', 15)
    .setPreference('xpinstall.signatures.required', false);

  const service = new firefox.ServiceBuilder().setEnvironment({
    ...process.env,
    HOME: homeDir,
  });

  const driver = (await new Builder()
    .forBrowser(Browser.FIREFOX)
    .setFirefoxService(service)
    .setFirefoxOptions(options)
    .build()) as WebDriver & firefox.Driver;

  try {
    await driver.manage().setTimeouts({ pageLoad: 60_000, script: 30_000 });
    try {
      await driver.manage().window().setRect({ width: 1280, height: 900 });
    } catch {
      // Headless Firefox can reject window management on some setups.
    }

    const addonId = await driver.installAddon(firefoxDist, true);
    expect(addonId).toBe(firefoxExtensionId);

    const manifestPath = getFirefoxNativeManifestPath(homeDir);
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest.name).toBe(nativeHostName);
    expect(manifest.allowed_extensions).toContain(firefoxExtensionId);

    const popupUrl = await getBrowserActionPopupUrl(driver);

    return {
      driver,
      downloadsDir,
      homeDir,
      popupUrl,
      tempRoot,
    } satisfies FirefoxHarness;
  } catch (error) {
    try {
      await driver.quit();
    } finally {
      removeTempRoot(tempRoot);
    }
    throw error;
  }
}

async function cleanupHarness(harness: FirefoxHarness) {
  try {
    await harness.driver.quit();
  } finally {
    removeTempRoot(harness.tempRoot);
  }
}

test.describe.serial('Tab Archive extension in Firefox', () => {
  test.skip(!firefoxBinary, 'Firefox Developer Edition or Firefox was not found on this machine');

  test.beforeAll(() => {
    firefoxBuildRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tabarchive-firefox-build-'));
    firefoxDist = path.join(firefoxBuildRoot, 'dist');
    fs.mkdirSync(firefoxDist, { recursive: true });
    buildFirefoxDist(firefoxDist);
  });

  test.afterAll(() => {
    if (firefoxBuildRoot) {
      removeTempRoot(firefoxBuildRoot);
    }
    firefoxBuildRoot = null;
    firefoxDist = null;
  });

  test('search and restore flow in popup document', async () => {
    const harness = await createHarness();

    try {
      seedArchivedTabs(harness.homeDir, [
        { url: 'https://example.com', title: 'Example', closedAt: Date.now() - 10_000 },
        { url: 'https://another.com', title: 'Another', closedAt: Date.now() - 20_000 },
      ]);

      await openPopupDocument(harness.driver, harness.popupUrl);

      await waitForVisible(harness.driver, By.css(ariaLabelSelector('Restore tab: Example')));
      await waitForVisible(harness.driver, By.css(ariaLabelSelector('Restore tab: Another')));

      const searchInput = await waitForVisible(
        harness.driver,
        By.css('input[placeholder="Search archived tabs..."]'),
      );
      await searchInput.clear();
      await searchInput.sendKeys('Example');

      await waitForVisible(harness.driver, By.css(ariaLabelSelector('Restore tab: Example')));
      await expect
        .poll(
          async () =>
            (
              await harness.driver.findElements(By.css(ariaLabelSelector('Restore tab: Another')))
            ).length,
          { timeout: 15_000 },
        )
        .toBe(0);

      const popupHandle = await harness.driver.getWindowHandle();
      await harness.driver.findElement(By.css(ariaLabelSelector('Restore tab: Example'))).click();

      await expect
        .poll(async () => (await harness.driver.getAllWindowHandles()).length, { timeout: 15_000 })
        .toBe(2);

      const restoredHandle = (await harness.driver.getAllWindowHandles()).find(
        (handle) => handle !== popupHandle,
      );
      expect(restoredHandle).toBeTruthy();

      await harness.driver.switchTo().window(restoredHandle as string);
      await harness.driver.wait(until.urlIs('https://example.com/'), 15_000);
      expect(await harness.driver.getCurrentUrl()).toBe('https://example.com/');

      await harness.driver.close();
      await harness.driver.switchTo().window(popupHandle);

      await expect
        .poll(
          async () =>
            (
              await harness.driver.findElements(By.css(ariaLabelSelector('Restore tab: Example')))
            ).length,
          { timeout: 15_000 },
        )
        .toBe(0);

      const stats = await sendRuntimeMessage<Record<string, any>>(harness.driver, {
        action: 'stats',
      });
      expect(stats?.ok).toBe(true);
      expect(stats?.totalArchived).toBe(1);
      expect(stats?.totalRestored).toBe(1);
    } finally {
      await cleanupHarness(harness);
    }
  });

  test('settings export and clear flow in popup document', async () => {
    const harness = await createHarness();

    try {
      seedArchivedTabs(harness.homeDir, [
        { url: 'https://one.example', title: 'One', closedAt: Date.now() - 15_000 },
        { url: 'https://two.example', title: 'Two', closedAt: Date.now() - 30_000 },
      ]);

      await openPopupDocument(harness.driver, harness.popupUrl);

      await harness.driver.findElement(By.css(ariaLabelSelector('Pause archiving'))).click();
      await waitForVisible(harness.driver, By.css(ariaLabelSelector('Resume archiving')));

      await harness.driver.findElement(By.xpath(buttonTextSelector('Settings'))).click();

      const archiveAfter = await waitForVisible(
        harness.driver,
        By.css('select[aria-label="Archive after"]'),
      );
      await setSelectValue(harness.driver, archiveAfter, '1440');

      await expect
        .poll(async () => {
          const settingsResponse = await sendRuntimeMessage<Record<string, any>>(harness.driver, {
            action: 'getSettings',
          });
          return settingsResponse?.settings?.archiveAfterMinutes;
        }, { timeout: 15_000 })
        .toBe(1440);

      const settingsResponse = await sendRuntimeMessage<Record<string, any>>(harness.driver, {
        action: 'getSettings',
      });
      expect(settingsResponse?.ok).toBe(true);
      expect(settingsResponse?.settings?.archiveAfterMinutes).toBe(1440);
      expect(settingsResponse?.settings?.paused).toBe(true);

      await harness.driver.findElement(By.css(ariaLabelSelector('Export archive data'))).click();

      const downloadPath = await waitForDownload(harness.downloadsDir);
      const downloadPayload = JSON.parse(fs.readFileSync(downloadPath, 'utf8'));
      expect(downloadPayload.count).toBe(2);
      expect(Array.isArray(downloadPayload.tabs)).toBe(true);

      await expect.poll(() => getBodyText(harness.driver), { timeout: 15_000 }).toContain(
        'Exported 2 tabs.',
      );

      const exportResponse = await sendRuntimeMessage<Record<string, any>>(harness.driver, {
        action: 'export',
        includeRestored: true,
        chunkSize: 2000,
        offset: 0,
      });
      expect(exportResponse?.ok).toBe(true);
      expect(exportResponse?.count).toBe(2);
      expect(Array.isArray(exportResponse?.tabs)).toBe(true);

      await harness.driver.findElement(By.css(ariaLabelSelector('Clear archived tabs'))).click();
      const alert = await harness.driver.wait(until.alertIsPresent(), 5_000);
      await alert.accept();

      await expect.poll(() => getBodyText(harness.driver), { timeout: 15_000 }).toContain(
        'Deleted 2 archived tabs.',
      );

      const statsResponse = await sendRuntimeMessage<Record<string, any>>(harness.driver, {
        action: 'stats',
      });
      expect(statsResponse?.ok).toBe(true);
      expect(statsResponse?.totalArchived).toBe(0);
    } finally {
      await cleanupHarness(harness);
    }
  });
});

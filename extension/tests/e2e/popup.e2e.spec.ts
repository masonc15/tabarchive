import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type BrowserContext, chromium, expect, type Page, test } from '@playwright/test';
import {
  nativeHostName,
  nativeHostPath,
  removeTempRoot,
  seedArchivedTabs,
  type SeedTab,
} from './tabarchive-e2e-utils';

declare const chrome: any;

const extensionPath = path.resolve(__dirname, '../../dist');

type Harness = {
  context: BrowserContext;
  extensionId: string;
  homeDir: string;
  tempRoot: string;
};

async function launchExtensionContext(
  userDataDir: string,
  homeDir: string,
  knownExtensionId?: string,
): Promise<{ context: BrowserContext; extensionId: string }> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    env: {
      ...process.env,
      HOME: homeDir,
    },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  if (knownExtensionId) {
    return { context, extensionId: knownExtensionId };
  }

  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker');
  }
  const extensionId = new URL(serviceWorker.url()).host;
  return { context, extensionId };
}

function writeChromiumNativeHostManifest(userDataDir: string, extensionId: string): string {
  const manifestDir = path.join(userDataDir, 'NativeMessagingHosts');
  const manifestPath = path.join(manifestDir, `${nativeHostName}.json`);
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.chmodSync(nativeHostPath, 0o755);

  const manifest = {
    name: nativeHostName,
    description: 'Tab Archive native messaging host for SQLite-backed tab storage',
    path: nativeHostPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifestPath;
}

async function createHarness(): Promise<Harness> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tabarchive-e2e-'));
  const userDataDir = path.join(tempRoot, 'chromium-profile');
  const homeDir = path.join(tempRoot, 'home');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });

  const firstLaunch = await launchExtensionContext(userDataDir, homeDir);
  const extensionId = firstLaunch.extensionId;
  await firstLaunch.context.close();

  writeChromiumNativeHostManifest(userDataDir, extensionId);

  const secondLaunch = await launchExtensionContext(userDataDir, homeDir, extensionId);

  return {
    context: secondLaunch.context,
    extensionId,
    homeDir,
    tempRoot,
  };
}

async function cleanupHarness(harness: Harness) {
  await harness.context.close();
  removeTempRoot(harness.tempRoot);
}

async function sendRuntimeMessage<T = any>(
  page: Page,
  message: Record<string, unknown>,
): Promise<T | null> {
  return page.evaluate((payload) => {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (response: unknown) => {
          const error = chrome.runtime.lastError?.message;
          if (error) {
            resolve({ ok: false, error });
            return;
          }
          resolve(response ?? null);
        });
      } catch (error) {
        resolve({ ok: false, error: String(error) });
      }
    });
  }, message) as Promise<T | null>;
}

async function openPopupPage(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await expect
    .poll(
      async () => {
        const response = await sendRuntimeMessage<Record<string, any>>(page, { action: 'stats' });
        return response?.ok === true;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return page;
}

test.describe('Tab Archive extension (real native host)', () => {
  test('search and restore flow', async () => {
    const harness = await createHarness();
    try {
      seedArchivedTabs(harness.homeDir, [
        { url: 'https://example.com', title: 'Example', closedAt: Date.now() - 10_000 },
        { url: 'https://another.com', title: 'Another', closedAt: Date.now() - 20_000 },
      ]);

      const page = await openPopupPage(harness.context, harness.extensionId);

      await expect(page.getByRole('button', { name: 'Restore tab: Example' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Restore tab: Another' })).toBeVisible();

      const searchInput = page.getByPlaceholder('Search archived tabs...');
      await searchInput.fill('Example');
      await expect(page.getByRole('button', { name: 'Restore tab: Example' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Restore tab: Another' })).toHaveCount(0);

      const restoredPagePromise = harness.context.waitForEvent('page');
      await page.getByRole('button', { name: 'Restore tab: Example' }).click();
      const restoredPage = await restoredPagePromise;
      await restoredPage.waitForLoadState('domcontentloaded');
      expect(restoredPage.url()).toBe('https://example.com/');
      await restoredPage.close();
      await expect(page.getByRole('button', { name: 'Restore tab: Example' })).toHaveCount(0);

      const stats = await sendRuntimeMessage<Record<string, any>>(page, { action: 'stats' });
      expect(stats?.ok).toBe(true);
      expect(stats?.totalArchived).toBe(1);
      expect(stats?.totalRestored).toBe(1);
    } finally {
      await cleanupHarness(harness);
    }
  });

  test('settings export and clear flow', async () => {
    const harness = await createHarness();
    try {
      seedArchivedTabs(harness.homeDir, [
        { url: 'https://one.example', title: 'One', closedAt: Date.now() - 15_000 },
        { url: 'https://two.example', title: 'Two', closedAt: Date.now() - 30_000 },
      ]);

      const page = await openPopupPage(harness.context, harness.extensionId);
      await page.getByRole('button', { name: 'Pause archiving' }).click();
      await expect(page.getByRole('button', { name: 'Resume archiving' })).toBeVisible();
      await page.getByRole('button', { name: 'Settings' }).click();

      await page.getByLabel('Archive after').selectOption('1440');
      await expect(page.getByRole('switch', { name: 'Pause archiving' })).toHaveCount(0);

      const settingsResponse = await sendRuntimeMessage<Record<string, any>>(page, {
        action: 'getSettings',
      });
      expect(settingsResponse?.ok).toBe(true);
      expect(settingsResponse?.settings?.archiveAfterMinutes).toBe(1440);
      expect(settingsResponse?.settings?.paused).toBe(true);

      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export archive data' }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/^tabarchive-export-.*\.json$/);
      await download.path();
      await expect(page.getByText(/Exported .* tabs\./)).toBeVisible();
      const exportResponse = await sendRuntimeMessage<Record<string, any>>(page, {
        action: 'export',
        includeRestored: true,
        chunkSize: 2000,
        offset: 0,
      });
      expect(exportResponse?.ok).toBe(true);
      expect(exportResponse?.count).toBe(2);
      expect(Array.isArray(exportResponse?.tabs)).toBe(true);

      page.once('dialog', (dialog) => {
        void dialog.accept();
      });
      await page.getByRole('button', { name: 'Clear archived tabs' }).click();
      await expect(page.getByText(/Deleted .* archived tabs\./)).toBeVisible();

      const statsResponse = await sendRuntimeMessage<Record<string, any>>(page, {
        action: 'stats',
      });
      expect(statsResponse?.ok).toBe(true);
      expect(statsResponse?.totalArchived).toBe(0);
    } finally {
      await cleanupHarness(harness);
    }
  });
});

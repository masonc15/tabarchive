import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';

declare const chrome: any;

const extensionPath = path.resolve(__dirname, '../../dist');

async function launchExtension(): Promise<{ context: BrowserContext; extensionId: string }> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabarchive-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker');
  }
  const extensionId = new URL(serviceWorker.url()).host;
  return { context, extensionId };
}

test.describe('Tab Archive extension', () => {
  test('search and restore flow', async () => {
    const { context, extensionId } = await launchExtension();
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await page.evaluate(async () => {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            action: '__testSeed',
            tabs: [
              { id: 1, url: 'https://example.com', title: 'Example', closedAt: Date.now() - 10000, faviconUrl: '' },
              { id: 2, url: 'https://another.com', title: 'Another', closedAt: Date.now() - 20000, faviconUrl: '' },
            ],
          },
          () => resolve(true),
        );
      });
    });

    await page.reload();

    await expect(page.getByRole('button', { name: 'Restore tab: Example' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restore tab: Another' })).toBeVisible();

    const searchInput = page.getByPlaceholder('Search archived tabs...');
    await searchInput.fill('Example');
    await page.waitForTimeout(250);

    await expect(page.getByRole('button', { name: 'Restore tab: Example' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restore tab: Another' })).toHaveCount(0);

    await searchInput.fill('');
    await page.waitForTimeout(250);

    const restoreButtons = page.getByRole('button', { name: 'Restore tab' });
    await restoreButtons.first().click();

    await expect(page.getByRole('button', { name: 'Restore tab: Example' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Restore tab: Another' })).toBeVisible();

    await context.close();
  });

  test('settings update flow', async () => {
    const { context, extensionId } = await launchExtension();
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await page.evaluate(async () => {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: '__testSeed', tabs: [] }, () => resolve(true));
      });
    });

    await page.reload();

    await page.getByRole('button', { name: 'Settings' }).click();

    const archiveAfterSelect = page.getByLabel('Archive after');
    await archiveAfterSelect.selectOption('1440');

    await expect(archiveAfterSelect).toHaveValue('1440');

    const pauseToggle = page.getByRole('switch');
    await pauseToggle.click();

    await expect(pauseToggle).toHaveAttribute('aria-checked', 'true');

    await context.close();
  });
});

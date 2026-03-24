import path from 'node:path';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: path.join(__dirname, 'tests', 'e2e'),
  timeout: 60_000,
  globalSetup: path.join(__dirname, 'tests', 'e2e', 'global-setup.ts'),
  workers: 1,
  use: {
    headless: false,
  },
});

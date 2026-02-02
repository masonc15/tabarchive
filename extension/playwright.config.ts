import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: path.join(__dirname, 'tests', 'e2e'),
  timeout: 60_000,
  globalSetup: path.join(__dirname, 'tests', 'e2e', 'global-setup.ts'),
  use: {
    headless: false,
  },
});

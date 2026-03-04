import '@testing-library/jest-dom';
import { vi } from 'vitest';

const browserMock = {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn() },
    connectNative: vi.fn(),
    lastError: null as null | { message?: string },
    getManifest: vi.fn(() => ({ name: 'Tab Archive' })),
  },
  tabs: {
    create: vi.fn(),
    query: vi.fn(),
    remove: vi.fn(),
    onActivated: { addListener: vi.fn() },
    onUpdated: { addListener: vi.fn() },
    onRemoved: { addListener: vi.fn() },
  },
  action: {
    setBadgeText: vi.fn(async () => {}),
    setBadgeBackgroundColor: vi.fn(async () => {}),
  },
  storage: {
    local: {
      get: vi.fn(async (_keys?: string | string[] | Record<string, unknown> | null) => ({})),
      set: vi.fn(async () => {}),
    },
    sync: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => {}),
    },
    onChanged: { addListener: vi.fn() },
  },
};

(globalThis as any).__TABARCHIVE_TEST__ = true;
(globalThis as any).browser = browserMock;
(globalThis as any).__browserMock__ = browserMock;

vi.mock('webextension-polyfill', () => ({
  default: browserMock,
}));

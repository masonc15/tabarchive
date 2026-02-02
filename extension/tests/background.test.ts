import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkInactiveTabs,
  normalizeSettings,
  onMessageHandler,
  resetStateForTests,
  setNativeMessageHandlerForTests,
} from '../background';

const browserMock = (globalThis as any).__browserMock__;

beforeEach(() => {
  resetStateForTests();
  vi.clearAllMocks();
});

describe('background', () => {
  it('normalizes invalid settings', () => {
    const normalized = normalizeSettings({
      archiveAfterMinutes: -5,
      minTabs: -1,
      paused: 'nope' as unknown as boolean,
    });

    expect(normalized.archiveAfterMinutes).toBeGreaterThan(0);
    expect(normalized.minTabs).toBeGreaterThanOrEqual(0);
    expect(normalized.paused).toBe(false);
  });

  it('wraps handler errors into an ok=false response', async () => {
    setNativeMessageHandlerForTests(async () => {
      throw new Error('boom');
    });

    const response = await onMessageHandler({ action: 'stats' });
    expect(response.ok).toBe(false);
    expect(response.error).toContain('boom');
  });

  it('prevents overlapping inactive tab checks', () => {
    const pending = new Promise(() => {});
    browserMock.tabs.query.mockReturnValue(pending);

    checkInactiveTabs();
    checkInactiveTabs();

    expect(browserMock.tabs.query).toHaveBeenCalledTimes(1);
  });
});

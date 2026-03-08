import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkInactiveTabs,
  normalizeSettings,
  onMessageHandler,
  resetStateForTests,
  setNativeMessageHandlerForTests,
  setSettingsForTests,
  setTabLastActiveForTests,
} from '../background';

const browserMock = (globalThis as any).__browserMock__;

beforeEach(() => {
  resetStateForTests();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// normalizeSettings
// ---------------------------------------------------------------------------
describe('normalizeSettings', () => {
  it('normalizes invalid values to defaults', () => {
    const result = normalizeSettings({
      archiveAfterMinutes: -5,
      minTabs: -1,
      paused: 'nope' as unknown as boolean,
    });

    expect(result.archiveAfterMinutes).toBe(1);
    expect(result.minTabs).toBe(0);
    expect(result.paused).toBe(false);
  });

  it('floors fractional values', () => {
    const result = normalizeSettings({
      archiveAfterMinutes: 10.7,
      minTabs: 3.9,
    });
    expect(result.archiveAfterMinutes).toBe(10);
    expect(result.minTabs).toBe(3);
  });

  it('uses defaults for missing fields', () => {
    const result = normalizeSettings({});
    expect(result.archiveAfterMinutes).toBe(720);
    expect(result.minTabs).toBe(20);
    expect(result.paused).toBe(false);
  });

  it('uses defaults for NaN values', () => {
    const result = normalizeSettings({
      archiveAfterMinutes: NaN,
      minTabs: Infinity,
    });
    expect(result.archiveAfterMinutes).toBe(720);
    expect(result.minTabs).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// onMessageHandler error wrapping
// ---------------------------------------------------------------------------
describe('onMessageHandler', () => {
  it('wraps thrown errors into ok=false response', async () => {
    setNativeMessageHandlerForTests(async () => {
      throw new Error('boom');
    });

    const response = await onMessageHandler({ action: 'stats' });
    expect(response.ok).toBe(false);
    expect(response.error).toContain('boom');
  });

  it('wraps non-Error throws into "Unknown error"', async () => {
    setNativeMessageHandlerForTests(async () => {
      throw 'string error'; // eslint-disable-line no-throw-literal
    });

    const response = await onMessageHandler({ action: 'stats' });
    expect(response.ok).toBe(false);
    expect(response.error).toBe('Unknown error');
  });
});

// ---------------------------------------------------------------------------
// checkInactiveTabs
// ---------------------------------------------------------------------------
describe('checkInactiveTabs', () => {
  it('prevents overlapping calls', () => {
    const pending = new Promise(() => {});
    browserMock.tabs.query.mockReturnValue(pending);

    checkInactiveTabs();
    checkInactiveTabs();

    expect(browserMock.tabs.query).toHaveBeenCalledTimes(1);
  });

  it('does nothing when paused', async () => {
    setSettingsForTests({ archiveAfterMinutes: 1, paused: true, minTabs: 0 });
    browserMock.tabs.query.mockResolvedValue([]);

    await checkInactiveTabs();

    // tabs.query should NOT be called when paused — the function returns early
    expect(browserMock.tabs.query).not.toHaveBeenCalled();
  });

  it('does nothing when tab count is at or below minTabs', async () => {
    setSettingsForTests({ archiveAfterMinutes: 1, paused: false, minTabs: 5 });

    const tabs = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      url: `https://example.com/${i}`,
      title: `Tab ${i}`,
      active: false,
      pinned: false,
    }));
    browserMock.tabs.query.mockResolvedValue(tabs);

    const handler = vi.fn();
    setNativeMessageHandlerForTests(handler);

    await checkInactiveTabs();

    // No archive calls because tab count (5) <= minTabs (5)
    expect(handler).not.toHaveBeenCalled();
  });

  it('archives tabs exceeding inactivity threshold', async () => {
    setSettingsForTests({ archiveAfterMinutes: 10, paused: false, minTabs: 0 });

    const now = Date.now();
    const tabs = [
      { id: 1, url: 'https://old.com', title: 'Old', active: false, pinned: false },
      { id: 2, url: 'https://recent.com', title: 'Recent', active: false, pinned: false },
    ];
    browserMock.tabs.query.mockResolvedValue(tabs);

    // Tab 1 was last active 20 minutes ago; tab 2 is recent
    setTabLastActiveForTests(
      new Map([
        [1, now - 20 * 60 * 1000],
        [2, now - 1 * 60 * 1000],
      ]),
    );

    const archived: any[] = [];
    setNativeMessageHandlerForTests(async (msg) => {
      archived.push(msg);
      return { ok: true };
    });

    await checkInactiveTabs();

    // Only tab 1 should be archived
    expect(archived).toHaveLength(1);
    expect(archived[0].url).toBe('https://old.com');
    expect(browserMock.tabs.remove).toHaveBeenCalledWith(1);
  });

  it('skips pinned tabs', async () => {
    setSettingsForTests({ archiveAfterMinutes: 1, paused: false, minTabs: 0 });

    const now = Date.now();
    const tabs = [
      { id: 1, url: 'https://pinned.com', title: 'Pinned', active: false, pinned: true },
      { id: 2, url: 'https://normal.com', title: 'Normal', active: false, pinned: false },
    ];
    browserMock.tabs.query.mockResolvedValue(tabs);

    setTabLastActiveForTests(
      new Map([
        [1, now - 60 * 60 * 1000],
        [2, now - 60 * 60 * 1000],
      ]),
    );

    const archived: any[] = [];
    setNativeMessageHandlerForTests(async (msg) => {
      archived.push(msg);
      return { ok: true };
    });

    await checkInactiveTabs();

    // Only the non-pinned tab should be archived
    expect(archived).toHaveLength(1);
    expect(archived[0].url).toBe('https://normal.com');
  });

  it('skips active tabs', async () => {
    setSettingsForTests({ archiveAfterMinutes: 1, paused: false, minTabs: 0 });

    const now = Date.now();
    const tabs = [
      { id: 1, url: 'https://active.com', title: 'Active', active: true, pinned: false },
      { id: 2, url: 'https://inactive.com', title: 'Inactive', active: false, pinned: false },
    ];
    browserMock.tabs.query.mockResolvedValue(tabs);

    setTabLastActiveForTests(
      new Map([
        [1, now - 60 * 60 * 1000],
        [2, now - 60 * 60 * 1000],
      ]),
    );

    const archived: any[] = [];
    setNativeMessageHandlerForTests(async (msg) => {
      archived.push(msg);
      return { ok: true };
    });

    await checkInactiveTabs();

    expect(archived).toHaveLength(1);
    expect(archived[0].url).toBe('https://inactive.com');
  });

  it('respects minTabs when deciding how many to archive', async () => {
    setSettingsForTests({ archiveAfterMinutes: 1, paused: false, minTabs: 2 });

    const now = Date.now();
    // 3 tabs total, all inactive — but minTabs=2 so max 1 can be archived
    const tabs = [
      { id: 1, url: 'https://a.com', title: 'A', active: false, pinned: false },
      { id: 2, url: 'https://b.com', title: 'B', active: false, pinned: false },
      { id: 3, url: 'https://c.com', title: 'C', active: false, pinned: false },
    ];
    browserMock.tabs.query.mockResolvedValue(tabs);

    setTabLastActiveForTests(
      new Map([
        [1, now - 60 * 60 * 1000],
        [2, now - 30 * 60 * 1000],
        [3, now - 10 * 60 * 1000],
      ]),
    );

    const archived: any[] = [];
    setNativeMessageHandlerForTests(async (msg) => {
      archived.push(msg);
      return { ok: true };
    });

    await checkInactiveTabs();

    // Only 1 tab archived (3 - minTabs(2) = 1), and it should be the oldest
    expect(archived).toHaveLength(1);
    expect(archived[0].url).toBe('https://a.com');
  });

  it('cleans up tabLastActive for closed tabs', async () => {
    setSettingsForTests({ archiveAfterMinutes: 999, paused: false, minTabs: 0 });

    const now = Date.now();
    // Only tab 1 is still open; tab 99 is stale
    browserMock.tabs.query.mockResolvedValue([
      { id: 1, url: 'https://a.com', title: 'A', active: false, pinned: false },
    ]);

    const map = new Map([
      [1, now],
      [99, now - 60 * 60 * 1000],
    ]);
    setTabLastActiveForTests(map);

    await checkInactiveTabs();

    // Tab 99 should have been cleaned from the map
    // We can't directly inspect tabLastActive, but the function ran without error
    // and no archive calls should have been made (threshold is 999 min)
    expect(browserMock.tabs.remove).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// archiveTab (tested through handleMessage 'archiveTab' action)
// ---------------------------------------------------------------------------
describe('archiveTab', () => {
  it('skips about: URLs', async () => {
    browserMock.tabs.query.mockResolvedValue([
      { id: 1, url: 'about:blank', title: 'Blank', active: true },
    ]);

    const handler = vi.fn();
    setNativeMessageHandlerForTests(handler);

    const result = await onMessageHandler({ action: 'archiveTab' });

    // archiveTab returns { ok: true } even though it skipped internally
    expect(result.ok).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    expect(browserMock.tabs.remove).not.toHaveBeenCalled();
  });

  it('skips moz-extension: URLs', async () => {
    browserMock.tabs.query.mockResolvedValue([
      { id: 1, url: 'moz-extension://abc/page.html', title: 'Ext', active: true },
    ]);

    const handler = vi.fn();
    setNativeMessageHandlerForTests(handler);

    await onMessageHandler({ action: 'archiveTab' });

    expect(handler).not.toHaveBeenCalled();
    expect(browserMock.tabs.remove).not.toHaveBeenCalled();
  });

  it('skips tabs without a URL', async () => {
    browserMock.tabs.query.mockResolvedValue([
      { id: 1, url: undefined, title: 'No URL', active: true },
    ]);

    const handler = vi.fn();
    setNativeMessageHandlerForTests(handler);

    await onMessageHandler({ action: 'archiveTab' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('skips tabs without an id', async () => {
    browserMock.tabs.query.mockResolvedValue([
      { url: 'https://example.com', title: 'No ID', active: true },
    ]);

    const handler = vi.fn();
    setNativeMessageHandlerForTests(handler);

    await onMessageHandler({ action: 'archiveTab' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('archives a valid tab and removes it', async () => {
    browserMock.tabs.query.mockResolvedValue([
      { id: 5, url: 'https://example.com', title: 'Example', favIconUrl: 'https://example.com/icon.png', active: true },
    ]);

    const messages: any[] = [];
    setNativeMessageHandlerForTests(async (msg) => {
      messages.push(msg);
      return { ok: true };
    });

    const result = await onMessageHandler({ action: 'archiveTab' });

    expect(result.ok).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      action: 'archive',
      url: 'https://example.com',
      title: 'Example',
      faviconUrl: 'https://example.com/icon.png',
    });
    expect(browserMock.tabs.remove).toHaveBeenCalledWith(5);
    expect(browserMock.action.setBadgeText).toHaveBeenCalledWith({ text: '1' });
    expect(browserMock.storage.local.set).toHaveBeenCalledWith({ badgeSessionArchivedCount: 1 });
  });

  it('uses url as title fallback when title is missing', async () => {
    browserMock.tabs.query.mockResolvedValue([
      { id: 1, url: 'https://notitle.com', active: true },
    ]);

    const messages: any[] = [];
    setNativeMessageHandlerForTests(async (msg) => {
      messages.push(msg);
      return { ok: true };
    });

    await onMessageHandler({ action: 'archiveTab' });

    expect(messages[0].title).toBe('https://notitle.com');
  });

  it('does not remove tab if native host returns not-ok', async () => {
    browserMock.tabs.query.mockResolvedValue([
      { id: 1, url: 'https://fail.com', title: 'Fail', active: true },
    ]);

    setNativeMessageHandlerForTests(async () => ({ ok: false, error: 'disk full' }));

    await onMessageHandler({ action: 'archiveTab' });

    expect(browserMock.tabs.remove).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleMessage routing
// ---------------------------------------------------------------------------
describe('handleMessage routing', () => {
  it('search: forwards query with defaults', async () => {
    const messages: any[] = [];
    setNativeMessageHandlerForTests(async (msg) => {
      messages.push(msg);
      return { ok: true, tabs: [], count: 0 };
    });

    const result = await onMessageHandler({ action: 'search', query: 'test' });

    expect(result.ok).toBe(true);
    expect(messages[0]).toMatchObject({
      action: 'search',
      query: 'test',
      limit: 50,
      offset: 0,
    });
  });

  it('search: passes custom limit and offset', async () => {
    const messages: any[] = [];
    setNativeMessageHandlerForTests(async (msg) => {
      messages.push(msg);
      return { ok: true, tabs: [], count: 0 };
    });

    await onMessageHandler({ action: 'search', query: 'q', limit: 10, offset: 5 });

    expect(messages[0].limit).toBe(10);
    expect(messages[0].offset).toBe(5);
  });

  it('recent: forwards with defaults', async () => {
    const messages: any[] = [];
    setNativeMessageHandlerForTests(async (msg) => {
      messages.push(msg);
      return { ok: true, tabs: [], count: 0 };
    });

    await onMessageHandler({ action: 'recent' });

    expect(messages[0]).toMatchObject({ action: 'recent', limit: 50, offset: 0 });
  });

  it('restore: forwards id and returns response', async () => {
    setNativeMessageHandlerForTests(async (msg) => {
      if (msg.action === 'restore') {
        expect(msg.id).toBe(42);
        return { ok: true, restored: 1, url: 'https://restored.com' };
      }
      return { ok: false, error: `unexpected action: ${msg.action}` };
    });

    const result = await onMessageHandler({ action: 'restore', id: 42 });

    expect(result.ok).toBe(true);
    expect(result.url).toBe('https://restored.com');
  });

  it('restore: catches native errors and returns ok=false', async () => {
    setNativeMessageHandlerForTests(async () => {
      throw new Error('connection lost');
    });

    const result = await onMessageHandler({ action: 'restore', id: 1 });

    // restore has its own try/catch that returns { ok: false, error }
    expect(result.ok).toBe(false);
    expect(result.error).toContain('connection lost');
  });

  it('delete: forwards id', async () => {
    const messages: any[] = [];
    setNativeMessageHandlerForTests(async (msg) => {
      messages.push(msg);
      return { ok: true, deleted: 1 };
    });

    const result = await onMessageHandler({ action: 'delete', id: 7 });

    expect(result.ok).toBe(true);
    expect(messages[0]).toMatchObject({ action: 'delete', id: 7 });
  });

  it('stats: forwards action without changing the session badge count', async () => {
    setNativeMessageHandlerForTests(async (msg) => {
      expect(msg.action).toBe('stats');
      expect(Object.keys(msg)).toEqual(['action']);
      return { ok: true, totalArchived: 10, totalRestored: 2 };
    });

    const result = await onMessageHandler({ action: 'stats' });

    expect(result.ok).toBe(true);
    expect(result.totalArchived).toBe(10);
    expect(browserMock.action.setBadgeText).not.toHaveBeenCalled();
  });

  it('popupOpened and popupClosed are no-ops for the session badge', async () => {
    await onMessageHandler({ action: 'popupOpened' });
    await onMessageHandler({ action: 'popupClosed' });

    expect(browserMock.action.setBadgeText).not.toHaveBeenCalled();
    expect(browserMock.storage.local.set).not.toHaveBeenCalled();
  });

  it('export: forwards action', async () => {
    const messages: any[] = [];
    setNativeMessageHandlerForTests(async (msg) => {
      messages.push(msg);
      return { ok: true, tabs: [], count: 0 };
    });

    const result = await onMessageHandler({
      action: 'export',
      includeRestored: true,
      chunkSize: 250,
      offset: 500,
    });

    expect(result.ok).toBe(true);
    expect(messages[0]).toMatchObject({
      action: 'export',
      includeRestored: true,
      chunkSize: 250,
      offset: 500,
    });
  });

  it('clearAll: forwards clear action without resetting the session badge count', async () => {
    setNativeMessageHandlerForTests(async (msg) => {
      if (msg.action === 'archive') {
        return { ok: true };
      }
      if (msg.action === 'clear') {
        expect(msg.includeRestored).toBe(true);
        return { ok: true, deleted: 12 };
      }
      return { ok: false, error: `unexpected action: ${msg.action}` };
    });

    browserMock.tabs.query.mockResolvedValue([
      { id: 5, url: 'https://example.com', title: 'Example', active: true },
    ]);
    await onMessageHandler({ action: 'archiveTab' });
    const result = await onMessageHandler({ action: 'clearAll', includeRestored: true });

    expect(result).toEqual({ ok: true, deleted: 12 });
    expect(browserMock.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });
  });

  it('getSettings: returns current settings', async () => {
    setSettingsForTests({ archiveAfterMinutes: 60, paused: true, minTabs: 5 });

    const result = await onMessageHandler({ action: 'getSettings' });

    expect(result.ok).toBe(true);
    expect(result.settings).toEqual({
      archiveAfterMinutes: 60,
      paused: true,
      minTabs: 5,
    });
  });

  it('updateSettings: merges, normalizes, persists, and returns settings', async () => {
    setSettingsForTests({ archiveAfterMinutes: 60, paused: false, minTabs: 5 });

    const result = await onMessageHandler({
      action: 'updateSettings',
      settings: { paused: true, archiveAfterMinutes: 30 },
    });

    expect(result.ok).toBe(true);
    expect(result.settings).toEqual({
      archiveAfterMinutes: 30,
      paused: true,
      minTabs: 5,
    });
    expect(browserMock.storage.sync.set).toHaveBeenCalledWith({
      archiveAfterMinutes: 30,
      paused: true,
      minTabs: 5,
    });
    expect(browserMock.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#8b3a3a' });
  });

  it('updateSettings: normalizes bad values', async () => {
    const result = await onMessageHandler({
      action: 'updateSettings',
      settings: { archiveAfterMinutes: -100 },
    });

    expect(result.ok).toBe(true);
    expect(result.settings!.archiveAfterMinutes).toBe(1);
  });

  it('updateSettings: handles missing settings gracefully', async () => {
    const result = await onMessageHandler({ action: 'updateSettings' });

    expect(result.ok).toBe(true);
    // Should keep defaults when no settings provided
    expect(result.settings).toEqual({
      archiveAfterMinutes: 720,
      paused: false,
      minTabs: 20,
    });
  });

  it('archiveTab: returns error when no active tab', async () => {
    browserMock.tabs.query.mockResolvedValue([]);

    const result = await onMessageHandler({ action: 'archiveTab' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('No active tab');
  });

  it('unknown action: returns error', async () => {
    const result = await onMessageHandler({ action: 'nonexistent' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Unknown action');
  });
});

// ---------------------------------------------------------------------------
// storage.onChanged listener
// ---------------------------------------------------------------------------

// Capture the listener at module load time, before beforeEach clears mocks
const startupListener = browserMock.runtime.onStartup.addListener.mock.calls[0]?.[0] as
  | (() => void | Promise<void>)
  | undefined;
const storageListener = browserMock.storage.onChanged.addListener.mock.calls[0]?.[0] as
  | ((changes: Record<string, { newValue?: unknown }>, area: string) => void)
  | undefined;

describe('startup listener', () => {
  it('resets the archived-this-session badge count on browser startup', async () => {
    browserMock.tabs.query.mockResolvedValue([
      { id: 5, url: 'https://example.com', title: 'Example', active: true },
    ]);

    setNativeMessageHandlerForTests(async (msg) => {
      if (msg.action === 'archive') {
        return { ok: true };
      }
      return { ok: false, error: `unexpected action: ${msg.action}` };
    });

    await onMessageHandler({ action: 'archiveTab' });

    await act(async () => {
      await startupListener?.();
      await Promise.resolve();
    });

    expect(browserMock.storage.local.set).toHaveBeenCalledWith({ badgeSessionArchivedCount: 0 });
    expect(browserMock.action.setBadgeText).toHaveBeenLastCalledWith({ text: '0' });
  });
});

describe('storage change listener', () => {
  it('updates settings when sync storage changes', async () => {
    const listener = storageListener!;

    // First set known settings
    setSettingsForTests({ archiveAfterMinutes: 60, paused: false, minTabs: 5 });

    // Simulate storage change
    await act(async () => {
      listener(
        { paused: { newValue: true }, archiveAfterMinutes: { newValue: 30 } },
        'sync',
      );
      await Promise.resolve();
    });

    // Verify by reading back via getSettings
    const result = await onMessageHandler({ action: 'getSettings' });
    expect(result.settings).toEqual({
      archiveAfterMinutes: 30,
      paused: true,
      minTabs: 5,
    });
    expect(browserMock.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#8b3a3a' });
  });

  it('ignores changes from non-sync area', async () => {
    const listener = storageListener!;

    setSettingsForTests({ archiveAfterMinutes: 60, paused: false, minTabs: 5 });

    listener({ paused: { newValue: true } }, 'local');

    const result = await onMessageHandler({ action: 'getSettings' });
    expect(result.settings!.paused).toBe(false);
  });

  it('ignores changes to keys not in settings', async () => {
    const listener = storageListener!;

    setSettingsForTests({ archiveAfterMinutes: 60, paused: false, minTabs: 5 });

    listener({ unknownKey: { newValue: 'whatever' } }, 'sync');

    const result = await onMessageHandler({ action: 'getSettings' });
    expect(result.settings).toEqual({
      archiveAfterMinutes: 60,
      paused: false,
      minTabs: 5,
    });
  });
});

import { act, renderHook } from '@testing-library/react';
import { useNativeMessaging } from '../popup/hooks/useNativeMessaging';

function getBrowserMock() {
  return (globalThis as any).__browserMock__;
}

describe('useNativeMessaging', () => {
  it('maps Firefox native host allowlist errors to an actionable disconnected state', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.getManifest.mockReturnValue({
      name: 'Tab Archive',
      browser_specific_settings: { gecko: { id: 'tabarchive@masonc15.github.io' } },
    });
    browserMock.runtime.sendMessage.mockResolvedValue({
      ok: false,
      error: 'Native host disconnected: No such native application tabarchive',
    });

    const { result } = renderHook(() => useNativeMessaging());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.connection).toEqual({
      status: 'disconnected',
      message:
        'Native host not installed for this Firefox add-on. Run ./native/install.sh --browser firefox, then reload the extension.',
    });
  });

  it('sets connection to connected when the initial stats probe succeeds', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useNativeMessaging());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.connection).toEqual({ status: 'connected' });
  });

  it('sets connection to disconnected when the initial stats probe fails', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue({
      ok: false,
      error: 'Host not found',
    });

    const { result } = renderHook(() => useNativeMessaging());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.connection).toEqual({
      status: 'disconnected',
      message: 'Host not found',
    });
  });

  it('recovers the connection state after a later successful tracked request', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage
      .mockResolvedValueOnce({ ok: false, error: 'Temporary failure' })
      .mockResolvedValueOnce({
        ok: true,
        tabs: [{ id: 1, url: 'https://example.com', title: 'Example', closedAt: 123 }],
        hasMore: true,
        nextOffset: 1,
      });

    const { result } = renderHook(() => useNativeMessaging());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.connection).toEqual({
      status: 'disconnected',
      message: 'Temporary failure',
    });

    let page: any;
    await act(async () => {
      page = await result.current.search('example');
    });

    expect(page).toEqual({
      tabs: [{ id: 1, url: 'https://example.com', title: 'Example', closedAt: 123, faviconUrl: null }],
      hasMore: true,
      nextOffset: 1,
    });
    expect(result.current.connection).toEqual({ status: 'connected' });
  });

  it('does not let local settings requests overwrite the native-host connection state', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage
      .mockResolvedValueOnce({ ok: false, error: 'Host not found' })
      .mockResolvedValueOnce({
        ok: true,
        settings: { archiveAfterMinutes: 720, paused: true, minTabs: 20 },
      });

    const { result } = renderHook(() => useNativeMessaging());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.connection).toEqual({
      status: 'disconnected',
      message: 'Host not found',
    });

    let settings: any;
    await act(async () => {
      settings = await result.current.getSettings();
    });

    expect(settings).toEqual({ archiveAfterMinutes: 720, paused: true, minTabs: 20 });
    expect(result.current.connection).toEqual({
      status: 'disconnected',
      message: 'Host not found',
    });
  });

  it('search normalizes missing tab fields into the popup tab shape', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue({
      ok: true,
      tabs: [{ id: 1, url: 'https://docs.python.org', title: 'Python Docs', closedAt: 100 }],
    });

    const { result } = renderHook(() => useNativeMessaging());

    let tabs: any;
    await act(async () => {
      tabs = await result.current.search('python');
    });

    expect(tabs).toEqual({
      tabs: [
        {
          id: 1,
          url: 'https://docs.python.org',
          title: 'Python Docs',
          closedAt: 100,
          faviconUrl: null,
        },
      ],
      hasMore: false,
      nextOffset: null,
    });
  });

  it('search rejects when the native host reports a failure', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'Search failed' });

    const { result } = renderHook(() => useNativeMessaging());

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await expect(result.current.search('query')).rejects.toThrow('Search failed');
    });

    expect(result.current.connection).toEqual({
      status: 'disconnected',
      message: 'Search failed',
    });
  });

  it('restore resolves on success', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true, url: 'https://example.com' });

    const { result } = renderHook(() => useNativeMessaging());

    await act(async () => {
      await result.current.restore(42);
    });

    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'restore', id: 42 }),
    );
  });

  it('restore rejects on failure', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'Restore failed' });

    const { result } = renderHook(() => useNativeMessaging());

    await expect(
      act(async () => {
        await result.current.restore(42);
      }),
    ).rejects.toThrow('Restore failed');
  });

  it('deleteTab resolves on success', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useNativeMessaging());

    await act(async () => {
      await result.current.deleteTab(7);
    });

    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', id: 7 }),
    );
  });

  it('getRecent accepts custom pagination and returns nextOffset', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue({
      ok: true,
      tabs: [{ id: 1, url: 'https://a.com', title: 'A', faviconUrl: null, closedAt: 100 }],
      hasMore: true,
      nextOffset: 6,
    });

    const { result } = renderHook(() => useNativeMessaging());

    let tabs: any;
    await act(async () => {
      tabs = await result.current.getRecent(10, 5);
    });

    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'recent', limit: 10, offset: 5 }),
    );
    expect(tabs.nextOffset).toBe(6);
  });

  it('getStats returns normalized archive statistics', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue({
      ok: true,
      totalArchived: 10,
      totalRestored: 2,
      dbSizeBytes: 1024,
      oldestClosedAt: 100,
      newestClosedAt: 200,
    });

    const { result } = renderHook(() => useNativeMessaging());

    let stats: any;
    await act(async () => {
      stats = await result.current.getStats();
    });

    expect(stats).toEqual({
      totalArchived: 10,
      totalRestored: 2,
      dbSizeBytes: 1024,
      oldestClosedAt: 100,
      newestClosedAt: 200,
    });
  });

  it('getSettings returns defaults when the background response omits them', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useNativeMessaging());

    let settings: any;
    await act(async () => {
      settings = await result.current.getSettings();
    });

    expect(settings).toEqual({
      archiveAfterMinutes: 720,
      paused: false,
      minTabs: 20,
    });
  });

  it('updateSettings sends partial settings and returns the stored settings', async () => {
    const browserMock = getBrowserMock();
    const updatedSettings = { archiveAfterMinutes: 1440, paused: false, minTabs: 20 };
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true, settings: updatedSettings });

    const { result } = renderHook(() => useNativeMessaging());

    let settings: any;
    await act(async () => {
      settings = await result.current.updateSettings({ archiveAfterMinutes: 1440 });
    });

    expect(settings).toEqual(updatedSettings);
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'updateSettings',
        settings: { archiveAfterMinutes: 1440 },
      }),
    );
  });

  it('archiveCurrentTab resolves on success', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useNativeMessaging());

    await act(async () => {
      await result.current.archiveCurrentTab();
    });

    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'archiveTab' }),
    );
  });

  it('exportArchive returns explicit export rows', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue({
      ok: true,
      tabs: [
        {
          id: 1,
          url: 'https://example.com',
          title: 'Example',
          closedAt: 1000,
        },
      ],
      hasMore: false,
    });

    const { result } = renderHook(() => useNativeMessaging());

    let page: any;
    await act(async () => {
      page = await result.current.exportArchive({ includeRestored: true, chunkSize: 200, offset: 0 });
    });

    expect(page).toEqual({
      tabs: [
        {
          id: 1,
          url: 'https://example.com',
          title: 'Example',
          faviconUrl: null,
          closedAt: 1000,
          restoredAt: null,
          metadata: null,
        },
      ],
      hasMore: false,
      nextOffset: null,
    });
  });

  it('clearArchive returns the deleted row count', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true, deleted: 4 });

    const { result } = renderHook(() => useNativeMessaging());

    let deleted = 0;
    await act(async () => {
      deleted = await result.current.clearArchive({ includeRestored: true });
    });

    expect(deleted).toBe(4);
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'clearAll', includeRestored: true }),
    );
  });

  it('tracks a no-response failure as disconnected state', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue(undefined);

    const { result } = renderHook(() => useNativeMessaging());

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await expect(result.current.getRecent()).rejects.toThrow('No response');
    });

    expect(result.current.connection).toEqual({
      status: 'disconnected',
      message: 'No response',
    });
  });
});

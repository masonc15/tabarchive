import { renderHook, act } from '@testing-library/react';
import { useNativeMessaging } from '../popup/hooks/useNativeMessaging';

function getBrowserMock() {
  return (globalThis as any).__browserMock__;
}

describe('useNativeMessaging', () => {
  it('maps stats fields from native response', async () => {
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

    expect(stats.totalArchived).toBe(10);
    expect(stats.oldestClosedAt).toBe(100);
    expect(stats.newestClosedAt).toBe(200);
  });

  it('sets connected to true when initial stats succeeds', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useNativeMessaging());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.connected).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('sets connected to false and error when initial stats fails', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue({
      ok: false,
      error: 'Host not found',
    });

    const { result } = renderHook(() => useNativeMessaging());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.connected).toBe(false);
    expect(result.current.error).toBe('Host not found');
  });

  it('sets error when sendMessage throws', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockRejectedValue(new Error('Connection refused'));

    const { result } = renderHook(() => useNativeMessaging());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.connected).toBe(false);
    expect(result.current.error).toBe('Connection refused');
  });

  it('search returns tabs from response', async () => {
    const browserMock = getBrowserMock();
    const mockTabs = [
      { id: 1, url: 'https://example.com', title: 'Example', closedAt: 123 },
    ];
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true, tabs: mockTabs });

    const { result } = renderHook(() => useNativeMessaging());

    let tabs: any;
    await act(async () => {
      tabs = await result.current.search('example');
    });

    expect(tabs).toEqual({ tabs: mockTabs, hasMore: false });
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'search', query: 'example', limit: 100, offset: 0 })
    );
  });

  it('search returns empty array when response is not ok', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: false });

    const { result } = renderHook(() => useNativeMessaging());

    let tabs: any;
    await act(async () => {
      tabs = await result.current.search('query');
    });

    expect(tabs).toEqual({ tabs: [], hasMore: false });
  });

  it('restore returns true on success', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true, url: 'https://example.com' });

    const { result } = renderHook(() => useNativeMessaging());

    let ok: boolean = false;
    await act(async () => {
      ok = await result.current.restore(42);
    });

    expect(ok).toBe(true);
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'restore', id: 42 })
    );
  });

  it('restore returns false on failure', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: false });

    const { result } = renderHook(() => useNativeMessaging());

    let ok: boolean = true;
    await act(async () => {
      ok = await result.current.restore(42);
    });

    expect(ok).toBe(false);
  });

  it('deleteTab sends correct action', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useNativeMessaging());

    let ok: boolean = false;
    await act(async () => {
      ok = await result.current.deleteTab(7);
    });

    expect(ok).toBe(true);
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', id: 7 })
    );
  });

  it('getRecent sends correct action with defaults', async () => {
    const browserMock = getBrowserMock();
    const mockTabs = [{ id: 1, url: 'https://a.com', title: 'A', closedAt: 100 }];
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true, tabs: mockTabs });

    const { result } = renderHook(() => useNativeMessaging());

    let tabs: any;
    await act(async () => {
      tabs = await result.current.getRecent();
    });

    expect(tabs).toEqual({ tabs: mockTabs, hasMore: false });
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'recent', limit: 100, offset: 0 })
    );
  });

  it('getRecent accepts custom limit and offset', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true, tabs: [] });

    const { result } = renderHook(() => useNativeMessaging());

    await act(async () => {
      await result.current.getRecent(10, 5);
    });

    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'recent', limit: 10, offset: 5 })
    );
  });

  it('getSettings returns settings from response', async () => {
    const browserMock = getBrowserMock();
    const mockSettings = { archiveAfterMinutes: 1440, paused: true, minTabs: 10 };
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true, settings: mockSettings });

    const { result } = renderHook(() => useNativeMessaging());

    let settings: any;
    await act(async () => {
      settings = await result.current.getSettings();
    });

    expect(settings).toEqual(mockSettings);
  });

  it('getSettings returns defaults when response has no settings', async () => {
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

  it('getSettings does not clear an existing native-host error', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage
      .mockResolvedValueOnce({ ok: false, error: 'Host not found' })
      .mockResolvedValueOnce({ ok: true, settings: { archiveAfterMinutes: 720, paused: true, minTabs: 20 } });

    const { result } = renderHook(() => useNativeMessaging());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.error).toBe('Host not found');

    await act(async () => {
      await result.current.getSettings();
    });

    expect(result.current.error).toBe('Host not found');
  });

  it('updateSettings sends partial settings', async () => {
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
      expect.objectContaining({ action: 'updateSettings', settings: { archiveAfterMinutes: 1440 } })
    );
  });

  it('updateSettings returns defaults when response has no settings', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useNativeMessaging());

    let settings: any;
    await act(async () => {
      settings = await result.current.updateSettings({ paused: true });
    });

    expect(settings).toEqual({
      archiveAfterMinutes: 720,
      paused: false,
      minTabs: 20,
    });
  });

  it('archiveCurrentTab sends correct action', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useNativeMessaging());

    let ok: boolean = false;
    await act(async () => {
      ok = await result.current.archiveCurrentTab();
    });

    expect(ok).toBe(true);
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'archiveTab' })
    );
  });

  it('clears error on successful sendMessage', async () => {
    const browserMock = getBrowserMock();
    // First call fails (connection check)
    browserMock.runtime.sendMessage
      .mockResolvedValueOnce({ ok: false, error: 'Temporary failure' })
      // Second call succeeds
      .mockResolvedValueOnce({ ok: true, tabs: [] });

    const { result } = renderHook(() => useNativeMessaging());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.error).toBe('Temporary failure');

    await act(async () => {
      await result.current.search('test');
    });

    expect(result.current.error).toBeNull();
  });

  it('getStats returns zeroes when response values are missing', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useNativeMessaging());

    let stats: any;
    await act(async () => {
      stats = await result.current.getStats();
    });

    expect(stats.totalArchived).toBe(0);
    expect(stats.totalRestored).toBe(0);
    expect(stats.dbSizeBytes).toBe(0);
  });

  it('sendMessage returns fallback response when no response', async () => {
    const browserMock = getBrowserMock();
    browserMock.runtime.sendMessage.mockResolvedValue(undefined);

    const { result } = renderHook(() => useNativeMessaging());

    let response: any;
    await act(async () => {
      response = await result.current.sendMessage({ action: 'test' });
    });

    expect(response).toEqual({ ok: false, error: 'No response' });
  });
});

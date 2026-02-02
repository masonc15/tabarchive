import { renderHook, act } from '@testing-library/react';
import { useNativeMessaging } from '../popup/hooks/useNativeMessaging';

describe('useNativeMessaging', () => {
  it('maps stats fields from native response', async () => {
    const browserMock = (globalThis as any).__browserMock__;
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
});

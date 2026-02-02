import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../popup/popup';

const {
  restoreMock,
  getRecentMock,
  getSettingsMock,
  updateSettingsMock,
} = vi.hoisted(() => ({
  restoreMock: vi.fn().mockResolvedValue(false),
  getRecentMock: () =>
    Promise.resolve([
      {
        id: 1,
        url: 'https://example.com/page',
        title: 'Example',
        closedAt: Date.now() - 60000,
        faviconUrl: 'https://example.com/favicon.ico',
      },
    ]),
  getSettingsMock: () =>
    Promise.resolve({
      archiveAfterMinutes: 720,
      paused: false,
      minTabs: 20,
    }),
  updateSettingsMock: () =>
    Promise.resolve({
      archiveAfterMinutes: 720,
      paused: false,
      minTabs: 20,
    }),
}));

const useNativeMessagingMock = () => ({
  sendMessage: vi.fn(),
  search: vi.fn(),
  restore: restoreMock,
  deleteTab: vi.fn(),
  getRecent: getRecentMock,
  getStats: vi.fn(),
  getSettings: getSettingsMock,
  updateSettings: updateSettingsMock,
  archiveCurrentTab: vi.fn(),
  connected: true,
  error: null,
});

vi.mock('../popup/components/TabList', () => ({
  TabList: ({ tabs, onRestore }: { tabs: any[]; onRestore: (t: any) => void }) => (
    <div>
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onRestore(t)}>
          {t.title}
        </button>
      ))}
    </div>
  ),
}));

describe('Popup App', () => {
  it('does not remove tab from list when restore fails', async () => {
    const browserMock = (globalThis as any).__browserMock__;

    await act(async () => {
      render(<App useNativeMessagingHook={useNativeMessagingMock} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('Example')).toBeInTheDocument();

    const restoreButton = screen.getByRole('button', { name: 'Example' });
    act(() => {
      fireEvent.click(restoreButton);
    });

    expect(restoreMock).toHaveBeenCalled();
    expect(screen.getByText('Example')).toBeInTheDocument();
    expect(browserMock.tabs.create).not.toHaveBeenCalled();
  });
});

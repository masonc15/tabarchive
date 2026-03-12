import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../popup/popup';

const sampleTab = {
  id: 1,
  url: 'https://example.com/page',
  title: 'Example',
  closedAt: Date.now() - 60000,
  faviconUrl: 'https://example.com/favicon.ico',
};

const defaultSettings = {
  archiveAfterMinutes: 720,
  paused: false,
  minTabs: 20,
};

function createMocks(overrides: Record<string, unknown> = {}) {
  const mocks = {
    sendMessage: vi.fn().mockResolvedValue({ ok: true }),
    search: vi.fn().mockResolvedValue({ tabs: [], hasMore: false }),
    restore: vi.fn().mockResolvedValue(false),
    deleteTab: vi.fn(),
    getRecent: vi.fn().mockResolvedValue({ tabs: [sampleTab], hasMore: false }),
    getStats: vi.fn(),
    getSettings: vi.fn().mockResolvedValue(defaultSettings),
    updateSettings: vi.fn().mockResolvedValue(defaultSettings),
    archiveCurrentTab: vi.fn(),
    connected: true as boolean,
    error: null as string | null,
    ...overrides,
  };
  const hook = () => mocks;
  return { mocks, hook };
}

vi.mock('../popup/components/TabList', () => ({
  TabList: ({ tabs, loading, onRestore }: { tabs: any[]; loading: boolean; onRestore: (t: any) => Promise<boolean>; loadMore: () => void; hasMore: boolean; loadingMore: boolean }) => (
    <div data-testid="tab-list" data-loading={loading}>
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onRestore(t)}>
          {t.title}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../popup/components/SearchBar', () => ({
  SearchBar: ({ value, onChange, disabled }: { value: string; onChange: (q: string) => void; disabled: boolean }) => (
    <input
      data-testid="search-bar"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder="Search"
    />
  ),
}));

describe('Popup App', () => {
  it('notifies background when popup opens and closes', async () => {
    const browserMock = (globalThis as any).__browserMock__;
    const { hook } = createMocks();
    const { unmount } = render(<App useNativeMessagingHook={hook} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({ action: 'popupOpened' });

    unmount();

    await act(async () => {
      await Promise.resolve();
    });

    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({ action: 'popupClosed' });
  });

  it('does not remove tab from list when restore fails', async () => {
    const browserMock = (globalThis as any).__browserMock__;
    const { mocks, hook } = createMocks();

    await act(async () => {
      render(<App useNativeMessagingHook={hook} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('Example')).toBeInTheDocument();

    const restoreButton = screen.getByRole('button', { name: 'Example' });
    act(() => {
      fireEvent.click(restoreButton);
    });

    expect(mocks.restore).toHaveBeenCalled();
    expect(screen.getByText('Example')).toBeInTheDocument();
    expect(browserMock.tabs.create).not.toHaveBeenCalled();
  });

  it('loads recent tabs on mount when connected', async () => {
    const { mocks, hook } = createMocks();

    await act(async () => {
      render(<App useNativeMessagingHook={hook} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.getRecent).toHaveBeenCalled();
    expect(screen.getByText('Example')).toBeInTheDocument();
  });

  it('loads settings on mount regardless of native host connectivity', async () => {
    const { mocks, hook } = createMocks();

    await act(async () => {
      render(<App useNativeMessagingHook={hook} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.getSettings).toHaveBeenCalled();
  });

  it('shows paused state in the header toggle after settings load', async () => {
    const { hook } = createMocks({
      getSettings: vi.fn().mockResolvedValue({ ...defaultSettings, paused: true }),
    });

    await act(async () => {
      render(<App useNativeMessagingHook={hook} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: 'Resume archiving' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles pause state from the header control', async () => {
    const user = userEvent.setup();
    const { mocks, hook } = createMocks();

    await act(async () => {
      render(<App useNativeMessagingHook={hook} />);
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Pause archiving' })).toBeEnabled();
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Pause archiving' }));
    });

    await waitFor(() => {
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        archiveAfterMinutes: 720,
        paused: true,
        minTabs: 20,
      });
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Resume archiving' })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('removes tab from list on successful restore', async () => {
    const browserMock = (globalThis as any).__browserMock__;
    const { hook } = createMocks({
      restore: vi.fn().mockResolvedValue(true),
    });

    await act(async () => {
      render(<App useNativeMessagingHook={hook} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('Example')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Example' }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(browserMock.tabs.create).toHaveBeenCalledWith({ url: 'https://example.com/page' });
    expect(screen.queryByText('Example')).not.toBeInTheDocument();
  });

  it('shows error message when error is set', async () => {
    const { hook } = createMocks({ error: 'Native host not found' });

    await act(async () => {
      render(<App useNativeMessagingHook={hook} />);
    });

    expect(screen.getByText('Native host not found')).toBeInTheDocument();
  });

  it('shows connecting message when not connected and no error', async () => {
    const { hook } = createMocks({ connected: false, error: null });

    await act(async () => {
      render(<App useNativeMessagingHook={hook} />);
    });

    expect(screen.getByText('Connecting to native host...')).toBeInTheDocument();
  });

  it('disables search bar when not connected', async () => {
    const { hook } = createMocks({ connected: false });

    await act(async () => {
      render(<App useNativeMessagingHook={hook} />);
    });

    expect(screen.getByTestId('search-bar')).toBeDisabled();
  });

  it('switches to settings view and back', async () => {
    const user = userEvent.setup();
    const { hook } = createMocks();

    await act(async () => {
      render(<App useNativeMessagingHook={hook} />);
    });
    await waitFor(() => {
      expect(screen.getByTestId('tab-list')).toBeInTheDocument();
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Settings' }));
    });
    expect(screen.queryByTestId('tab-list')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Statistics')).toBeInTheDocument();
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Search' }));
    });
    expect(screen.getByTestId('tab-list')).toBeInTheDocument();
  });

  it('triggers search when search bar value changes', async () => {
    const { mocks, hook } = createMocks({
      search: vi.fn().mockResolvedValue({ tabs: [
        { id: 2, url: 'https://found.com', title: 'Found', closedAt: Date.now() },
      ], hasMore: false }),
    });

    await act(async () => {
      render(<App useNativeMessagingHook={hook} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const searchBar = screen.getByTestId('search-bar');

    await act(async () => {
      fireEvent.change(searchBar, { target: { value: 'found' } });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.search).toHaveBeenCalledWith('found', 100);
  });

  it('loads recent tabs when search query is cleared', async () => {
    const { mocks, hook } = createMocks();

    await act(async () => {
      render(<App useNativeMessagingHook={hook} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const searchBar = screen.getByTestId('search-bar');
    await act(async () => {
      fireEvent.change(searchBar, { target: { value: 'test' } });
    });
    await act(async () => {
      await Promise.resolve();
    });

    mocks.getRecent.mockClear();
    await act(async () => {
      fireEvent.change(searchBar, { target: { value: '' } });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.getRecent).toHaveBeenCalled();
  });

  it('does not fetch tabs when disconnected but still hydrates settings', async () => {
    const { mocks, hook } = createMocks({ connected: false });

    await act(async () => {
      render(<App useNativeMessagingHook={hook} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.getRecent).not.toHaveBeenCalled();
    expect(mocks.getSettings).toHaveBeenCalled();
  });

  it('renders header with title', async () => {
    const { hook } = createMocks();

    await act(async () => {
      render(<App useNativeMessagingHook={hook} />);
    });

    expect(screen.getByText('Tab Archive')).toBeInTheDocument();
  });
});

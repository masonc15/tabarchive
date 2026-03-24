import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UseNativeMessagingResult } from '../popup/hooks/useNativeMessaging';
import { App } from '../popup/popup';
import type {
  AppSettings,
  ArchiveStats,
  ArchivedTab,
  ConnectionState,
  ExportedArchivedTab,
  PaginatedResult,
} from '../popup/types';

const sampleTab: ArchivedTab = {
  id: 1,
  url: 'https://example.com/page',
  title: 'Example',
  closedAt: Date.now() - 60000,
  faviconUrl: 'https://example.com/favicon.ico',
};

const defaultSettings: AppSettings = {
  archiveAfterMinutes: 720,
  paused: false,
  minTabs: 20,
};

const defaultStats: ArchiveStats = {
  totalArchived: 1,
  totalRestored: 0,
  dbSizeBytes: 1024,
  oldestClosedAt: null,
  newestClosedAt: null,
};

const defaultRecentResult: PaginatedResult<ArchivedTab> = {
  tabs: [sampleTab],
  hasMore: false,
  nextOffset: null,
};

const emptyExportResult: PaginatedResult<ExportedArchivedTab> = {
  tabs: [],
  hasMore: false,
  nextOffset: null,
};

type MockedHookResult = {
  search: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  deleteTab: ReturnType<typeof vi.fn>;
  getRecent: ReturnType<typeof vi.fn>;
  getStats: ReturnType<typeof vi.fn>;
  getSettings: ReturnType<typeof vi.fn>;
  updateSettings: ReturnType<typeof vi.fn>;
  archiveCurrentTab: ReturnType<typeof vi.fn>;
  exportArchive: ReturnType<typeof vi.fn>;
  clearArchive: ReturnType<typeof vi.fn>;
  connection: ConnectionState;
};

function createMocks(overrides: Partial<MockedHookResult> = {}) {
  const mocks: MockedHookResult = {
    search: vi.fn().mockResolvedValue({ tabs: [], hasMore: false, nextOffset: null }),
    restore: vi.fn().mockResolvedValue(undefined),
    deleteTab: vi.fn().mockResolvedValue(undefined),
    getRecent: vi.fn().mockResolvedValue(defaultRecentResult),
    getStats: vi.fn().mockResolvedValue(defaultStats),
    getSettings: vi.fn().mockResolvedValue(defaultSettings),
    updateSettings: vi.fn().mockResolvedValue(defaultSettings),
    archiveCurrentTab: vi.fn().mockResolvedValue(undefined),
    exportArchive: vi.fn().mockResolvedValue(emptyExportResult),
    clearArchive: vi.fn().mockResolvedValue(0),
    connection: { status: 'connected' },
    ...overrides,
  };

  const hook = (): UseNativeMessagingResult => ({
    search: mocks.search as UseNativeMessagingResult['search'],
    restore: mocks.restore as UseNativeMessagingResult['restore'],
    deleteTab: mocks.deleteTab as UseNativeMessagingResult['deleteTab'],
    getRecent: mocks.getRecent as UseNativeMessagingResult['getRecent'],
    getStats: mocks.getStats as UseNativeMessagingResult['getStats'],
    getSettings: mocks.getSettings as UseNativeMessagingResult['getSettings'],
    updateSettings: mocks.updateSettings as UseNativeMessagingResult['updateSettings'],
    archiveCurrentTab: mocks.archiveCurrentTab as UseNativeMessagingResult['archiveCurrentTab'],
    exportArchive: mocks.exportArchive as UseNativeMessagingResult['exportArchive'],
    clearArchive: mocks.clearArchive as UseNativeMessagingResult['clearArchive'],
    connection: mocks.connection,
  });

  return { mocks, hook };
}

vi.mock('../popup/components/TabList', () => ({
  TabList: ({
    tabs,
    loading,
    onRestore,
  }: {
    tabs: ArchivedTab[];
    loading: boolean;
    onRestore: (tab: ArchivedTab) => Promise<void> | void;
    loadMore: () => void;
    hasMore: boolean;
    loadingMore: boolean;
  }) => (
    <div data-testid="tab-list" data-loading={loading}>
      {tabs.map((tab) => (
        <button
          type="button"
          key={tab.id}
          onClick={() => {
            void Promise.resolve(onRestore(tab)).catch(() => {});
          }}
        >
          {tab.title}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../popup/components/SearchBar', () => ({
  SearchBar: ({
    value,
    onChange,
    disabled,
  }: {
    value: string;
    onChange: (query: string) => void;
    disabled: boolean;
  }) => (
    <input
      data-testid="search-bar"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      placeholder="Search"
    />
  ),
}));

beforeEach(() => {
  const browserMock = (globalThis as any).__browserMock__;
  vi.clearAllMocks();
  browserMock.tabs.create.mockResolvedValue(undefined);
  browserMock.runtime.sendMessage.mockResolvedValue(undefined);
  browserMock.runtime.getManifest.mockReturnValue({ name: 'Tab Archive' });
});

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
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { mocks, hook } = createMocks({
      restore: vi
        .fn()
        .mockRejectedValue(new Error('The archive entry could not be updated.')),
    });

    await act(async () => {
      render(<App useNativeMessagingHook={hook} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('Example')).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Example' }));
    });

    await waitFor(() => {
      expect(mocks.restore).toHaveBeenCalledWith(1);
    });
    expect(screen.getByText('Example')).toBeInTheDocument();
    expect(browserMock.tabs.create).toHaveBeenCalledWith({ url: 'https://example.com/page' });
    expect(
      screen.getByText('Restore failed: The archive entry could not be updated.'),
    ).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });

  it('does not call restore when tab creation fails', async () => {
    const browserMock = (globalThis as any).__browserMock__;
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    browserMock.tabs.create.mockRejectedValueOnce(new Error('Blocked URL'));
    const { mocks, hook } = createMocks({
      restore: vi.fn().mockResolvedValue(undefined),
    });

    await act(async () => {
      render(<App useNativeMessagingHook={hook} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Example' }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(browserMock.tabs.create).toHaveBeenCalledWith({ url: 'https://example.com/page' });
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(screen.getByText('Example')).toBeInTheDocument();
    expect(screen.getByText('Restore failed: Blocked URL')).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });

  it('shows a Firefox-specific error for local file tabs', async () => {
    const browserMock = (globalThis as any).__browserMock__;
    browserMock.runtime.getManifest.mockReturnValue({
      name: 'Tab Archive',
      browser_specific_settings: { gecko: { id: 'tabarchive@masonc15.github.io' } },
    });
    const localFileTab: ArchivedTab = {
      id: 2,
      url: 'file:///Users/colin/tmp/claude-sessions-playground.html',
      title: 'Local File',
      closedAt: Date.now() - 60000,
      faviconUrl: null,
    };
    const { mocks, hook } = createMocks({
      getRecent: vi.fn().mockResolvedValue({
        tabs: [localFileTab],
        hasMore: false,
        nextOffset: null,
      }),
      restore: vi.fn().mockResolvedValue(undefined),
    });

    await act(async () => {
      render(<App useNativeMessagingHook={hook} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Local File' }));
    });

    expect(browserMock.tabs.create).not.toHaveBeenCalled();
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'Restore failed: Firefox cannot reopen local file tabs from an extension. Open the file directly from disk.',
      ),
    ).toBeInTheDocument();
  });

  it('loads recent tabs on mount when connected', async () => {
    const { mocks, hook } = createMocks();

    await act(async () => {
      render(<App useNativeMessagingHook={hook} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.getRecent).toHaveBeenCalledWith(100);
    expect(screen.getByText('Example')).toBeInTheDocument();
  });

  it('loads settings on mount regardless of native host connectivity', async () => {
    const { mocks, hook } = createMocks({
      connection: { status: 'disconnected', message: 'Host not found' },
    });

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

    expect(screen.getByRole('button', { name: 'Resume archiving' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
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
      expect(screen.getByRole('button', { name: 'Resume archiving' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
  });

  it('removes tab from list on successful restore', async () => {
    const browserMock = (globalThis as any).__browserMock__;
    const { mocks, hook } = createMocks({
      restore: vi.fn().mockResolvedValue(undefined),
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
    expect(mocks.restore).toHaveBeenCalledWith(1);
    expect(screen.queryByText('Example')).not.toBeInTheDocument();
  });

  it('shows error message when the connection is disconnected', async () => {
    const { hook } = createMocks({
      connection: { status: 'disconnected', message: 'Native host not found' },
    });

    await act(async () => {
      render(<App useNativeMessagingHook={hook} />);
    });

    expect(screen.getByText('Native host not found')).toBeInTheDocument();
  });

  it('shows connecting message while checking the native host', async () => {
    const { hook } = createMocks({ connection: { status: 'checking' } });

    await act(async () => {
      render(<App useNativeMessagingHook={hook} />);
    });

    expect(screen.getByText('Connecting to native host...')).toBeInTheDocument();
  });

  it('disables search bar when the native host is not connected yet', async () => {
    const { hook } = createMocks({ connection: { status: 'checking' } });

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
      search: vi.fn().mockResolvedValue({
        tabs: [
          {
            id: 2,
            url: 'https://found.com',
            title: 'Found',
            faviconUrl: null,
            closedAt: Date.now(),
          },
        ],
        hasMore: false,
        nextOffset: null,
      }),
    });

    await act(async () => {
      render(<App useNativeMessagingHook={hook} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId('search-bar'), { target: { value: 'found' } });
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

    await act(async () => {
      fireEvent.change(screen.getByTestId('search-bar'), { target: { value: 'test' } });
    });
    await act(async () => {
      await Promise.resolve();
    });

    mocks.getRecent.mockClear();
    await act(async () => {
      fireEvent.change(screen.getByTestId('search-bar'), { target: { value: '' } });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.getRecent).toHaveBeenCalledWith(100);
  });

  it('does not fetch tabs when disconnected but still hydrates settings', async () => {
    const { mocks, hook } = createMocks({
      connection: { status: 'disconnected', message: 'Host not found' },
    });

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

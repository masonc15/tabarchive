import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Settings } from '../popup/components/Settings';
import type { AppSettings } from '../popup/types';

const defaultSettings: AppSettings = {
  archiveAfterMinutes: 720,
  paused: false,
  minTabs: 20,
};

function renderSettings(
  overrides: {
    settings?: AppSettings;
    onChange?: (s: AppSettings) => void;
    getStats?: () => Promise<any>;
    exportArchive?: (args: { includeRestored: boolean; chunkSize: number; offset: number }) => Promise<any>;
    clearArchive?: (args: { includeRestored: boolean }) => Promise<number>;
  } = {},
) {
  const onChange = overrides.onChange ?? vi.fn();
  const getStats = overrides.getStats ?? vi.fn().mockRejectedValue(new Error('stats unavailable'));
  const exportArchive = overrides.exportArchive ?? vi.fn();
  const clearArchive = overrides.clearArchive ?? vi.fn();
  const settings = overrides.settings ?? defaultSettings;

  return {
    onChange,
    getStats,
    exportArchive,
    clearArchive,
    ...render(
      <Settings
        settings={settings}
        onChange={onChange}
        getStats={getStats}
        exportArchive={exportArchive}
        clearArchive={clearArchive}
      />,
    ),
  };
}

async function waitForStatsToRender() {
  await screen.findByText('Statistics');
}

describe('Settings', () => {
  it('does not render a pause toggle in the settings panel', () => {
    renderSettings();
    expect(screen.queryByRole('switch', { name: 'Pause archiving' })).not.toBeInTheDocument();
  });

  it('renders archive-after select with correct value', () => {
    renderSettings();
    expect(screen.getByRole('combobox', { name: 'Archive after' })).toHaveValue('720');
  });

  it('renders min-tabs select with correct value', () => {
    renderSettings();
    expect(screen.getByRole('combobox', { name: 'Minimum tabs' })).toHaveValue('20');
  });

  it('dispatches archiveAfterMinutes changes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSettings({ onChange });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Archive after' }), '1440');

    expect(onChange).toHaveBeenCalledWith({ ...defaultSettings, archiveAfterMinutes: 1440 });
  });

  it('dispatches minTabs changes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSettings({ onChange });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Minimum tabs' }), '10');

    expect(onChange).toHaveBeenCalledWith({ ...defaultSettings, minTabs: 10 });
  });

  it('displays stats when getStats succeeds', async () => {
    const getStats = vi.fn().mockResolvedValue({
      totalArchived: 150,
      totalRestored: 30,
      dbSizeBytes: 2048,
      oldestClosedAt: 100,
      newestClosedAt: 200,
    });

    renderSettings({ getStats });

    await waitFor(() => {
      expect(screen.getByText('150')).toBeInTheDocument();
    });
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
  });

  it('formats larger database sizes in MB to keep the stats card compact', async () => {
    const getStats = vi.fn().mockResolvedValue({
      totalArchived: 1259,
      totalRestored: 39,
      dbSizeBytes: 16376 * 1024,
      oldestClosedAt: null,
      newestClosedAt: null,
    });

    renderSettings({ getStats });

    await waitFor(() => {
      expect(screen.getByText('1,259')).toBeInTheDocument();
    });
    expect(screen.getByText('16 MB')).toBeInTheDocument();
  });

  it('does not display stats when getStats fails', async () => {
    const getStats = vi.fn().mockRejectedValue(new Error('Network error'));
    renderSettings({ getStats });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText('Statistics')).not.toBeInTheDocument();
  });

  it('shows "Unknown" db size when dbSizeBytes is missing', async () => {
    const getStats = vi.fn().mockResolvedValue({
      totalArchived: 5,
      totalRestored: 1,
      dbSizeBytes: 0,
      oldestClosedAt: null,
      newestClosedAt: null,
    });

    renderSettings({ getStats });

    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument();
    });
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('shows footer text about local storage', () => {
    renderSettings();
    expect(screen.getByText(/local storage managed by the native host/)).toBeInTheDocument();
  });

  it('exports archived tabs as JSON', async () => {
    const user = userEvent.setup();
    const getStats = vi.fn().mockResolvedValue({
      totalArchived: 2,
      totalRestored: 1,
      dbSizeBytes: 1024,
      oldestClosedAt: null,
      newestClosedAt: null,
    });
    const exportArchive = vi.fn().mockResolvedValue({
      tabs: [{ id: 1, url: 'https://example.com', title: 'Example', faviconUrl: null, closedAt: 1000, restoredAt: null, metadata: null }],
      hasMore: false,
      nextOffset: null,
    });

    const createUrlSpy = vi.fn(() => 'blob:tabarchive');
    const revokeUrlSpy = vi.fn();
    const originalCreateObjectURL = (URL as any).createObjectURL;
    const originalRevokeObjectURL = (URL as any).revokeObjectURL;
    (URL as any).createObjectURL = createUrlSpy;
    (URL as any).revokeObjectURL = revokeUrlSpy;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderSettings({ getStats, exportArchive });
    await waitForStatsToRender();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Export archive data' }));
    });

    await waitFor(() => {
      expect(exportArchive).toHaveBeenCalledWith({
        includeRestored: true,
        chunkSize: 200,
        offset: 0,
      });
    });
    expect(clickSpy).toHaveBeenCalled();
    expect(createUrlSpy).toHaveBeenCalled();
    expect(revokeUrlSpy).toHaveBeenCalled();
    expect(screen.getByText('Exported 1 tabs.')).toBeInTheDocument();

    (URL as any).createObjectURL = originalCreateObjectURL;
    (URL as any).revokeObjectURL = originalRevokeObjectURL;
  });

  it('clears archived tabs after confirmation', async () => {
    const user = userEvent.setup();
    const getStats = vi
      .fn()
      .mockResolvedValueOnce({
        totalArchived: 4,
        totalRestored: 1,
        dbSizeBytes: 1024,
        oldestClosedAt: null,
        newestClosedAt: null,
      })
      .mockResolvedValueOnce({
        totalArchived: 0,
        totalRestored: 5,
        dbSizeBytes: 512,
        oldestClosedAt: null,
        newestClosedAt: null,
      });
    const clearArchive = vi.fn().mockResolvedValue(4);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderSettings({ getStats, clearArchive });
    await waitForStatsToRender();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Clear archived tabs' }));
    });

    await waitFor(() => {
      expect(clearArchive).toHaveBeenCalledWith({ includeRestored: true });
    });
    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByText('Deleted 4 archived tabs.')).toBeInTheDocument();
  });

  it('does not clear archived tabs when confirmation is canceled', async () => {
    const user = userEvent.setup();
    const getStats = vi.fn().mockResolvedValue({
      totalArchived: 2,
      totalRestored: 0,
      dbSizeBytes: 1024,
      oldestClosedAt: null,
      newestClosedAt: null,
    });
    const clearArchive = vi.fn().mockResolvedValue(0);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderSettings({ getStats, clearArchive });
    await waitForStatsToRender();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Clear archived tabs' }));
    });

    expect(confirmSpy).toHaveBeenCalled();
    expect(clearArchive).not.toHaveBeenCalled();
  });

  it('resets settings to defaults', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    renderSettings({
      settings: { archiveAfterMinutes: 43200, paused: true, minTabs: 50 },
      onChange,
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Reset settings' }));
    });

    expect(onChange).toHaveBeenCalledWith({
      archiveAfterMinutes: 720,
      paused: false,
      minTabs: 20,
    });
    expect(screen.getByText('Settings reset to defaults.')).toBeInTheDocument();
  });
});

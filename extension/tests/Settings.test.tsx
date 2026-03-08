import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Settings } from '../popup/components/Settings';
import type { AppSettings } from '../popup/types';

const defaultSettings: AppSettings = {
  archiveAfterMinutes: 720,
  paused: false,
  minTabs: 20,
};

function renderSettings(overrides: {
  settings?: AppSettings;
  onChange?: (s: AppSettings) => void;
  sendMessage?: (msg: Record<string, unknown>) => Promise<any>;
} = {}) {
  const onChange = overrides.onChange ?? vi.fn();
  const sendMessage = overrides.sendMessage ?? vi.fn().mockResolvedValue({ ok: false });
  const settings = overrides.settings ?? defaultSettings;

  return {
    onChange,
    sendMessage,
    ...render(
      <Settings settings={settings} onChange={onChange} sendMessage={sendMessage} />
    ),
  };
}

describe('Settings', () => {
  it('does not render a pause toggle in the settings panel', () => {
    renderSettings();
    expect(screen.queryByRole('switch', { name: 'Pause archiving' })).not.toBeInTheDocument();
  });

  it('renders archive-after select with correct value', () => {
    renderSettings();
    const select = screen.getByRole('combobox', { name: 'Archive after' });
    expect(select).toHaveValue('720');
  });

  it('renders min-tabs select with correct value', () => {
    renderSettings();
    const select = screen.getByRole('combobox', { name: 'Minimum tabs' });
    expect(select).toHaveValue('20');
  });

  it('dispatches archiveAfterMinutes change', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSettings({ onChange });

    const select = screen.getByRole('combobox', { name: 'Archive after' });
    await user.selectOptions(select, '1440');

    expect(onChange).toHaveBeenCalledWith({ ...defaultSettings, archiveAfterMinutes: 1440 });
  });

  it('dispatches minTabs change', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSettings({ onChange });

    const select = screen.getByRole('combobox', { name: 'Minimum tabs' });
    await user.selectOptions(select, '10');

    expect(onChange).toHaveBeenCalledWith({ ...defaultSettings, minTabs: 10 });
  });

  it('displays stats when sendMessage returns ok', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      totalArchived: 150,
      totalRestored: 30,
      dbSizeBytes: 2048,
    });

    renderSettings({ sendMessage });

    await waitFor(() => {
      expect(screen.getByText('150')).toBeInTheDocument();
    });
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
  });

  it('does not display stats when sendMessage returns not ok', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: false });
    renderSettings({ sendMessage });

    // Give time for the effect to run
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText('Statistics')).not.toBeInTheDocument();
  });

  it('shows footer text about local storage', () => {
    renderSettings();
    expect(screen.getByText(/stored locally/)).toBeInTheDocument();
  });

  it('renders all archive-after options', () => {
    renderSettings();
    const select = screen.getByRole('combobox', { name: 'Archive after' });
    const options = select.querySelectorAll('option');
    expect(options).toHaveLength(4);
    expect(options[0]).toHaveTextContent('12 hours');
    expect(options[1]).toHaveTextContent('24 hours');
    expect(options[2]).toHaveTextContent('7 days');
    expect(options[3]).toHaveTextContent('30 days');
  });

  it('renders all min-tabs options', () => {
    renderSettings();
    const select = screen.getByRole('combobox', { name: 'Minimum tabs' });
    const options = select.querySelectorAll('option');
    expect(options).toHaveLength(4);
    expect(options[0]).toHaveTextContent('5 tabs');
    expect(options[1]).toHaveTextContent('10 tabs');
    expect(options[2]).toHaveTextContent('20 tabs');
    expect(options[3]).toHaveTextContent('50 tabs');
  });

  it('handles stats fetch failure gracefully', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('Network error'));
    renderSettings({ sendMessage });

    await act(async () => {
      await Promise.resolve();
    });

    // Should not crash, stats section should not appear
    expect(screen.queryByText('Statistics')).not.toBeInTheDocument();
  });

  it('shows "Unknown" db size when dbSizeBytes is missing', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      totalArchived: 5,
      totalRestored: 1,
    });

    renderSettings({ sendMessage });

    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument();
    });
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('exports archived tabs as JSON', async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        totalArchived: 2,
        totalRestored: 1,
        dbSizeBytes: 1024,
      })
      .mockResolvedValueOnce({
        ok: true,
        tabs: [{ id: 1, url: 'https://example.com', title: 'Example', closedAt: 1000 }],
        count: 1,
      });

    const createUrlSpy = vi.fn(() => 'blob:tabarchive');
    const revokeUrlSpy = vi.fn();
    const originalCreateObjectURL = (URL as any).createObjectURL;
    const originalRevokeObjectURL = (URL as any).revokeObjectURL;
    (URL as any).createObjectURL = createUrlSpy;
    (URL as any).revokeObjectURL = revokeUrlSpy;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderSettings({ sendMessage });

    await user.click(screen.getByRole('button', { name: 'Export archive data' }));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        action: 'export',
        includeRestored: true,
        chunkSize: 2000,
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
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        totalArchived: 4,
        totalRestored: 1,
        dbSizeBytes: 1024,
      })
      .mockResolvedValueOnce({ ok: true, deleted: 4 })
      .mockResolvedValueOnce({
        ok: true,
        totalArchived: 0,
        totalRestored: 5,
        dbSizeBytes: 512,
      });

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderSettings({ sendMessage });
    await user.click(screen.getByRole('button', { name: 'Clear archived tabs' }));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        action: 'clearAll',
        includeRestored: true,
      });
    });
    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByText('Deleted 4 archived tabs.')).toBeInTheDocument();
  });

  it('does not clear archived tabs when confirmation is canceled', async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      totalArchived: 2,
      totalRestored: 0,
      dbSizeBytes: 1024,
    });

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderSettings({ sendMessage });
    await user.click(screen.getByRole('button', { name: 'Clear archived tabs' }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalledWith({
      action: 'clearAll',
      includeRestored: true,
    });
  });

  it('resets settings to defaults', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    renderSettings({
      settings: { archiveAfterMinutes: 43200, paused: true, minTabs: 50 },
      onChange,
    });

    await user.click(screen.getByRole('button', { name: 'Reset settings' }));

    expect(onChange).toHaveBeenCalledWith({
      archiveAfterMinutes: 720,
      paused: false,
      minTabs: 20,
    });
    expect(screen.getByText('Settings reset to defaults.')).toBeInTheDocument();
  });
});

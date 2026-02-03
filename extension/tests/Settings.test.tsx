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
  it('renders pause toggle with correct initial state', () => {
    renderSettings();
    const toggle = screen.getByRole('switch', { name: 'Pause archiving' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
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

  it('toggles paused state on click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSettings({ onChange });

    const toggle = screen.getByRole('switch', { name: 'Pause archiving' });
    await user.click(toggle);

    expect(onChange).toHaveBeenCalledWith({ ...defaultSettings, paused: true });
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
});

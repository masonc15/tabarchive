import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TabItem } from '../popup/components/TabItem';
import type { ArchivedTab } from '../popup/types';

const tab: ArchivedTab = {
  id: 1,
  url: 'https://example.com/page',
  title: 'Example',
  closedAt: Date.now() - 60000,
  faviconUrl: 'https://example.com/favicon.ico',
};

describe('TabItem', () => {
  it('clears restoring state when restore fails', async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn().mockResolvedValue(false);

    render(<TabItem tab={tab} onRestore={onRestore} />);

    const restoreButton = screen.getByRole('button', { name: 'Restore tab' });
    expect(restoreButton).not.toBeDisabled();

    await act(async () => {
      await user.click(restoreButton);
    });

    await waitFor(() => {
      expect(restoreButton).not.toBeDisabled();
    });
  });

  it('renders tab title', () => {
    render(<TabItem tab={tab} onRestore={vi.fn()} />);
    expect(screen.getByText('Example')).toBeInTheDocument();
  });

  it('renders domain extracted from URL', () => {
    render(<TabItem tab={tab} onRestore={vi.fn()} />);
    expect(screen.getByText('example.com')).toBeInTheDocument();
  });

  it('renders time ago for closedAt', () => {
    render(<TabItem tab={tab} onRestore={vi.fn()} />);
    expect(screen.getByText('1m ago')).toBeInTheDocument();
  });

  it('renders "just now" for very recent tabs', () => {
    const recentTab = { ...tab, closedAt: Date.now() - 5000 };
    render(<TabItem tab={recentTab} onRestore={vi.fn()} />);
    expect(screen.getByText('just now')).toBeInTheDocument();
  });

  it('renders hours ago', () => {
    const hoursTab = { ...tab, closedAt: Date.now() - 7200000 };
    render(<TabItem tab={hoursTab} onRestore={vi.fn()} />);
    expect(screen.getByText('2h ago')).toBeInTheDocument();
  });

  it('renders days ago', () => {
    const daysTab = { ...tab, closedAt: Date.now() - 172800000 };
    render(<TabItem tab={daysTab} onRestore={vi.fn()} />);
    expect(screen.getByText('2d ago')).toBeInTheDocument();
  });

  it('renders "Untitled" when title is empty', () => {
    const untitledTab = { ...tab, title: '' };
    render(<TabItem tab={untitledTab} onRestore={vi.fn()} />);
    expect(screen.getByText('Untitled')).toBeInTheDocument();
  });

  it('shows favicon image when faviconUrl is provided', () => {
    render(<TabItem tab={tab} onRestore={vi.fn()} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://example.com/favicon.ico');
  });

  it('shows fallback SVG when faviconUrl is null', () => {
    const noFavicon = { ...tab, faviconUrl: null };
    render(<TabItem tab={noFavicon} onRestore={vi.fn()} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('strips www. from domain', () => {
    const wwwTab = { ...tab, url: 'https://www.example.com/page' };
    render(<TabItem tab={wwwTab} onRestore={vi.fn()} />);
    expect(screen.getByText('example.com')).toBeInTheDocument();
  });

  it('handles invalid URL gracefully for domain', () => {
    const badUrlTab = { ...tab, url: 'not-a-url' };
    render(<TabItem tab={badUrlTab} onRestore={vi.fn()} />);
    expect(screen.getByText('not-a-url')).toBeInTheDocument();
  });

  it('has accessible role and label', () => {
    render(<TabItem tab={tab} onRestore={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Restore tab: Example/ })).toBeInTheDocument();
  });

  it('triggers restore on Enter key', async () => {
    const onRestore = vi.fn().mockResolvedValue(true);
    render(<TabItem tab={tab} onRestore={onRestore} />);

    const item = screen.getByRole('button', { name: /Restore tab: Example/ });
    fireEvent.keyDown(item, { key: 'Enter' });

    await waitFor(() => {
      expect(onRestore).toHaveBeenCalledWith(tab);
    });
  });

  it('triggers restore on Space key', async () => {
    const onRestore = vi.fn().mockResolvedValue(true);
    render(<TabItem tab={tab} onRestore={onRestore} />);

    const item = screen.getByRole('button', { name: /Restore tab: Example/ });
    fireEvent.keyDown(item, { key: ' ' });

    await waitFor(() => {
      expect(onRestore).toHaveBeenCalledWith(tab);
    });
  });

  it('does not trigger restore on other keys', () => {
    const onRestore = vi.fn();
    render(<TabItem tab={tab} onRestore={onRestore} />);

    const item = screen.getByRole('button', { name: /Restore tab: Example/ });
    fireEvent.keyDown(item, { key: 'Tab' });

    expect(onRestore).not.toHaveBeenCalled();
  });

  it('clears restoring state when restore throws', async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn().mockRejectedValue(new Error('fail'));

    render(<TabItem tab={tab} onRestore={onRestore} />);

    const restoreButton = screen.getByRole('button', { name: 'Restore tab' });

    await act(async () => {
      await user.click(restoreButton);
    });

    await waitFor(() => {
      expect(restoreButton).not.toBeDisabled();
    });
  });

  it('disables restore button while restoring', async () => {
    let resolveRestore: (value: boolean) => void;
    const onRestore = vi.fn().mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveRestore = resolve;
      })
    );

    render(<TabItem tab={tab} onRestore={onRestore} />);

    const restoreButton = screen.getByRole('button', { name: 'Restore tab' });
    fireEvent.click(restoreButton);

    await waitFor(() => {
      expect(restoreButton).toBeDisabled();
    });

    await act(async () => {
      resolveRestore!(true);
    });
  });
});

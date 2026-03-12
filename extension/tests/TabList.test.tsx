import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TabList } from '../popup/components/TabList';
import type { ArchivedTab } from '../popup/types';

const makeTabs = (count: number): ArchivedTab[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    url: `https://example.com/page${i}`,
    title: `Tab ${i + 1}`,
    closedAt: Date.now() - (i + 1) * 60000,
    faviconUrl: null,
  }));

const paginationProps = { loadMore: vi.fn(), hasMore: false, loadingMore: false };

describe('TabList', () => {
  it('shows loading state with spinner text', () => {
    render(<TabList tabs={[]} loading={true} onRestore={vi.fn()} {...paginationProps} />);
    expect(screen.getByText('Searching...')).toBeInTheDocument();
  });

  it('shows empty state when no tabs and not loading', () => {
    render(<TabList tabs={[]} loading={false} onRestore={vi.fn()} {...paginationProps} />);
    expect(screen.getByText('No archived tabs found')).toBeInTheDocument();
    expect(
      screen.getByText(/Inactive tabs will be automatically archived/)
    ).toBeInTheDocument();
  });

  it('renders virtualized list when tabs are provided', () => {
    const tabs = makeTabs(5);
    render(<TabList tabs={tabs} loading={false} onRestore={vi.fn()} {...paginationProps} />);

    // react-window renders items that fit in the viewport
    // With 400px height and 54px items, ~7 items fit so all 5 should render
    expect(screen.getByText('Tab 1')).toBeInTheDocument();
    expect(screen.getByText('Tab 5')).toBeInTheDocument();
  });

  it('does not show loading or empty state when tabs exist', () => {
    const tabs = makeTabs(3);
    render(<TabList tabs={tabs} loading={false} onRestore={vi.fn()} {...paginationProps} />);

    expect(screen.queryByText('Searching...')).not.toBeInTheDocument();
    expect(screen.queryByText('No archived tabs found')).not.toBeInTheDocument();
  });

  it('shows loading state even when tabs are provided', () => {
    // loading takes precedence
    const tabs = makeTabs(3);
    render(<TabList tabs={tabs} loading={true} onRestore={vi.fn()} {...paginationProps} />);
    expect(screen.getByText('Searching...')).toBeInTheDocument();
  });

  it('does not leak restoring state to the next tab after removing a restored row', async () => {
    const tabs = makeTabs(2);
    const onRestore = vi.fn().mockResolvedValue(true);
    const { rerender } = render(
      <TabList tabs={tabs} loading={false} onRestore={onRestore} {...paginationProps} />
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Restore tab' })[0]);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Restore tab' })[0]).toBeDisabled();
    });

    await act(async () => {
      rerender(
        <TabList tabs={tabs.slice(1)} loading={false} onRestore={onRestore} {...paginationProps} />
      );
    });

    expect(screen.getByText('Tab 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore tab' })).not.toBeDisabled();
  });
});

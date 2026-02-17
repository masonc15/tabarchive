import { render, screen } from '@testing-library/react';
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
});

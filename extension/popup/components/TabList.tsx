import React, { memo, useCallback } from 'react';
import { FixedSizeList as List, ListChildComponentProps, ListOnItemsRenderedProps } from 'react-window';
import { TabItem } from './TabItem';
import type { ArchivedTab } from '../types';

interface TabListProps {
  tabs: ArchivedTab[];
  loading: boolean;
  onRestore: (tab: ArchivedTab) => Promise<boolean> | boolean;
  loadMore: () => void;
  hasMore: boolean;
  loadingMore: boolean;
}

interface ItemData {
  tabs: ArchivedTab[];
  onRestore: (tab: ArchivedTab) => Promise<boolean> | boolean;
}

const ITEM_HEIGHT = 54;
const LIST_HEIGHT = 400;
const LOAD_MORE_THRESHOLD = 10;

const Row = memo(({ index, style, data }: ListChildComponentProps<ItemData>) => {
  if (index >= data.tabs.length) {
    return (
      <div style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={loadingRowStyles.container}>
          <div style={loadingRowStyles.spinner} />
          <span style={loadingRowStyles.text}>Loading more...</span>
        </div>
      </div>
    );
  }
  return (
    <div style={style}>
      <TabItem tab={data.tabs[index]} onRestore={data.onRestore} />
    </div>
  );
});

export function TabList({ tabs, loading, onRestore, loadMore, hasMore, loadingMore }: TabListProps) {
  const itemData = React.useMemo(() => ({ tabs, onRestore }), [tabs, onRestore]);
  const itemCount = tabs.length + (hasMore ? 1 : 0);

  const handleItemsRendered = useCallback(({ visibleStopIndex }: ListOnItemsRenderedProps) => {
    if (hasMore && !loadingMore && visibleStopIndex >= tabs.length - LOAD_MORE_THRESHOLD) {
      loadMore();
    }
  }, [hasMore, loadingMore, tabs.length, loadMore]);

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>
          <div style={styles.spinner} />
          <span>Searching...</span>
        </div>
      </div>
    );
  }

  if (tabs.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.empty}>
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={styles.emptyIcon}
          >
            <path d="M3 3h18v18H3z" />
            <path d="M3 9h18" />
            <path d="M9 21V9" />
          </svg>
          <p style={styles.emptyText}>No archived tabs found</p>
          <p style={styles.emptyHint}>
            Inactive tabs will be automatically archived based on your settings
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <List
        height={LIST_HEIGHT}
        width="100%"
        itemCount={itemCount}
        itemSize={ITEM_HEIGHT}
        itemData={itemData}
        itemKey={(index, data) => (index >= data.tabs.length ? 'loading-more' : data.tabs[index].id)}
        onItemsRendered={handleItemsRendered}
      >
        {Row}
      </List>
    </div>
  );
}

const loadingRowStyles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    color: '#71717a',
    fontSize: '13px',
  },
  spinner: {
    width: '16px',
    height: '16px',
    border: '2px solid #3b3b5c',
    borderTopColor: '#7c7cff',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  text: {
    color: '#71717a',
  },
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  loading: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    color: '#71717a',
  },
  spinner: {
    width: '24px',
    height: '24px',
    border: '2px solid #3b3b5c',
    borderTopColor: '#7c7cff',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  empty: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px',
    textAlign: 'center',
  },
  emptyIcon: {
    color: '#3b3b5c',
    marginBottom: '16px',
  },
  emptyText: {
    fontSize: '15px',
    fontWeight: 500,
    color: '#a1a1aa',
    marginBottom: '8px',
  },
  emptyHint: {
    fontSize: '13px',
    color: '#71717a',
    lineHeight: 1.5,
  },
};

// Add keyframe animation via style element
if (typeof document !== 'undefined') {
  const existing = document.getElementById('tabarchive-keyframes');
  if (!existing) {
    const styleSheet = document.createElement('style');
    styleSheet.id = 'tabarchive-keyframes';
    styleSheet.textContent = `
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(styleSheet);
  }
}

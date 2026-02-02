import React, { useState } from 'react';
import type { ArchivedTab } from '../types';

interface TabItemProps {
  tab: ArchivedTab;
  onRestore: (tab: ArchivedTab) => Promise<boolean> | boolean;
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

export function TabItem({ tab, onRestore }: TabItemProps) {
  const [hovering, setHovering] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const handleRestore = async () => {
    setRestoring(true);
    try {
      const ok = await onRestore(tab);
      if (!ok) {
        setRestoring(false);
      }
    } catch {
      setRestoring(false);
    }
  };

  const handleClick = () => {
    handleRestore();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleRestore();
    }
  };

  return (
    <div
      style={{
        ...styles.container,
        ...(hovering ? styles.containerHover : {}),
      }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`Restore tab: ${tab.title}`}
    >
      <div style={styles.favicon}>
        {tab.faviconUrl ? (
          <img
            src={tab.faviconUrl}
            alt=""
            style={styles.faviconImg}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
            <path d="M2 12h20" />
          </svg>
        )}
      </div>

      <div style={styles.content}>
        <div style={styles.title}>
          {tab.title || 'Untitled'}
        </div>
        <div style={styles.meta}>
          <span style={styles.domain}>{getDomain(tab.url)}</span>
          <span style={styles.dot}>·</span>
          <span style={styles.time}>{formatTimeAgo(tab.closedAt)}</span>
        </div>
      </div>

      <button
        style={{
          ...styles.restoreButton,
          opacity: hovering || restoring ? 1 : 0,
        }}
        onClick={(e) => {
          e.stopPropagation();
          handleRestore();
        }}
        disabled={restoring}
        aria-label="Restore tab"
      >
        {restoring ? (
          <div style={styles.miniSpinner} />
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M8 16H3v5" />
          </svg>
        )}
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 16px',
    cursor: 'pointer',
    transition: 'background-color 0.1s ease',
  },
  containerHover: {
    backgroundColor: '#1f1f3a',
  },
  favicon: {
    width: '32px',
    height: '32px',
    borderRadius: '6px',
    backgroundColor: '#2d2d44',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#71717a',
    flexShrink: 0,
  },
  faviconImg: {
    width: '16px',
    height: '16px',
    borderRadius: '2px',
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#e4e4e7',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    marginBottom: '2px',
  },
  meta: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: '#71717a',
  },
  domain: {
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '150px',
  },
  dot: {
    flexShrink: 0,
  },
  time: {
    flexShrink: 0,
  },
  restoreButton: {
    padding: '8px',
    border: 'none',
    borderRadius: '6px',
    backgroundColor: '#3b3b5c',
    color: '#e4e4e7',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'opacity 0.15s ease, background-color 0.1s ease',
    flexShrink: 0,
  },
  miniSpinner: {
    width: '16px',
    height: '16px',
    border: '2px solid #52525b',
    borderTopColor: '#7c7cff',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
};

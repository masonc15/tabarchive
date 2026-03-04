import React, { useState, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import browser from 'webextension-polyfill';
import { SearchBar } from './components/SearchBar';
import { TabList } from './components/TabList';
import { Settings } from './components/Settings';
import { useNativeMessaging } from './hooks/useNativeMessaging';
import { ArchivedTab, AppSettings } from './types';

export type { ArchivedTab, AppSettings };

const PAGE_SIZE = 100;

type View = 'search' | 'settings';

type AppProps = {
  useNativeMessagingHook?: typeof useNativeMessaging;
};

export function App({ useNativeMessagingHook = useNativeMessaging }: AppProps = {}) {
  const [view, setView] = useState<View>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [tabs, setTabs] = useState<ArchivedTab[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const offsetRef = useRef(0);
  const searchQueryRef = useRef('');
  const loadingMoreRef = useRef(false);
  const [settings, setSettings] = useState<AppSettings>({
    archiveAfterMinutes: 720,
    paused: false,
    minTabs: 20,
  });

  const { sendMessage, search, restore, getRecent, getSettings, updateSettings, connected, error } = useNativeMessagingHook();

  React.useEffect(() => {
    void Promise.resolve(browser.runtime.sendMessage({ action: 'popupOpened' })).catch(() => {});
    return () => {
      void Promise.resolve(browser.runtime.sendMessage({ action: 'popupClosed' })).catch(() => {});
    };
  }, []);

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    searchQueryRef.current = query;
    setLoading(true);
    offsetRef.current = 0;

    try {
      const result = query.trim()
        ? await search(query, PAGE_SIZE)
        : await getRecent(PAGE_SIZE);
      setTabs(result.tabs);
      setHasMore(result.hasMore);
      offsetRef.current = result.tabs.length;
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setLoading(false);
    }
  }, [search, getRecent]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);

    try {
      const query = searchQueryRef.current;
      const result = query.trim()
        ? await search(query, PAGE_SIZE, offsetRef.current)
        : await getRecent(PAGE_SIZE, offsetRef.current);
      setTabs(prev => [...prev, ...result.tabs]);
      setHasMore(result.hasMore);
      offsetRef.current += result.tabs.length;
    } catch (err) {
      console.error('Load more failed:', err);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [search, getRecent]);

  const handleRestore = useCallback(async (tab: ArchivedTab): Promise<boolean> => {
    try {
      const ok = await restore(tab.id);
      if (!ok) {
        return false;
      }
      browser.tabs.create({ url: tab.url });
      setTabs(prev => prev.filter(t => t.id !== tab.id));
      return true;
    } catch (err) {
      console.error('Restore failed:', err);
      return false;
    }
  }, [restore]);

  const handleSettingsChange = useCallback(async (newSettings: AppSettings) => {
    setSettings(newSettings);
    await updateSettings(newSettings);
  }, [updateSettings]);

  React.useEffect(() => {
    if (connected) {
      getSettings().then(setSettings);
    }
  }, [connected, getSettings]);

  React.useEffect(() => {
    if (connected) {
      getRecent(PAGE_SIZE).then(result => {
        setTabs(result.tabs);
        setHasMore(result.hasMore);
        offsetRef.current = result.tabs.length;
      }).catch(err => console.error('Failed to load tabs:', err));
    }
  }, [connected, getRecent]);

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Tab Archive</h1>
        <nav style={styles.nav}>
          <button
            style={{
              ...styles.navButton,
              ...(view === 'search' ? styles.navButtonActive : {}),
            }}
            onClick={() => setView('search')}
          >
            Search
          </button>
          <button
            style={{
              ...styles.navButton,
              ...(view === 'settings' ? styles.navButtonActive : {}),
            }}
            onClick={() => setView('settings')}
          >
            Settings
          </button>
        </nav>
      </header>

      {error && (
        <div style={styles.error}>
          {error}
        </div>
      )}

      {!connected && !error && (
        <div style={styles.connecting}>
          Connecting to native host...
        </div>
      )}

      {view === 'search' && (
        <>
          <SearchBar
            value={searchQuery}
            onChange={handleSearch}
            disabled={!connected}
          />
          <TabList
            tabs={tabs}
            loading={loading}
            onRestore={handleRestore}
            loadMore={loadMore}
            hasMore={hasMore}
            loadingMore={loadingMore}
          />
        </>
      )}

      {view === 'settings' && (
        <Settings
          settings={settings}
          onChange={handleSettingsChange}
          sendMessage={sendMessage}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: '#1a1a2e',
  },
  header: {
    padding: '12px 16px',
    borderBottom: '1px solid #2d2d44',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#e4e4e7',
  },
  nav: {
    display: 'flex',
    gap: '8px',
  },
  navButton: {
    padding: '6px 12px',
    border: 'none',
    borderRadius: '6px',
    backgroundColor: 'transparent',
    color: '#a1a1aa',
    cursor: 'pointer',
    fontSize: '13px',
    transition: 'all 0.15s ease',
  },
  navButtonActive: {
    backgroundColor: '#3b3b5c',
    color: '#e4e4e7',
  },
  error: {
    padding: '12px 16px',
    backgroundColor: '#451a1a',
    color: '#fca5a5',
    fontSize: '13px',
  },
  connecting: {
    padding: '12px 16px',
    backgroundColor: '#1a3a4a',
    color: '#7dd3fc',
    fontSize: '13px',
  },
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}

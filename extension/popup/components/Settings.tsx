import React, { useCallback, useEffect, useState } from 'react';
import type { AppSettings } from '../types';

interface SettingsProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  sendMessage: (msg: Record<string, unknown>) => Promise<any>;
}

interface Stats {
  totalArchived: number;
  totalRestored: number;
  dbSize: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  archiveAfterMinutes: 720,
  paused: false,
  minTabs: 20,
};

const EXPORT_CHUNK_SIZE = 2000;

const archiveOptions = [
  { value: 720, label: '12 hours' },
  { value: 1440, label: '24 hours' },
  { value: 10080, label: '7 days' },
  { value: 43200, label: '30 days' },
];

const minTabsOptions = [
  { value: 5, label: '5 tabs' },
  { value: 10, label: '10 tabs' },
  { value: 20, label: '20 tabs' },
  { value: 50, label: '50 tabs' },
];

function formatDbSize(bytes?: number) {
  if (!bytes || bytes <= 0) {
    return 'Unknown';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return `${Math.round(value)} ${units[unitIndex]}`;
  }

  const formattedValue = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value < 10 ? 1 : 0,
    minimumFractionDigits: 0,
  }).format(value);

  return `${formattedValue} ${units[unitIndex]}`;
}

export function Settings({ settings, onChange, sendMessage }: SettingsProps) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [exporting, setExporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const refreshStats = useCallback(async () => {
    const response = await sendMessage({ action: 'stats' });
    if (!response?.ok) {
      return;
    }

    setStats({
      totalArchived: response.totalArchived ?? 0,
      totalRestored: response.totalRestored ?? 0,
      dbSize: formatDbSize(response.dbSizeBytes),
    });
  }, [sendMessage]);

  useEffect(() => {
    refreshStats().catch(() => {});
  }, [refreshStats]);

  const handleArchiveAfterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ ...settings, archiveAfterMinutes: parseInt(e.target.value, 10) });
  };

  const handleMinTabsChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ ...settings, minTabs: parseInt(e.target.value, 10) });
  };

  const handleResetSettings = () => {
    onChange(DEFAULT_SETTINGS);
    setActionMessage('Settings reset to defaults.');
  };

  const handleExport = async () => {
    if (exporting) {
      return;
    }

    setExporting(true);
    setActionMessage(null);
    try {
      const allTabs: Array<Record<string, unknown>> = [];
      let offset = 0;
      let loops = 0;

      while (true) {
        loops += 1;
        if (loops > 10000) {
          throw new Error('Export exceeded pagination safety limit');
        }

        const response = await sendMessage({
          action: 'export',
          includeRestored: true,
          chunkSize: EXPORT_CHUNK_SIZE,
          offset,
        });

        if (!response?.ok) {
          throw new Error(response?.error || 'Export failed');
        }

        const tabs = Array.isArray(response.tabs) ? response.tabs : [];
        allTabs.push(...tabs);

        if (!response.hasMore) {
          break;
        }

        if (typeof response.nextOffset === 'number') {
          offset = response.nextOffset;
        } else {
          offset += EXPORT_CHUNK_SIZE;
        }
      }

      const payload = {
        exportedAt: Date.now(),
        count: allTabs.length,
        tabs: allTabs,
      };
      const fileNameSafeTime = new Date().toISOString().replace(/[:.]/g, '-');
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `tabarchive-export-${fileNameSafeTime}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      setActionMessage(`Exported ${allTabs.length.toLocaleString()} tabs.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setActionMessage(`Export failed: ${message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleClearAll = async () => {
    if (clearing) {
      return;
    }

    const confirmed = window.confirm(
      'Delete all archived tabs from ~/.tabarchive/tabs.db? This cannot be undone.',
    );
    if (!confirmed) {
      return;
    }

    setClearing(true);
    setActionMessage(null);
    try {
      const response = await sendMessage({
        action: 'clearAll',
        includeRestored: true,
      });
      if (!response?.ok) {
        throw new Error(response?.error || 'Failed to clear archive');
      }

      await refreshStats();
      const deleted = Number(response.deleted) || 0;
      setActionMessage(`Deleted ${deleted.toLocaleString()} archived tabs.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setActionMessage(`Clear failed: ${message}`);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.section}>
        <div style={styles.settingRow}>
          <div style={styles.settingInfo}>
            <div style={styles.settingLabel}>Archive after</div>
            <div style={styles.settingDescription}>
              How long a tab must be inactive before archiving
            </div>
          </div>
          <select
            value={settings.archiveAfterMinutes}
            onChange={handleArchiveAfterChange}
            style={styles.select}
            aria-label="Archive after"
          >
            {archiveOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div style={styles.settingRow}>
          <div style={styles.settingInfo}>
            <div style={styles.settingLabel}>Minimum tabs</div>
            <div style={styles.settingDescription}>
              Keep at least this many tabs open
            </div>
          </div>
          <select
            value={settings.minTabs}
            onChange={handleMinTabsChange}
            style={styles.select}
            aria-label="Minimum tabs"
          >
            {minTabsOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {stats && (
        <div style={styles.statsSection}>
          <div style={styles.statsTitle}>Statistics</div>
          <div style={styles.statsGrid}>
            <div style={styles.statItem}>
              <div style={styles.statValue}>{stats.totalArchived.toLocaleString()}</div>
              <div style={styles.statLabel}>Archived</div>
            </div>
            <div style={styles.statItem}>
              <div style={styles.statValue}>{stats.totalRestored.toLocaleString()}</div>
              <div style={styles.statLabel}>Restored</div>
            </div>
            <div style={styles.statItem}>
              <div style={styles.statValue}>{stats.dbSize}</div>
              <div style={styles.statLabel}>Database</div>
            </div>
          </div>
        </div>
      )}

      <div style={styles.actionsSection}>
        <div style={styles.statsTitle}>Data</div>
        <div style={styles.actionsGrid}>
          <button
            style={styles.actionButton}
            onClick={handleExport}
            disabled={exporting || clearing}
            aria-label="Export archive data"
          >
            {exporting ? 'Exporting...' : 'Export JSON'}
          </button>
          <button
            style={{ ...styles.actionButton, ...styles.actionButtonDanger }}
            onClick={handleClearAll}
            disabled={exporting || clearing}
            aria-label="Clear archived tabs"
          >
            {clearing ? 'Clearing...' : 'Clear Archived Tabs'}
          </button>
          <button
            style={styles.actionButton}
            onClick={handleResetSettings}
            disabled={exporting || clearing}
            aria-label="Reset settings"
          >
            Reset Settings
          </button>
        </div>
        {actionMessage && <div style={styles.actionMessage}>{actionMessage}</div>}
      </div>

      <div style={styles.footer}>
        <p style={styles.footerText}>
          Archived tabs are stored locally in ~/.tabarchive/tabs.db and persist
          even if you clear browser data.
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'auto',
  },
  section: {
    padding: '8px 0',
  },
  settingRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px',
    gap: '16px',
  },
  settingInfo: {
    flex: 1,
  },
  settingLabel: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#e4e4e7',
    marginBottom: '4px',
  },
  settingDescription: {
    fontSize: '12px',
    color: '#71717a',
    lineHeight: 1.4,
  },
  select: {
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #3b3b5c',
    backgroundColor: '#16162a',
    color: '#e4e4e7',
    fontSize: '13px',
    cursor: 'pointer',
    outline: 'none',
    minWidth: '100px',
  },
  statsSection: {
    padding: '16px',
    borderTop: '1px solid #2d2d44',
  },
  statsTitle: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#71717a',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '12px',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '12px',
  },
  statItem: {
    backgroundColor: '#1f1f3a',
    borderRadius: '8px',
    padding: '12px',
    textAlign: 'center',
  },
  statValue: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#e4e4e7',
    marginBottom: '4px',
    lineHeight: 1.1,
    whiteSpace: 'nowrap',
  },
  statLabel: {
    fontSize: '11px',
    color: '#71717a',
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
  },
  actionsSection: {
    padding: '16px',
    borderTop: '1px solid #2d2d44',
  },
  actionsGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  actionButton: {
    border: '1px solid #3b3b5c',
    borderRadius: '8px',
    backgroundColor: '#1f1f3a',
    color: '#e4e4e7',
    fontSize: '13px',
    padding: '10px 12px',
    cursor: 'pointer',
    textAlign: 'left',
  },
  actionButtonDanger: {
    borderColor: '#6b2332',
    backgroundColor: '#3c1320',
    color: '#fecdd3',
  },
  actionMessage: {
    marginTop: '10px',
    fontSize: '12px',
    color: '#a1a1aa',
    lineHeight: 1.4,
  },
  footer: {
    marginTop: 'auto',
    padding: '16px',
    borderTop: '1px solid #2d2d44',
  },
  footerText: {
    fontSize: '12px',
    color: '#52525b',
    lineHeight: 1.5,
    textAlign: 'center',
  },
};

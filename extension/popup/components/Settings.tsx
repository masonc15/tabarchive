import React, { useEffect, useState } from 'react';
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

export function Settings({ settings, onChange, sendMessage }: SettingsProps) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    sendMessage({ action: 'stats' }).then((response) => {
      if (response?.ok) {
        const dbSizeKB = response.dbSizeBytes ? (response.dbSizeBytes / 1024).toFixed(1) + ' KB' : 'Unknown';
        setStats({
          totalArchived: response.totalArchived ?? 0,
          totalRestored: response.totalRestored ?? 0,
          dbSize: dbSizeKB,
        });
      }
    }).catch(() => {});
  }, [sendMessage]);

  const handleArchiveAfterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ ...settings, archiveAfterMinutes: parseInt(e.target.value, 10) });
  };

  const handleMinTabsChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ ...settings, minTabs: parseInt(e.target.value, 10) });
  };

  const handlePausedChange = () => {
    onChange({ ...settings, paused: !settings.paused });
  };

  return (
    <div style={styles.container}>
      <div style={styles.section}>
        <div style={styles.settingRow}>
          <div style={styles.settingInfo}>
            <div style={styles.settingLabel}>Pause archiving</div>
            <div style={styles.settingDescription}>
              Temporarily stop auto-archiving tabs
            </div>
          </div>
          <button
            style={{
              ...styles.toggle,
              backgroundColor: settings.paused ? '#7c7cff' : '#3b3b5c',
            }}
            onClick={handlePausedChange}
            role="switch"
            aria-checked={settings.paused}
          >
            <div
              style={{
                ...styles.toggleKnob,
                transform: settings.paused ? 'translateX(18px)' : 'translateX(2px)',
              }}
            />
          </button>
        </div>

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
  toggle: {
    width: '44px',
    height: '24px',
    borderRadius: '12px',
    border: 'none',
    cursor: 'pointer',
    position: 'relative',
    transition: 'background-color 0.2s ease',
    flexShrink: 0,
  },
  toggleKnob: {
    width: '20px',
    height: '20px',
    borderRadius: '10px',
    backgroundColor: '#ffffff',
    position: 'absolute',
    top: '2px',
    transition: 'transform 0.2s ease',
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
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
  },
  statLabel: {
    fontSize: '11px',
    color: '#71717a',
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
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

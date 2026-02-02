import { useState, useEffect, useCallback } from 'react';
import browser from 'webextension-polyfill';
import type { ArchivedTab, AppSettings } from '../types';

interface NativeResponse {
  ok: boolean;
  error?: string;
  tabs?: ArchivedTab[];
  url?: string;
  settings?: AppSettings;
  totalArchived?: number;
  totalRestored?: number;
  dbSizeBytes?: number;
  oldestClosedAt?: number | null;
  newestClosedAt?: number | null;
}

interface UseNativeMessagingResult {
  sendMessage: (message: Record<string, unknown>) => Promise<NativeResponse>;
  search: (query: string, limit?: number, offset?: number) => Promise<ArchivedTab[]>;
  restore: (id: number) => Promise<boolean>;
  deleteTab: (id: number) => Promise<boolean>;
  getRecent: (limit?: number, offset?: number) => Promise<ArchivedTab[]>;
  getStats: () => Promise<{ totalArchived: number; totalRestored: number; dbSizeBytes: number; oldestClosedAt?: number | null; newestClosedAt?: number | null }>;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
  archiveCurrentTab: () => Promise<boolean>;
  connected: boolean;
  error: string | null;
}

export function useNativeMessaging(): UseNativeMessagingResult {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(async (message: Record<string, unknown>): Promise<NativeResponse> => {
    try {
      const rawResponse = await browser.runtime.sendMessage(message);
      const response = rawResponse as NativeResponse | undefined;
      if (response?.error) {
        setError(response.error);
      } else {
        setError(null);
      }
      return response || { ok: false, error: 'No response' };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      return { ok: false, error: errorMessage };
    }
  }, []);

  const search = useCallback(async (query: string, limit = 50, offset = 0): Promise<ArchivedTab[]> => {
    const response = await sendMessage({ action: 'search', query, limit, offset });
    return response.ok && response.tabs ? response.tabs : [];
  }, [sendMessage]);

  const restore = useCallback(async (id: number): Promise<boolean> => {
    const response = await sendMessage({ action: 'restore', id });
    return response.ok === true;
  }, [sendMessage]);

  const deleteTab = useCallback(async (id: number): Promise<boolean> => {
    const response = await sendMessage({ action: 'delete', id });
    return response.ok === true;
  }, [sendMessage]);

  const getRecent = useCallback(async (limit = 50, offset = 0): Promise<ArchivedTab[]> => {
    const response = await sendMessage({ action: 'recent', limit, offset });
    return response.ok && response.tabs ? response.tabs : [];
  }, [sendMessage]);

  const getStats = useCallback(async () => {
    const response = await sendMessage({ action: 'stats' });
    return {
      totalArchived: response.totalArchived || 0,
      totalRestored: response.totalRestored || 0,
      dbSizeBytes: response.dbSizeBytes || 0,
      oldestClosedAt: response.oldestClosedAt,
      newestClosedAt: response.newestClosedAt,
    };
  }, [sendMessage]);

  const getSettings = useCallback(async (): Promise<AppSettings> => {
    const response = await sendMessage({ action: 'getSettings' });
    return response.settings || {
      archiveAfterMinutes: 720,
      paused: false,
      minTabs: 20,
    };
  }, [sendMessage]);

  const updateSettings = useCallback(async (settings: Partial<AppSettings>): Promise<AppSettings> => {
    const response = await sendMessage({ action: 'updateSettings', settings });
    return response.settings || {
      archiveAfterMinutes: 720,
      paused: false,
      minTabs: 20,
    };
  }, [sendMessage]);

  const archiveCurrentTab = useCallback(async (): Promise<boolean> => {
    const response = await sendMessage({ action: 'archiveTab' });
    return response.ok === true;
  }, [sendMessage]);

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const response = await sendMessage({ action: 'stats' });
        setConnected(response.ok === true);
        if (!response.ok && response.error) {
          setError(response.error);
        }
      } catch (err) {
        setConnected(false);
        setError(err instanceof Error ? err.message : 'Failed to connect');
      }
    };

    checkConnection();
  }, [sendMessage]);

  return {
    sendMessage,
    search,
    restore,
    deleteTab,
    getRecent,
    getStats,
    getSettings,
    updateSettings,
    archiveCurrentTab,
    connected,
    error,
  };
}

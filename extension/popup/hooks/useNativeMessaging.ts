import { useCallback, useEffect, useState } from 'react';
import browser from 'webextension-polyfill';
import { isFirefoxRuntime } from '../../runtime';
import type {
  AppSettings,
  ArchivedTab,
  ArchiveStats,
  ClearArchiveOptions,
  ConnectionState,
  ExportArchiveOptions,
  ExportedArchivedTab,
  PaginatedResult,
} from '../types';

type NativeFailure = {
  ok: false;
  error: string;
};

type NativeSuccess = {
  ok: true;
  [key: string]: unknown;
};

type NativeResponse = NativeFailure | NativeSuccess;

type RequestOptions = {
  trackConnection: boolean;
};

const DEFAULT_SETTINGS: AppSettings = {
  archiveAfterMinutes: 720,
  paused: false,
  minTabs: 20,
};

export interface UseNativeMessagingResult {
  search: (query: string, limit?: number, offset?: number) => Promise<PaginatedResult<ArchivedTab>>;
  restore: (id: number) => Promise<void>;
  deleteTab: (id: number) => Promise<void>;
  getRecent: (limit?: number, offset?: number) => Promise<PaginatedResult<ArchivedTab>>;
  getStats: () => Promise<ArchiveStats>;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
  archiveCurrentTab: () => Promise<void>;
  exportArchive: (options: ExportArchiveOptions) => Promise<PaginatedResult<ExportedArchivedTab>>;
  clearArchive: (options: ClearArchiveOptions) => Promise<number>;
  connection: ConnectionState;
}

function normalizeCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.floor(parsed));
}

function normalizeAppSettings(value: Partial<AppSettings> | undefined): AppSettings {
  const archiveAfterMinutes = Number(value?.archiveAfterMinutes);
  const minTabs = Number(value?.minTabs);

  return {
    archiveAfterMinutes: Number.isFinite(archiveAfterMinutes)
      ? Math.max(1, Math.floor(archiveAfterMinutes))
      : DEFAULT_SETTINGS.archiveAfterMinutes,
    paused: typeof value?.paused === 'boolean' ? value.paused : DEFAULT_SETTINGS.paused,
    minTabs: Number.isFinite(minTabs) ? Math.max(0, Math.floor(minTabs)) : DEFAULT_SETTINGS.minTabs,
  };
}

function normalizeOptionalTimestamp(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, Math.floor(parsed));
}

function normalizeFaviconUrl(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function normalizeArchivedTab(value: unknown): ArchivedTab | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const rawTab = value as Record<string, unknown>;
  const id = normalizeCount(rawTab.id);
  const url = typeof rawTab.url === 'string' ? rawTab.url : '';

  if (id <= 0 || !url) {
    return null;
  }

  return {
    id,
    url,
    title: typeof rawTab.title === 'string' && rawTab.title ? rawTab.title : url,
    faviconUrl: normalizeFaviconUrl(rawTab.faviconUrl),
    closedAt: normalizeCount(rawTab.closedAt),
  };
}

function normalizeExportedArchivedTab(value: unknown): ExportedArchivedTab | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const rawTab = value as Record<string, unknown>;
  const baseTab = normalizeArchivedTab(rawTab);
  if (!baseTab) {
    return null;
  }

  return {
    ...baseTab,
    restoredAt: normalizeOptionalTimestamp(rawTab.restoredAt),
    metadata: rawTab.metadata ?? null,
  };
}

function normalizePaginatedResult<T>(
  response: NativeSuccess,
  normalizeItem: (value: unknown) => T | null,
): PaginatedResult<T> {
  const tabs = Array.isArray(response.tabs)
    ? response.tabs.map(normalizeItem).filter((tab): tab is T => tab !== null)
    : [];

  return {
    tabs,
    hasMore: response.hasMore === true,
    nextOffset: response.hasMore === true && typeof response.nextOffset === 'number'
      ? response.nextOffset
      : null,
  };
}

export function useNativeMessaging(): UseNativeMessagingResult {
  const [connection, setConnection] = useState<ConnectionState>({ status: 'checking' });

  const normalizeNativeError = useCallback((message: string) => {
    if (isFirefoxRuntime() && /No such native application tabarchive/i.test(message)) {
      return 'Native host not installed for this Firefox add-on. Run ./native/install.sh --browser firefox, then reload the extension.';
    }

    return message;
  }, []);

  const rawSendMessage = useCallback(
    async (message: Record<string, unknown>): Promise<NativeResponse> => {
      try {
        const rawResponse = await browser.runtime.sendMessage(message);
        const response = (rawResponse as NativeResponse | undefined) ?? {
          ok: false,
          error: 'No response',
        };

        if (response.ok === true) {
          return response;
        }

        return {
          ok: false,
          error: normalizeNativeError(response.error || 'Unknown error'),
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        return { ok: false, error: normalizeNativeError(errorMessage) };
      }
    },
    [normalizeNativeError],
  );

  const request = useCallback(
    async (
      message: Record<string, unknown>,
      { trackConnection }: RequestOptions,
    ): Promise<NativeSuccess> => {
      const response = await rawSendMessage(message);

      if (response.ok) {
        if (trackConnection) {
          setConnection({ status: 'connected' });
        }
        return response;
      }

      if (trackConnection) {
        setConnection({ status: 'disconnected', message: response.error });
      }
      throw new Error(response.error);
    },
    [rawSendMessage],
  );

  const requestTracked = useCallback(
    (message: Record<string, unknown>) => request(message, { trackConnection: true }),
    [request],
  );

  const requestLocal = useCallback(
    (message: Record<string, unknown>) => request(message, { trackConnection: false }),
    [request],
  );

  const search = useCallback(
    async (query: string, limit = 100, offset = 0): Promise<PaginatedResult<ArchivedTab>> => {
      const response = await requestTracked({ action: 'search', query, limit, offset });
      return normalizePaginatedResult(response, normalizeArchivedTab);
    },
    [requestTracked],
  );

  const restore = useCallback(
    async (id: number): Promise<void> => {
      await requestTracked({ action: 'restore', id });
    },
    [requestTracked],
  );

  const deleteTab = useCallback(
    async (id: number): Promise<void> => {
      await requestTracked({ action: 'delete', id });
    },
    [requestTracked],
  );

  const getRecent = useCallback(
    async (limit = 100, offset = 0): Promise<PaginatedResult<ArchivedTab>> => {
      const response = await requestTracked({ action: 'recent', limit, offset });
      return normalizePaginatedResult(response, normalizeArchivedTab);
    },
    [requestTracked],
  );

  const getStats = useCallback(async (): Promise<ArchiveStats> => {
    const response = await requestTracked({ action: 'stats' });
    return {
      totalArchived: normalizeCount(response.totalArchived),
      totalRestored: normalizeCount(response.totalRestored),
      dbSizeBytes: normalizeCount(response.dbSizeBytes),
      oldestClosedAt: normalizeOptionalTimestamp(response.oldestClosedAt),
      newestClosedAt: normalizeOptionalTimestamp(response.newestClosedAt),
    };
  }, [requestTracked]);

  const getSettings = useCallback(async (): Promise<AppSettings> => {
    try {
      const response = await requestLocal({ action: 'getSettings' });
      return normalizeAppSettings(response.settings as Partial<AppSettings> | undefined);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }, [requestLocal]);

  const updateSettings = useCallback(
    async (settings: Partial<AppSettings>): Promise<AppSettings> => {
      try {
        const response = await requestLocal({ action: 'updateSettings', settings });
        return normalizeAppSettings(response.settings as Partial<AppSettings> | undefined);
      } catch {
        return { ...DEFAULT_SETTINGS };
      }
    },
    [requestLocal],
  );

  const archiveCurrentTab = useCallback(async (): Promise<void> => {
    await requestTracked({ action: 'archiveTab' });
  }, [requestTracked]);

  const exportArchive = useCallback(
    async (options: ExportArchiveOptions): Promise<PaginatedResult<ExportedArchivedTab>> => {
      const response = await requestTracked({
        action: 'export',
        includeRestored: options.includeRestored,
        chunkSize: options.chunkSize,
        offset: options.offset,
      });
      return normalizePaginatedResult(response, normalizeExportedArchivedTab);
    },
    [requestTracked],
  );

  const clearArchive = useCallback(
    async (options: ClearArchiveOptions): Promise<number> => {
      const response = await requestTracked({
        action: 'clearAll',
        includeRestored: options.includeRestored,
      });
      return normalizeCount(response.deleted);
    },
    [requestTracked],
  );

  useEffect(() => {
    getStats().catch(() => {});
  }, [getStats]);

  return {
    search,
    restore,
    deleteTab,
    getRecent,
    getStats,
    getSettings,
    updateSettings,
    archiveCurrentTab,
    exportArchive,
    clearArchive,
    connection,
  };
}

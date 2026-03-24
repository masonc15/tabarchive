export interface ArchivedTab {
  id: number;
  url: string;
  title: string;
  faviconUrl: string | null;
  closedAt: number;
}

export interface ExportedArchivedTab extends ArchivedTab {
  restoredAt: number | null;
  metadata: unknown | null;
}

export interface AppSettings {
  archiveAfterMinutes: number;
  paused: boolean;
  minTabs: number;
}

export interface PaginatedResult<T> {
  tabs: T[];
  hasMore: boolean;
  nextOffset: number | null;
}

export interface ArchiveStats {
  totalArchived: number;
  totalRestored: number;
  dbSizeBytes: number;
  oldestClosedAt: number | null;
  newestClosedAt: number | null;
}

export type ConnectionState =
  | { status: 'checking' }
  | { status: 'connected' }
  | { status: 'disconnected'; message: string };

export interface ExportArchiveOptions {
  includeRestored: boolean;
  chunkSize: number;
  offset: number;
}

export interface ClearArchiveOptions {
  includeRestored: boolean;
}

export interface ArchivedTab {
  id: number;
  url: string;
  title: string;
  faviconUrl?: string | null;
  closedAt: number;
  restoredAt?: number | null;
}

export interface AppSettings {
  archiveAfterMinutes: number;
  paused: boolean;
  minTabs: number;
}

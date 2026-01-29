export interface ArchivedTab {
  id: number;
  url: string;
  title: string;
  favicon_url?: string;
  closed_at: number;
}

export interface AppSettings {
  archiveAfterMinutes: number;
  paused: boolean;
  minTabs: number;
}

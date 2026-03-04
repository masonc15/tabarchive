import browser from 'webextension-polyfill';
import type { AppSettings } from './popup/types';

declare const __TABARCHIVE_TEST__: boolean | undefined;

const NATIVE_HOST_NAME = 'tabarchive';
const NATIVE_REQUEST_TIMEOUT_MS = 30000;
const INACTIVE_CHECK_INTERVAL_MS = 60000;
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const BADGE_BACKGROUND_COLOR = '#1b4d9b';
const BADGE_MAX_DISPLAY_COUNT = 999;
const BADGE_VIEW_DWELL_MS = 1500;
const BADGE_LAST_SEEN_STORAGE_KEY = 'badgeLastSeenAt';

const DEFAULT_SETTINGS: AppSettings = {
  archiveAfterMinutes: 720,
  paused: false,
  minTabs: 20,
};

const IS_TEST =
  (typeof __TABARCHIVE_TEST__ !== 'undefined' && __TABARCHIVE_TEST__ === true) ||
  (typeof globalThis !== 'undefined' && (globalThis as any).__TABARCHIVE_TEST__ === true);

let settings: AppSettings = { ...DEFAULT_SETTINGS };
let port: browser.Port | null = null;
let tabLastActive: Map<number, number> = new Map();
type PendingRequest = {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

let pendingRequests = new Map<number, PendingRequest>();
let requestId = 0;
let reconnectAttempts = 0;
let inactiveCheckInProgress = false;
let archivedCount = 0;
let badgeStyleInitialized = false;
let badgeLastSeenAt = 0;
let popupOpen = false;
let popupViewDwellTimer: ReturnType<typeof setTimeout> | null = null;

const mockState = IS_TEST ? createMockState() : null;

let nativeMessageHandler: (message: Record<string, any>) => Promise<any> = realSendNativeMessage;

if (IS_TEST && mockState) {
  nativeMessageHandler = mockState.handleMessage;
}

export function setNativeMessageHandlerForTests(handler: (message: Record<string, any>) => Promise<any>) {
  nativeMessageHandler = handler;
}

export function resetStateForTests() {
  if (popupViewDwellTimer) {
    clearTimeout(popupViewDwellTimer);
    popupViewDwellTimer = null;
  }
  settings = { ...DEFAULT_SETTINGS };
  port = null;
  tabLastActive = new Map();
  pendingRequests = new Map();
  requestId = 0;
  reconnectAttempts = 0;
  inactiveCheckInProgress = false;
  archivedCount = 0;
  badgeStyleInitialized = false;
  badgeLastSeenAt = 0;
  popupOpen = false;
  if (IS_TEST && mockState) {
    mockState.reset();
    nativeMessageHandler = mockState.handleMessage;
  } else {
    nativeMessageHandler = realSendNativeMessage;
  }
}

export function setSettingsForTests(next: AppSettings) {
  settings = normalizeSettings(next);
}

export function setTabLastActiveForTests(next: Map<number, number>) {
  tabLastActive = next;
}

export function normalizeSettings(input: Partial<AppSettings>): AppSettings {
  const archiveAfterMinutes = Number.isFinite(input.archiveAfterMinutes)
    ? Math.max(1, Math.floor(input.archiveAfterMinutes as number))
    : DEFAULT_SETTINGS.archiveAfterMinutes;
  const minTabs = Number.isFinite(input.minTabs)
    ? Math.max(0, Math.floor(input.minTabs as number))
    : DEFAULT_SETTINGS.minTabs;
  const paused = typeof input.paused === 'boolean' ? input.paused : DEFAULT_SETTINGS.paused;

  return {
    archiveAfterMinutes,
    paused,
    minTabs,
  };
}

function normalizeArchivedCount(input: unknown): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.floor(parsed));
}

function normalizeTimestamp(input: unknown): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.floor(parsed));
}

function formatBadgeText(count: number): string {
  if (count > BADGE_MAX_DISPLAY_COUNT) {
    return `${BADGE_MAX_DISPLAY_COUNT}+`;
  }
  return String(count);
}

async function ensureBadgeStyle() {
  if (badgeStyleInitialized) {
    return;
  }
  await browser.action.setBadgeBackgroundColor({ color: BADGE_BACKGROUND_COLOR });
  badgeStyleInitialized = true;
}

async function setArchivedBadgeCount(count: number) {
  archivedCount = normalizeArchivedCount(count);
  try {
    await ensureBadgeStyle();
    await browser.action.setBadgeText({ text: formatBadgeText(archivedCount) });
  } catch (e) {
    console.error('Failed to update extension badge:', e);
  }
}

async function adjustArchivedBadgeCount(delta: number) {
  await setArchivedBadgeCount(archivedCount + delta);
}

function getBadgeStatsRequestPayload() {
  return {
    action: 'stats',
    sinceClosedAt: badgeLastSeenAt,
  };
}

function getUnseenBadgeCountFromStatsResponse(response: Record<string, any>): number {
  if (typeof response.unseenArchived === 'number') {
    return normalizeArchivedCount(response.unseenArchived);
  }
  return normalizeArchivedCount(response.totalArchived);
}

async function syncArchivedBadgeCountFromNative() {
  try {
    const response = await sendNativeMessage(getBadgeStatsRequestPayload());
    if (response?.ok) {
      await setArchivedBadgeCount(getUnseenBadgeCountFromStatsResponse(response));
    }
  } catch (e) {
    console.error('Failed to sync archived count badge:', e);
  }
}

async function loadBadgeLastSeenAt() {
  try {
    const stored = await browser.storage.local.get({ [BADGE_LAST_SEEN_STORAGE_KEY]: 0 });
    badgeLastSeenAt = normalizeTimestamp(stored[BADGE_LAST_SEEN_STORAGE_KEY]);
  } catch (e) {
    console.error('Failed to load badge last-seen timestamp:', e);
  }
}

async function markBadgeSeen() {
  const seenAt = Date.now();
  badgeLastSeenAt = seenAt;
  try {
    await browser.storage.local.set({ [BADGE_LAST_SEEN_STORAGE_KEY]: seenAt });
  } catch (e) {
    console.error('Failed to persist badge last-seen timestamp:', e);
  }
  await setArchivedBadgeCount(0);
}

function clearPopupDwellTimer() {
  if (!popupViewDwellTimer) {
    return;
  }
  clearTimeout(popupViewDwellTimer);
  popupViewDwellTimer = null;
}

function handlePopupOpened() {
  popupOpen = true;
  clearPopupDwellTimer();
  popupViewDwellTimer = setTimeout(() => {
    popupViewDwellTimer = null;
    if (!popupOpen) {
      return;
    }
    void markBadgeSeen();
  }, BADGE_VIEW_DWELL_MS);
}

function handlePopupClosed() {
  popupOpen = false;
  clearPopupDwellTimer();
}

async function loadSettings() {
  try {
    const stored = await browser.storage.sync.get(DEFAULT_SETTINGS);
    settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...stored });
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

function connectNative() {
  if (port) {
    return port;
  }

  try {
    port = browser.runtime.connectNative(NATIVE_HOST_NAME);
    console.log('Connected to native host');

    const connectedPort = port;
    if (!connectedPort) {
      return null;
    }

    connectedPort.onMessage.addListener((message: any) => {
      if (message.requestId && pendingRequests.has(message.requestId)) {
        const { resolve, timeoutId } = pendingRequests.get(message.requestId)!;
        clearTimeout(timeoutId);
        pendingRequests.delete(message.requestId);
        resolve(message);
      }
    });

    connectedPort.onDisconnect.addListener(() => {
      const error = (connectedPort as any).error?.message || browser.runtime.lastError?.message;
      console.log('Disconnected from native host:', error);
      port = null;
      pendingRequests.forEach(({ reject, timeoutId }) => {
        clearTimeout(timeoutId);
        reject(new Error('Native host disconnected: ' + (error || 'unknown')));
      });
      pendingRequests.clear();

      const delay = Math.min(BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY_MS);
      reconnectAttempts += 1;
      setTimeout(() => connectNative(), delay);
    });

    reconnectAttempts = 0;
    return connectedPort;
  } catch (e) {
    console.error('Failed to connect to native host:', e);
    const delay = Math.min(BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY_MS);
    reconnectAttempts += 1;
    setTimeout(() => connectNative(), delay);
    return null;
  }
}

async function realSendNativeMessage(message: Record<string, any>, retriesLeft = 2): Promise<any> {
  return new Promise((resolve, reject) => {
    const p = connectNative();
    if (!p) {
      if (retriesLeft > 0) {
        setTimeout(() => {
          realSendNativeMessage(message, retriesLeft - 1).then(resolve, reject);
        }, 500);
        return;
      }
      reject(new Error('Failed to connect to native host'));
      return;
    }

    const id = ++requestId;
    message.requestId = id;

    const timeoutId = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error('Native host request timeout'));
      }
    }, NATIVE_REQUEST_TIMEOUT_MS);

    pendingRequests.set(id, { resolve, reject, timeoutId });

    try {
      p.postMessage(message);
    } catch (e) {
      clearTimeout(timeoutId);
      pendingRequests.delete(id);
      reject(e as Error);
    }
  });
}

function sendNativeMessage(message: Record<string, any>) {
  return nativeMessageHandler(message);
}

async function archiveTab(tab: browser.tabs.Tab) {
  if (!tab.url || tab.url.startsWith('about:') || tab.url.startsWith('moz-extension:')) {
    return;
  }

  if (!tab.id) {
    return;
  }

  try {
    const response = await sendNativeMessage({
      action: 'archive',
      url: tab.url,
      title: tab.title || tab.url,
      faviconUrl: tab.favIconUrl || null,
    });

    if (response.ok) {
      await browser.tabs.remove(tab.id);
      tabLastActive.delete(tab.id);
      await adjustArchivedBadgeCount(1);
      console.log('Archived tab:', tab.title);
    }
  } catch (e) {
    console.error('Failed to archive tab:', e);
  }
}

export async function checkInactiveTabs() {
  if (inactiveCheckInProgress) {
    return;
  }
  inactiveCheckInProgress = true;

  try {
    if (settings.paused) {
      return;
    }

    const thresholdMs = settings.archiveAfterMinutes * 60 * 1000;
    const now = Date.now();

    const tabs = (await browser.tabs.query({})) as browser.tabs.Tab[];

    const activeTabIds = new Set(
      tabs.map((t: browser.tabs.Tab) => t.id).filter(Boolean) as number[],
    );
    for (const tabId of tabLastActive.keys()) {
      if (!activeTabIds.has(tabId)) {
        tabLastActive.delete(tabId);
      }
    }

    if (tabs.length <= settings.minTabs) {
      return;
    }

    const sortedTabs = tabs
      .filter((tab: browser.tabs.Tab) => !tab.pinned && !tab.active && tab.id)
      .map((tab: browser.tabs.Tab) => ({
        tab,
        lastActive: tabLastActive.get(tab.id!) || now,
      }))
      .sort((a: { lastActive: number }, b: { lastActive: number }) => a.lastActive - b.lastActive);

    const tabsToArchive = sortedTabs.filter(
      ({ lastActive }: { lastActive: number }) => now - lastActive > thresholdMs,
    );
    const maxToArchive = Math.max(0, tabs.length - settings.minTabs);

    for (let i = 0; i < Math.min(tabsToArchive.length, maxToArchive); i++) {
      await archiveTab(tabsToArchive[i].tab);
    }
  } catch (e) {
    console.error('Failed to check inactive tabs:', e);
  } finally {
    inactiveCheckInProgress = false;
  }
}

browser.tabs.onActivated.addListener(({ tabId }: { tabId: number }) => {
  tabLastActive.set(tabId, Date.now());
});

browser.tabs.onUpdated.addListener((tabId: number, changeInfo: { status?: string }) => {
  if (changeInfo.status === 'complete') {
    tabLastActive.set(tabId, Date.now());
  }
});

browser.tabs.onRemoved.addListener((tabId: number) => {
  tabLastActive.delete(tabId);
});

export function onMessageHandler(message: Record<string, any>) {
  return handleMessage(message).catch((err) => ({
    ok: false,
    error: err instanceof Error ? err.message : 'Unknown error',
  }));
}

browser.runtime.onMessage.addListener(onMessageHandler);

async function handleMessage(message: Record<string, any>) {
  if (IS_TEST && mockState && message.action === '__testSeed') {
    mockState.seed(message.tabs || []);
    return { ok: true };
  }

  if (IS_TEST && mockState && message.action === '__testReset') {
    mockState.reset();
    return { ok: true };
  }

  switch (message.action) {
    case 'search':
      return sendNativeMessage({
        action: 'search',
        query: message.query,
        limit: message.limit || 50,
        offset: message.offset || 0,
      });

    case 'recent':
      return sendNativeMessage({
        action: 'recent',
        limit: message.limit || 50,
        offset: message.offset || 0,
      });

    case 'restore':
      try {
        const response = await sendNativeMessage({
          action: 'restore',
          id: message.id,
        });
        if (response?.ok) {
          await syncArchivedBadgeCountFromNative();
        }
        return response;
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }

    case 'delete': {
      const response = await sendNativeMessage({
        action: 'delete',
        id: message.id,
      });
      if (response?.ok) {
        await syncArchivedBadgeCountFromNative();
      }
      return response;
    }

    case 'stats': {
      const response = await sendNativeMessage(getBadgeStatsRequestPayload());
      if (response?.ok) {
        await setArchivedBadgeCount(getUnseenBadgeCountFromStatsResponse(response));
      }
      return response;
    }

    case 'popupOpened':
      handlePopupOpened();
      return { ok: true };

    case 'popupClosed':
      handlePopupClosed();
      return { ok: true };

    case 'export':
      return sendNativeMessage({
        action: 'export',
        includeRestored: message.includeRestored,
        chunkSize: message.chunkSize,
        offset: message.offset,
      });

    case 'clearAll': {
      const response = await sendNativeMessage({
        action: 'clear',
        includeRestored: message.includeRestored,
      });
      if (response?.ok) {
        await setArchivedBadgeCount(0);
      }
      return response;
    }

    case 'getSettings':
      return { ok: true, settings };

    case 'updateSettings':
      settings = normalizeSettings({ ...settings, ...(message.settings || {}) });
      await browser.storage.sync.set(settings);
      return { ok: true, settings };

    case 'archiveTab': {
      const tabs = (await browser.tabs.query({ active: true, currentWindow: true })) as browser.tabs.Tab[];
      if (tabs[0]) {
        await archiveTab(tabs[0]);
        return { ok: true };
      }
      return { ok: false, error: 'No active tab' };
    }

    default:
      return { ok: false, error: 'Unknown action' };
  }
}

async function init() {
  await loadSettings();
  await loadBadgeLastSeenAt();

  const tabs = (await browser.tabs.query({})) as browser.tabs.Tab[];
  const now = Date.now();
  tabs.forEach((tab) => {
    if (tab.id && !tabLastActive.has(tab.id)) {
      tabLastActive.set(tab.id, now);
    }
  });

  await setArchivedBadgeCount(0);
  await syncArchivedBadgeCountFromNative();

  if (!IS_TEST) {
    connectNative();
    setInterval(checkInactiveTabs, INACTIVE_CHECK_INTERVAL_MS);
  }

  console.log('Tab Archive initialized');
}

browser.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, area: string) => {
  if (area === 'sync') {
    const updated: Partial<AppSettings> = {};
    for (const key of Object.keys(changes)) {
      if (key in settings) {
        (updated as any)[key] = changes[key].newValue;
      }
    }
    if (Object.keys(updated).length > 0) {
      settings = normalizeSettings({ ...settings, ...updated });
    }
  }
});

if (!IS_TEST) {
  init();
}

function createMockState() {
  let tabs: Array<Record<string, any>> = [];

  function seed(nextTabs: Array<Record<string, any>>) {
    tabs = nextTabs.map((tab) => ({
      id: tab.id,
      url: tab.url,
      title: tab.title || tab.url,
      faviconUrl: tab.faviconUrl || null,
      closedAt: tab.closedAt || Date.now(),
      restoredAt: tab.restoredAt || null,
    }));
  }

  function reset() {
    tabs = [];
  }

  function listActive() {
    return tabs.filter((tab) => !tab.restoredAt);
  }

  async function handleMessage(message: Record<string, any>) {
    switch (message.action) {
      case 'archive': {
        const incoming = message.tabs ?? [message];
        for (const tab of incoming) {
          tabs.push({
            id: tab.id ?? Date.now() + Math.floor(Math.random() * 1000),
            url: tab.url,
            title: tab.title || tab.url,
            faviconUrl: tab.faviconUrl || null,
            closedAt: tab.closedAt || Date.now(),
            restoredAt: null,
          });
        }
        return { ok: true, archived: incoming.length };
      }

      case 'search': {
        const query = String(message.query || '').toLowerCase();
        const filtered = query
          ? listActive().filter((tab) =>
              tab.title.toLowerCase().includes(query) || tab.url.toLowerCase().includes(query),
            )
          : listActive();
        const offset = message.offset || 0;
        const limit = message.limit || 50;
        const result = filtered.slice(offset, offset + limit);
        return { ok: true, tabs: result, count: result.length };
      }

      case 'recent': {
        const offset = message.offset || 0;
        const limit = message.limit || 50;
        const result = listActive().slice(offset, offset + limit);
        return { ok: true, tabs: result, count: result.length };
      }

      case 'restore': {
        const id = message.id;
        const tab = tabs.find((t) => t.id === id && !t.restoredAt);
        if (tab) {
          tab.restoredAt = Date.now();
          return { ok: true, restored: 1, url: tab.url };
        }
        return { ok: false, error: 'Not found' };
      }

      case 'delete': {
        const before = tabs.length;
        tabs = tabs.filter((t) => t.id !== message.id);
        return { ok: true, deleted: before - tabs.length };
      }

      case 'clear': {
        const includeRestored = message.includeRestored !== false;
        const before = tabs.length;
        tabs = includeRestored ? [] : tabs.filter((t) => t.restoredAt);
        return { ok: true, deleted: before - tabs.length };
      }

      case 'stats': {
        const active = listActive();
        const closedTimes = active.map((t) => t.closedAt);
        const sinceClosedAt = normalizeTimestamp(message.sinceClosedAt);
        const unseenArchived = active.filter((tab) => tab.closedAt > sinceClosedAt).length;
        return {
          ok: true,
          totalArchived: active.length,
          totalRestored: tabs.length - active.length,
          totalAll: tabs.length,
          oldestClosedAt: closedTimes.length ? Math.min(...closedTimes) : null,
          newestClosedAt: closedTimes.length ? Math.max(...closedTimes) : null,
          dbPath: 'mock',
          dbSizeBytes: 0,
          unseenArchived,
        };
      }

      case 'export':
        return { ok: true, tabs: listActive(), count: listActive().length };

      default:
        return { ok: false, error: `Unknown action: ${message.action}` };
    }
  }

  return { seed, reset, handleMessage };
}

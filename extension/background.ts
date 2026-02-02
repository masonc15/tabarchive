import browser from 'webextension-polyfill';
import type { AppSettings } from './popup/types';

declare const __TABARCHIVE_TEST__: boolean | undefined;

const NATIVE_HOST_NAME = 'tabarchive';
const NATIVE_REQUEST_TIMEOUT_MS = 30000;
const INACTIVE_CHECK_INTERVAL_MS = 60000;
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;

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

const mockState = IS_TEST ? createMockState() : null;

let nativeMessageHandler: (message: Record<string, any>) => Promise<any> = realSendNativeMessage;

if (IS_TEST && mockState) {
  nativeMessageHandler = mockState.handleMessage;
}

export function setNativeMessageHandlerForTests(handler: (message: Record<string, any>) => Promise<any>) {
  nativeMessageHandler = handler;
}

export function resetStateForTests() {
  settings = { ...DEFAULT_SETTINGS };
  port = null;
  tabLastActive = new Map();
  pendingRequests = new Map();
  requestId = 0;
  reconnectAttempts = 0;
  inactiveCheckInProgress = false;
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
      const error = browser.runtime.lastError?.message;
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

async function realSendNativeMessage(message: Record<string, any>) {
  return new Promise((resolve, reject) => {
    const p = connectNative();
    if (!p) {
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
        return response;
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }

    case 'delete':
      return sendNativeMessage({
        action: 'delete',
        id: message.id,
      });

    case 'stats':
      return sendNativeMessage({ action: 'stats' });

    case 'export':
      return sendNativeMessage({ action: 'export' });

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

  const tabs = (await browser.tabs.query({})) as browser.tabs.Tab[];
  const now = Date.now();
  tabs.forEach((tab) => {
    if (tab.id && !tabLastActive.has(tab.id)) {
      tabLastActive.set(tab.id, now);
    }
  });

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

      case 'stats': {
        const active = listActive();
        const closedTimes = active.map((t) => t.closedAt);
        return {
          ok: true,
          totalArchived: active.length,
          totalRestored: tabs.length - active.length,
          totalAll: tabs.length,
          oldestClosedAt: closedTimes.length ? Math.min(...closedTimes) : null,
          newestClosedAt: closedTimes.length ? Math.max(...closedTimes) : null,
          dbPath: 'mock',
          dbSizeBytes: 0,
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

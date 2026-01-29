const NATIVE_HOST_NAME = "tabarchive";
const NATIVE_REQUEST_TIMEOUT_MS = 30000;
const INACTIVE_CHECK_INTERVAL_MS = 60000;
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;

const DEFAULT_SETTINGS = {
  archiveAfterMinutes: 720,
  paused: false,
  minTabs: 20
};

let settings = { ...DEFAULT_SETTINGS };
let port = null;
let tabLastActive = new Map();
let pendingRequests = new Map();
let requestId = 0;
let reconnectAttempts = 0;

async function loadSettings() {
  try {
    const stored = await browser.storage.sync.get(DEFAULT_SETTINGS);
    settings = { ...DEFAULT_SETTINGS, ...stored };
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
}

function connectNative() {
  if (port) {
    return port;
  }

  try {
    port = browser.runtime.connectNative(NATIVE_HOST_NAME);
    console.log("Connected to native host");

    port.onMessage.addListener((message) => {
      if (message.requestId && pendingRequests.has(message.requestId)) {
        const { resolve, timeoutId } = pendingRequests.get(message.requestId);
        clearTimeout(timeoutId);
        pendingRequests.delete(message.requestId);
        resolve(message);
      }
    });

    port.onDisconnect.addListener((p) => {
      const error = p?.error?.message || browser.runtime.lastError?.message;
      console.log("Disconnected from native host:", error);
      port = null;
      pendingRequests.forEach(({ reject, timeoutId }) => {
        clearTimeout(timeoutId);
        reject(new Error("Native host disconnected: " + (error || "unknown")));
      });
      pendingRequests.clear();

      const delay = Math.min(BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY_MS);
      reconnectAttempts++;
      setTimeout(() => connectNative(), delay);
    });

    reconnectAttempts = 0;
    return port;
  } catch (e) {
    console.error("Failed to connect to native host:", e);
    const delay = Math.min(BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY_MS);
    reconnectAttempts++;
    setTimeout(() => connectNative(), delay);
    return null;
  }
}

function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    const p = connectNative();
    if (!p) {
      reject(new Error("Failed to connect to native host"));
      return;
    }

    const id = ++requestId;
    message.requestId = id;

    const timeoutId = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error("Native host request timeout"));
      }
    }, NATIVE_REQUEST_TIMEOUT_MS);

    pendingRequests.set(id, { resolve, reject, timeoutId });

    try {
      p.postMessage(message);
    } catch (e) {
      clearTimeout(timeoutId);
      pendingRequests.delete(id);
      reject(e);
    }
  });
}

async function archiveTab(tab) {
  if (!tab.url || tab.url.startsWith("about:") || tab.url.startsWith("moz-extension:")) {
    return;
  }

  try {
    const response = await sendNativeMessage({
      action: "archive",
      url: tab.url,
      title: tab.title || tab.url,
      faviconUrl: tab.favIconUrl || null
    });

    if (response.ok) {
      await browser.tabs.remove(tab.id);
      tabLastActive.delete(tab.id);
      console.log("Archived tab:", tab.title);
    }
  } catch (e) {
    console.error("Failed to archive tab:", e);
  }
}

async function checkInactiveTabs() {
  if (settings.paused) {
    return;
  }

  const thresholdMs = settings.archiveAfterMinutes * 60 * 1000;
  const now = Date.now();

  try {
    const tabs = await browser.tabs.query({});

    const activeTabIds = new Set(tabs.map(t => t.id));
    for (const tabId of tabLastActive.keys()) {
      if (!activeTabIds.has(tabId)) {
        tabLastActive.delete(tabId);
      }
    }

    if (tabs.length <= settings.minTabs) {
      return;
    }

    const sortedTabs = tabs
      .filter(tab => !tab.pinned && !tab.active)
      .map(tab => ({
        tab,
        lastActive: tabLastActive.get(tab.id) || now
      }))
      .sort((a, b) => a.lastActive - b.lastActive);

    const tabsToArchive = sortedTabs.filter(({ lastActive }) => now - lastActive > thresholdMs);
    const maxToArchive = Math.max(0, tabs.length - settings.minTabs);

    for (let i = 0; i < Math.min(tabsToArchive.length, maxToArchive); i++) {
      await archiveTab(tabsToArchive[i].tab);
    }
  } catch (e) {
    console.error("Failed to check inactive tabs:", e);
  }
}

browser.tabs.onActivated.addListener(({ tabId }) => {
  tabLastActive.set(tabId, Date.now());
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    tabLastActive.set(tabId, Date.now());
  }
});

browser.tabs.onRemoved.addListener((tabId) => {
  tabLastActive.delete(tabId);
});

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true;
});

async function handleMessage(message) {
  switch (message.action) {
    case "search":
      return sendNativeMessage({
        action: "search",
        query: message.query,
        limit: message.limit || 50,
        offset: message.offset || 0
      });

    case "recent":
      return sendNativeMessage({
        action: "recent",
        limit: message.limit || 50,
        offset: message.offset || 0
      });

    case "restore":
      try {
        const response = await sendNativeMessage({
          action: "restore",
          id: message.id
        });
        return response;
      } catch (e) {
        return { ok: false, error: e.message };
      }

    case "delete":
      return sendNativeMessage({
        action: "delete",
        id: message.id
      });

    case "stats":
      return sendNativeMessage({ action: "stats" });

    case "export":
      return sendNativeMessage({ action: "export" });

    case "getSettings":
      return { ok: true, settings };

    case "updateSettings":
      settings = { ...settings, ...message.settings };
      await browser.storage.sync.set(settings);
      return { ok: true, settings };

    case "archiveTab":
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        await archiveTab(tabs[0]);
        return { ok: true };
      }
      return { ok: false, error: "No active tab" };

    default:
      return { ok: false, error: "Unknown action" };
  }
}

async function init() {
  await loadSettings();

  const tabs = await browser.tabs.query({});
  const now = Date.now();
  tabs.forEach(tab => {
    if (!tabLastActive.has(tab.id)) {
      tabLastActive.set(tab.id, now);
    }
  });

  connectNative();

  setInterval(checkInactiveTabs, INACTIVE_CHECK_INTERVAL_MS);
  console.log("Tab Archive initialized");
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "sync") {
    for (const key of Object.keys(changes)) {
      if (key in settings) {
        settings[key] = changes[key].newValue;
      }
    }
  }
});

init();

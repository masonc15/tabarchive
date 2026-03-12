import browser from 'webextension-polyfill';

type RuntimeManifest = {
  browser_specific_settings?: {
    gecko?: unknown;
  };
  applications?: {
    gecko?: unknown;
  };
};

export function isFirefoxRuntime(): boolean {
  try {
    const manifest = browser.runtime.getManifest?.() as RuntimeManifest | undefined;
    if (manifest?.browser_specific_settings?.gecko || manifest?.applications?.gecko) {
      return true;
    }
  } catch {
    // Fall through to runtime URL detection.
  }

  try {
    const runtimeUrl = browser.runtime.getURL?.('/');
    return typeof runtimeUrl === 'string' && runtimeUrl.startsWith('moz-extension://');
  } catch {
    return false;
  }
}

export function getRestoreBlockReason(url: string): string | null {
  if (isFirefoxRuntime() && url.startsWith('file:')) {
    return 'Firefox cannot reopen local file tabs from an extension. Open the file directly from disk.';
  }
  return null;
}

export function canArchiveUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  if (url.startsWith('about:') || url.startsWith('moz-extension:')) {
    return false;
  }
  return getRestoreBlockReason(url) === null;
}

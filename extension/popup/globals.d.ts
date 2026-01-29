declare namespace browser {
  namespace runtime {
    function sendMessage(message: unknown): Promise<unknown>;
    function connectNative(application: string): Port;
    const lastError: { message?: string } | undefined;
  }

  namespace tabs {
    function query(queryInfo: {
      active?: boolean;
      currentWindow?: boolean;
      pinned?: boolean;
    }): Promise<Tab[]>;
    function create(createProperties: { url?: string }): Promise<Tab>;
    function remove(tabIds: number | number[]): Promise<void>;

    interface Tab {
      id?: number;
      url?: string;
      title?: string;
      favIconUrl?: string;
      pinned?: boolean;
      active?: boolean;
    }

    const onActivated: {
      addListener(callback: (activeInfo: { tabId: number; windowId: number }) => void): void;
    };

    const onUpdated: {
      addListener(
        callback: (tabId: number, changeInfo: { status?: string }, tab: Tab) => void
      ): void;
    };

    const onRemoved: {
      addListener(callback: (tabId: number, removeInfo: unknown) => void): void;
    };
  }

  namespace storage {
    interface StorageChange {
      oldValue?: unknown;
      newValue?: unknown;
    }

    const sync: {
      get(keys?: string | string[] | object | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };

    const onChanged: {
      addListener(
        callback: (changes: Record<string, StorageChange>, areaName: string) => void
      ): void;
    };
  }

  interface Port {
    postMessage(message: unknown): void;
    onMessage: {
      addListener(callback: (message: unknown) => void): void;
    };
    onDisconnect: {
      addListener(callback: () => void): void;
    };
  }
}

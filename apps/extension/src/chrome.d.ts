// The few Chrome extension APIs the extension uses, declared here instead
// of installing @types/chrome. Only what the manifest's permissions
// (activeTab, scripting, storage, alarms, and the optional host permissions
// for background-tab detail reading) allow is declared.

declare namespace chrome {
  namespace runtime {
    function getManifest(): { version: string };
    function openOptionsPage(): Promise<void>;
    function getPlatformInfo(): Promise<unknown>;
    function sendMessage<T = unknown>(message: unknown): Promise<T>;
    const onInstalled: { addListener(callback: () => void): void };
    const onStartup: { addListener(callback: () => void): void };
    interface MessageSender {
      id?: string;
      tab?: tabs.Tab;
      url?: string;
    }
    const onMessage: {
      addListener(callback: (message: unknown, sender: MessageSender, sendResponse: (response: unknown) => void) => boolean | void): void;
    };
    const id: string;
  }

  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      title?: string;
      status?: "loading" | "complete" | "unloaded";
      active?: boolean;
    }
    function query(queryInfo: { active: boolean; currentWindow: boolean }): Promise<Tab[]>;
    function get(tabId: number): Promise<Tab>;
    function create(createProperties: { url: string; active?: boolean }): Promise<Tab>;
    function remove(tabId: number): Promise<void>;
    interface Listener<A extends unknown[]> {
      addListener(callback: (...args: A) => void): void;
      removeListener(callback: (...args: A) => void): void;
    }
    const onUpdated: Listener<[tabId: number, changeInfo: { status?: string; url?: string }, tab: Tab]>;
    const onRemoved: Listener<[tabId: number, removeInfo: unknown]>;
  }

  namespace scripting {
    interface InjectionResult<T> {
      result?: T;
    }
    function executeScript<T>(injection: { target: { tabId: number }; func: () => T }): Promise<Array<InjectionResult<T>>>;
    // With one JSON-serializable argument (the results-page reader's spec).
    function executeScript<T, A>(injection: { target: { tabId: number }; func: (arg: A) => T; args: [A] }): Promise<Array<InjectionResult<T>>>;
  }

  namespace permissions {
    interface Permissions {
      origins?: string[];
      permissions?: string[];
    }
    function request(permissions: Permissions): Promise<boolean>;
    function contains(permissions: Permissions): Promise<boolean>;
    const onAdded: { addListener(callback: (permissions: Permissions) => void): void };
  }

  namespace alarms {
    interface Alarm {
      name: string;
    }
    function create(name: string, alarmInfo: { periodInMinutes: number; delayInMinutes?: number }): Promise<void>;
    function clear(name: string): Promise<boolean>;
    const onAlarm: { addListener(callback: (alarm: Alarm) => void): void };
  }

  namespace storage {
    interface StorageArea {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
      setAccessLevel?(accessOptions: { accessLevel: "TRUSTED_CONTEXTS" | "TRUSTED_AND_UNTRUSTED_CONTEXTS" }): Promise<void>;
    }
    const local: StorageArea;
    // In memory, cleared when the browser closes: a background-tab run never
    // survives a browser restart.
    const session: StorageArea;
  }
}

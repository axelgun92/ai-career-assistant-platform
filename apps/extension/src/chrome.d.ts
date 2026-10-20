// The few Chrome extension APIs the extension uses, declared here instead
// of installing @types/chrome. Only what the manifest's permissions
// (activeTab, scripting, storage) allow is declared.

declare namespace chrome {
  namespace runtime {
    function getManifest(): { version: string };
    function openOptionsPage(): Promise<void>;
    const onInstalled: { addListener(callback: () => void): void };
    const onStartup: { addListener(callback: () => void): void };
  }

  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      title?: string;
    }
    function query(queryInfo: { active: boolean; currentWindow: boolean }): Promise<Tab[]>;
    function get(tabId: number): Promise<Tab>;
    function create(createProperties: { url: string }): Promise<Tab>;
  }

  namespace scripting {
    interface InjectionResult<T> {
      result?: T;
    }
    function executeScript<T>(injection: { target: { tabId: number }; func: () => T }): Promise<Array<InjectionResult<T>>>;
  }

  namespace storage {
    interface StorageArea {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
      setAccessLevel?(accessOptions: { accessLevel: "TRUSTED_CONTEXTS" | "TRUSTED_AND_UNTRUSTED_CONTEXTS" }): Promise<void>;
    }
    const local: StorageArea;
  }
}

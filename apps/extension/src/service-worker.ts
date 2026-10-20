import { restrictStorage } from "./settings";

// The extension's minimal service worker. Its only job is to keep the
// extension's storage (the backend address and the pairing credential)
// limited to the extension's own pages, from installation and every
// browser start, before any page is read. It listens for nothing else, reads
// no page, opens no tab and makes no request.
chrome.runtime.onInstalled.addListener(() => void restrictStorage());
chrome.runtime.onStartup.addListener(() => void restrictStorage());
void restrictStorage();

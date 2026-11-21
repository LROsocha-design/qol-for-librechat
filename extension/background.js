/**
 * BACKGROUND — runs the extension on LibreChat addresses the user added.
 *
 * The manifest only names LibreChat's default local address
 * (http://localhost:3080). Any other address is added from the popup: it asks
 * Chrome for permission for that one site, and this worker then registers the
 * same content scripts for it. Registered scripts are dropped when the
 * extension updates, so they are registered again on install and on startup.
 *
 * The three lists below are filled in by tools/build-public.py from the
 * manifest, so they can never drift from it.
 */
const BUILT_IN = ["http://localhost:3080/*", "http://127.0.0.1:3080/*"];
const START_JS = ["content/config.js", "content/deeplink.js", "content/theme-early.js"];
const IDLE_JS = ["content/adapter.js", "content/storage.js", "content/api.js", "content/navigate.js", "content/ui.js", "content/branch-keys.js", "content/edit-at-click.js", "content/st-export.js", "content/tree-layout.js", "content/tree-view.js", "content/hotkeys.js", "content/skill-calls.js", "content/gallery.js", "content/chat-finder.js", "content/theme.js", "content/main.js", "content/styles/frontmatter.js", "content/styles/api.js", "content/styles/zip.js", "content/styles/export.js", "content/styles/presets.js", "content/styles/ui.js", "content/styles/prefill.js", "content/styles/prompts.js", "content/styles/pills.js"];
const IDLE_CSS = ["content/page-styles.css", "content/styles/page-styles.css"];

let queue = Promise.resolve();

/** The sites the user allowed, beyond the built-in ones. */
async function addedSites() {
  const { origins = [] } = await chrome.permissions.getAll();
  return origins.filter((pattern) => /^https?:\/\/[^*]+\/\*$/.test(pattern) && !BUILT_IN.includes(pattern));
}

async function register() {
  const sites = await addedSites();
  const old = await chrome.scripting.getRegisteredContentScripts();
  if (old.length) {
    await chrome.scripting.unregisterContentScripts({ ids: old.map((script) => script.id) });
  }
  if (!sites.length) return sites;
  await chrome.scripting.registerContentScripts([
    { id: 'qol-start', matches: sites, js: START_JS, runAt: 'document_start', persistAcrossSessions: true },
    { id: 'qol-idle', matches: sites, js: IDLE_JS, css: IDLE_CSS, runAt: 'document_idle', persistAcrossSessions: true },
  ]);
  return sites;
}

/** One at a time: two overlapping runs would register the same ids twice. */
function sync() {
  queue = queue.then(register).catch((err) => {
    console.warn('[QoL for LibreChat] could not register the content scripts:', err);
    return [];
  });
  return queue;
}

async function reloadTabs(patterns) {
  if (!patterns || !patterns.length) return;
  try {
    const tabs = await chrome.tabs.query({ url: patterns });
    for (const tab of tabs) chrome.tabs.reload(tab.id);
  } catch {
    /* no access to those tabs any more (permission just removed): the user reloads */
  }
}

chrome.runtime.onInstalled.addListener(sync);
chrome.runtime.onStartup.addListener(sync);
chrome.permissions.onAdded.addListener(async (added) => {
  await sync();
  /** The scripts only run in pages loaded from now on. */
  reloadTabs(added.origins);
});
chrome.permissions.onRemoved.addListener(sync);

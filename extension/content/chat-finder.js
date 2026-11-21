/**
 * CHAT FINDER — a "Search chats by name" field at the top of the chat list.
 *
 * Stock LibreChat shows its sidebar search only when Meilisearch runs
 * (`SEARCH=true` plus a Meilisearch server). Without it there is no way to
 * find a chat by its name. This field fills that gap: it loads the whole chat
 * list once (GET /api/convos, the same call the sidebar makes, 100 per page),
 * filters it in the browser and lists the matches under the field.
 *
 * A chat matches when its name contains every typed word, in any order,
 * ignoring case. ↑ / ↓ pick a result, Enter opens it, Ctrl+Enter (or a
 * middle click) opens it in a new tab, Esc clears the field. Ctrl+/ (stock
 * LibreChat's "focus search" shortcut) jumps into it. Archived chats are not
 * listed, as in the sidebar.
 *
 * It steps aside whenever the page has its own search field (stock search
 * with Meilisearch, or a patched LibreChat with a title filter): both use the
 * input `data-testid="nav-search-input"`.
 */
(() => {
  'use strict';

  const LCBM = (window.LCBM = window.LCBM || {});
  const { api } = LCBM;

  const HOST_ID = 'lcqol-chat-finder';
  const PAGE_SIZE = 100;
  const MAX_PAGES = 100;
  const STALE_MS = 30000;
  const SHOWN_MAX = 60;

  const CSS = `
    :host { display: flex; flex: 1 1 auto; min-width: 0; font-size: 14px; }
    * { box-sizing: border-box; }
    .field {
      position: relative; display: flex; align-items: center; flex: 1; min-width: 0; height: 36px;
      padding: 0 28px 0 32px; border-radius: 8px; border: 2px solid transparent; cursor: text;
      color: var(--text-primary, #ececf1);
    }
    .field:hover { background: var(--surface-active-alt, rgba(127,127,127,.15)); }
    .field:focus-within {
      background: var(--surface-active-alt, rgba(127,127,127,.15));
      border-color: var(--ring-primary, #8e8ea0);
    }
    .icon {
      position: absolute; left: 10px; width: 16px; height: 16px; pointer-events: none;
      color: var(--text-secondary, #a0a0b0);
    }
    .field:hover .icon, .field:focus-within .icon { color: var(--text-primary, #ececf1); }
    input {
      flex: 1; min-width: 0; margin: 0; padding: 0; border: none; outline: none;
      background: transparent; color: inherit; font: inherit; font-size: 14px; line-height: 1.25;
    }
    input::placeholder { color: var(--text-secondary, #a0a0b0); opacity: 1; }
    .field:hover input::placeholder, .field:focus-within input::placeholder { color: var(--text-primary, #ececf1); }
    .clear {
      position: absolute; right: 5px; width: 20px; height: 20px; padding: 0; border: none;
      border-radius: 50%; background: transparent; color: inherit; cursor: pointer;
      display: flex; align-items: center; justify-content: center; font: inherit; font-size: 16px; line-height: 1;
    }
    .clear[hidden] { display: none; }
    .list {
      position: fixed; z-index: 2147483000; overflow-y: auto; padding: 4px;
      background: var(--surface-secondary, #2a2a33); color: var(--text-primary, #ececf1);
      border: 1px solid var(--border-medium, #4a4a58); border-radius: 10px;
      box-shadow: 0 8px 28px rgba(0,0,0,.35); font-size: 13.5px;
    }
    .list[hidden] { display: none; }
    .opt {
      display: flex; align-items: baseline; gap: 10px; padding: 7px 9px; border-radius: 7px; cursor: pointer;
    }
    .opt.sel { background: var(--surface-hover, rgba(127,127,127,.22)); }
    .opt .t { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .opt .t mark { background: transparent; color: inherit; font-weight: 700; }
    .opt .d { flex: none; font-size: 11.5px; color: var(--text-secondary, #a0a0b0); }
    .opt.cur .t::after { content: ' (open)'; color: var(--text-secondary, #a0a0b0); }
    .note { padding: 8px 9px; color: var(--text-secondary, #a0a0b0); line-height: 1.4; }
    .note.err { color: #e5534b; }
  `;

  const ICON =
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="11" cy="11" r="7"></circle><line x1="20.5" y1="20.5" x2="16" y2="16"></line></svg>';

  // ------------------------------------------------------------------ matching

  /** The typed text as lowercase words; blank text gives none. */
  function words(text) {
    return String(text || '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 10);
  }

  /** Chats whose title contains every word, in the order given (newest first from the server). */
  function match(chats, text) {
    const ws = words(text);
    if (!ws.length) return [];
    return chats.filter((c) => {
      const t = (c.title || '').toLowerCase();
      return ws.every((w) => t.includes(w));
    });
  }

  /** [ [text, isMatch], ... ] pieces of a title, with every occurrence of every word marked. */
  function pieces(title, ws) {
    const t = String(title || '');
    const lower = t.toLowerCase();
    const hit = new Array(t.length).fill(false);
    for (const w of ws) {
      for (let at = lower.indexOf(w); at !== -1; at = lower.indexOf(w, at + 1)) {
        for (let i = at; i < at + w.length; i++) hit[i] = true;
      }
    }
    const out = [];
    for (let i = 0; i < t.length; i++) {
      if (out.length && out[out.length - 1][1] === hit[i]) out[out.length - 1][0] += t[i];
      else out.push([t[i], hit[i]]);
    }
    return out;
  }

  // --------------------------------------------------------------- chat list

  let chats = null;
  let loadedAt = 0;
  let loading = null;
  let loadError = null;

  async function loadAll() {
    const all = [];
    let cursor = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (cursor) q.set('cursor', cursor);
      const data = await api.authedFetch(`/api/convos?${q}`);
      for (const c of data.conversations || []) {
        if (c && c.conversationId) all.push({ id: c.conversationId, title: c.title || '', updatedAt: c.updatedAt });
      }
      cursor = data.nextCursor;
      if (!cursor) break;
    }
    return all;
  }

  /** The list, loaded again when older than STALE_MS. Renders when it arrives. */
  function ensureList() {
    if (loading || (chats && Date.now() - loadedAt < STALE_MS)) return;
    loading = loadAll()
      .then((list) => {
        chats = list;
        loadedAt = Date.now();
        loadError = null;
      })
      .catch((err) => {
        loadError = err && err.message ? err.message : String(err);
      })
      .finally(() => {
        loading = null;
        render();
      });
    render();
  }

  // -------------------------------------------------------------------- open

  function currentId() {
    const m = location.pathname.match(/^\/c\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  /**
   * Opens a chat inside the running app: a history entry plus a popstate is
   * how the browser's own Back button moves react-router, so no reload.
   */
  function openChat(id, newTab) {
    const path = `/c/${encodeURIComponent(id)}`;
    if (newTab) {
      window.open(path, '_blank', 'noopener');
      return;
    }
    if (currentId() === id) return;
    const state = history.state && typeof history.state === 'object' ? history.state : {};
    const idx = Number.isInteger(state.idx) ? state.idx + 1 : 0;
    history.pushState({ usr: null, key: Math.random().toString(36).slice(2, 10), idx }, '', path);
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  }

  // ---------------------------------------------------------------------- UI

  let host = null;
  let input = null;
  let clearBtn = null;
  let list = null;
  let shown = [];
  let sel = 0;

  function pageHasOwnSearch() {
    for (const el of document.querySelectorAll('input[data-testid="nav-search-input"]')) {
      if (!host || !host.contains(el)) return true;
    }
    return false;
  }

  /** The row that holds the bookmark filter (and stock's search, when there is one). */
  function findRow() {
    const bookmark = document.getElementById('bookmark-nav-menu-button');
    let region = bookmark ? bookmark.closest('[role="region"]') : null;
    if (!region) {
      const item = document.querySelector('[data-testid="convo-item"]');
      region = item ? item.closest('[role="region"]') : null;
    }
    const row = region ? region.firstElementChild : null;
    return row && row.tagName === 'DIV' ? row : null;
  }

  function build() {
    host = document.createElement('div');
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>
      <div class="field">${ICON}
        <input type="text" role="combobox" aria-autocomplete="list" aria-expanded="false"
          aria-controls="lcqol-finder-list" autocomplete="off" spellcheck="false" dir="auto"
          placeholder="Search chats by name" aria-label="Search chats by name">
        <button class="clear" type="button" aria-label="Clear" hidden>×</button>
      </div>
      <div class="list" id="lcqol-finder-list" role="listbox" hidden></div>`;
    input = root.querySelector('input');
    clearBtn = root.querySelector('.clear');
    list = root.querySelector('.list');

    root.querySelector('.field').addEventListener('mousedown', (e) => {
      if (e.target !== input && e.target !== clearBtn) {
        e.preventDefault();
        input.focus();
      }
    });
    input.addEventListener('input', () => {
      sel = 0;
      clearBtn.hidden = !input.value;
      ensureList();
      render();
    });
    /** Loading on focus means the list is usually there by the first keystroke. */
    input.addEventListener('focus', () => {
      ensureList();
      render();
    });
    input.addEventListener('blur', () => setTimeout(() => render(), 0));
    input.addEventListener('keydown', onKey);
    clearBtn.addEventListener('click', () => {
      clear();
      input.focus();
    });
    /** Keep the caret in the field while clicking a result. */
    list.addEventListener('mousedown', (e) => e.preventDefault());
    list.addEventListener('click', (e) => pick(e, e.ctrlKey || e.metaKey));
    list.addEventListener('auxclick', (e) => {
      if (e.button === 1) pick(e, true);
    });
    window.addEventListener('resize', place);
  }

  function clear() {
    input.value = '';
    clearBtn.hidden = true;
    sel = 0;
    render();
  }

  function pick(e, newTab) {
    const opt = e.target.closest('.opt');
    if (!opt) return;
    const id = opt.dataset.id;
    if (!newTab) {
      clear();
      input.blur();
    }
    openChat(id, newTab);
  }

  function onKey(e) {
    /** The page's single-key shortcuts must not see typing (the event leaves the
     *  shadow root with the host as its target, which does not look like a text
     *  field). Chords with Alt stay free for this extension's own keys. */
    if (!e.altKey) e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!shown.length) return;
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      render();
    } else if (e.key === 'Enter') {
      const chat = shown[sel];
      if (!chat) return;
      e.preventDefault();
      const newTab = e.ctrlKey || e.metaKey;
      if (!newTab) {
        clear();
        input.blur();
      }
      openChat(chat.id, newTab);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (input.value) clear();
      else input.blur();
    }
  }

  function note(text, err) {
    const div = document.createElement('div');
    div.className = err ? 'note err' : 'note';
    div.textContent = text;
    list.appendChild(div);
  }

  function render() {
    if (!host) return;
    const text = input.value.trim();
    const open = !!text && host.shadowRoot.activeElement === input;
    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    if (!open) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    list.textContent = '';
    if (!chats) {
      if (loadError) note(`Could not load the chat list: ${loadError}`, true);
      else note('Loading chats…');
      shown = [];
      place();
      return;
    }
    const ws = words(text);
    const found = match(chats, text);
    shown = found.slice(0, SHOWN_MAX);
    if (sel >= shown.length) sel = 0;
    const cur = currentId();
    shown.forEach((chat, i) => {
      const opt = document.createElement('div');
      opt.className = 'opt' + (i === sel ? ' sel' : '') + (chat.id === cur ? ' cur' : '');
      opt.id = `lcqol-finder-opt-${i}`;
      opt.setAttribute('role', 'option');
      opt.setAttribute('aria-selected', String(i === sel));
      opt.dataset.id = chat.id;
      opt.title = chat.title;
      const t = document.createElement('span');
      t.className = 't';
      for (const [part, isHit] of pieces(chat.title || '(no name)', ws)) {
        if (isHit) {
          const m = document.createElement('mark');
          m.textContent = part;
          t.appendChild(m);
        } else {
          t.appendChild(document.createTextNode(part));
        }
      }
      const d = document.createElement('span');
      d.className = 'd';
      const when = chat.updatedAt ? new Date(chat.updatedAt) : null;
      d.textContent = when && !isNaN(when) ? when.toLocaleDateString() : '';
      opt.append(t, d);
      list.appendChild(opt);
    });
    if (!found.length) note('No chat name contains that.');
    else if (found.length > shown.length) note(`${found.length - shown.length} more. Type more to narrow it down.`);
    if (loadError) note(`The list may be old: ${loadError}`, true);
    if (shown.length) input.setAttribute('aria-activedescendant', `lcqol-finder-opt-${sel}`);
    else input.removeAttribute('aria-activedescendant');
    place();
    const selected = list.querySelector('.opt.sel');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }

  /** Under the field, at least 300 px wide, inside the window. */
  function place() {
    if (!host || list.hidden) return;
    const r = host.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 300), window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    list.style.left = `${left}px`;
    list.style.top = `${r.bottom + 4}px`;
    list.style.width = `${width}px`;
    list.style.maxHeight = `${Math.max(160, window.innerHeight - r.bottom - 16)}px`;
  }

  /** Called on every DOM change (debounced in main.js): puts the field in, or takes it out. */
  function inject() {
    if (pageHasOwnSearch()) {
      if (host && host.isConnected) host.remove();
      return;
    }
    const row = findRow();
    if (!row) return;
    if (!host) build();
    if (host.parentElement !== row) row.appendChild(host);
  }

  /** Ctrl+/ is stock LibreChat's "focus search"; without a stock field it finds none. */
  function onGlobalKey(e) {
    if (e.key !== '/' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    if (pageHasOwnSearch()) return;
    /** When the sidebar is closed, LibreChat opens it; the field arrives a moment later. */
    for (const delay of [0, 450, 900]) {
      setTimeout(() => {
        inject();
        if (host && host.isConnected && host.shadowRoot.activeElement !== input) input.focus();
      }, delay);
    }
  }

  function init() {
    document.addEventListener('keydown', onGlobalKey);
    inject();
  }

  LCBM.chatFinder = { init, inject, _match: match, _pieces: pieces, _words: words };
})();

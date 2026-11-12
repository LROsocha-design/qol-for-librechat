/**
 * TREE VIEW — the whole conversation as a top-down tree, every branch at once.
 *
 * Opened with the round branch button above the 💾/🔖 buttons, Alt+T, or
 * "Branch tree" in the 🔖 Navigation dialog. A panel docks on the right and
 * pushes the chat aside (⤢ fills the window instead). Each node is one
 * message with a two-line preview; the branch LibreChat is showing is drawn
 * gold, and the message you are reading gets a blue ring. Clicking a node
 * switches the chat to it with the same jump as bookmarks (native bridge,
 * arrow-walker fallback), so it never writes anything to the server.
 * Bookmarked messages are green with their name on the box; zoomed out,
 * the names float over the overview as labels you can click.
 *
 * Big chats (5k messages, 800 forks, 57 versions at one fork) stay usable:
 *   - one canvas, drawn only where the view is; text only when it is
 *     readable, plain dots below that (semantic zoom)
 *   - wheel zooms at the cursor, drag pans, the minimap jumps
 *   - dead-end versions at a fork fold into one stack (click spreads them)
 *   - ⊖ under a hovered node folds its whole branch (Alt+Click does too)
 * The message list comes from GET /api/messages/:id like the bookmark
 * tree; it is boiled down to a slim tree (tree-layout.js) and the big
 * objects are dropped. Messages sent while the panel is open are added from
 * the DOM at once; small chats refetch a few seconds later, big ones light a
 * dot on ↻ instead of pulling 100+ MB again.
 */
(() => {
  'use strict';

  const LCBM = (window.LCBM = window.LCBM || {});
  const { adapter, api, navigate, storage, treeLayout: TL } = LCBM;

  /** World units are CSS px at zoom 1. */
  const COL_W = 184;
  const NODE_W = 168;
  const NODE_H = 54;
  const ROW_H = 82;
  const PAD = 48;
  const MAX_S = 2.5;
  /** Below TEXT_ZOOM no text is drawn and a click zooms in instead of jumping. */
  const TEXT_ZOOM = 0.6;
  /** Below BOX_ZOOM nodes are plain dots. */
  const BOX_ZOOM = 0.3;
  const MIN_W = 340;
  /** A small chat's tree older than this is refetched when the panel opens;
   *  a big one (over AUTO_REFETCH_MAX) is kept until ↻. */
  const RELOAD_AFTER_MS = 120_000;
  const AUTO_REFETCH_MAX = 1500;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const FONT_HEAD = '600 11.5px system-ui, sans-serif';
  const FONT_BODY = '11px system-ui, sans-serif';
  const FONT_LABEL = '600 11px system-ui, sans-serif';
  const LABEL_MAX_W = 170;

  const C = {
    bg: '#1c1c22',
    edge: '#56566c',
    path: '#c9a227',
    text: '#e8e8ee',
    sub: '#a3a3b4',
    userFill: '#24324a',
    userStrip: '#5b8def',
    aiFill: '#2e2840',
    aiStrip: '#a083e8',
    border: '#45455a',
    hoverFill: '#3b3b50',
    errStrip: '#e06464',
    stackFill: '#282830',
    stackLine: '#6e6e86',
    ring: '#7fd3ff',
    pin: '#e0b43a',
    /** Bookmarks: green, because gold already means "your branch". */
    bm: '#3ecf8e',
    bmFill: '#1b3a2f',
    bmHoverFill: '#25503f',
    bmText: '#9ff2c8',
  };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, sans-serif; }
    .fab {
      position: fixed; right: 18px; bottom: 172px; z-index: 2147483000;
      width: 40px; height: 40px; border-radius: 50%; border: none; cursor: pointer;
      background: #2f5a4c; color: #fff; display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 10px rgba(0,0,0,.4); opacity: .85;
    }
    .fab:hover, .fab.on { opacity: 1; }
    .fab.on { background: #3e7d66; }
    .fab[hidden] { display: none; }
    .panel {
      position: fixed; top: 0; right: 0; bottom: 0; width: var(--w, 520px);
      z-index: 2147482990; display: flex; flex-direction: column;
      background: ${C.bg}; color: ${C.text}; border-left: 1px solid #3a3a46;
      box-shadow: -6px 0 24px rgba(0,0,0,.35);
    }
    .panel.max { left: 0; width: auto; border-left: none; }
    .panel[hidden] { display: none; }
    .resizer { position: absolute; left: -4px; top: 0; bottom: 0; width: 8px; cursor: ew-resize; z-index: 4; }
    .panel.max .resizer { display: none; }
    header {
      padding: 10px 12px 8px; border-bottom: 1px solid #30303c;
      display: flex; flex-direction: column; gap: 7px;
    }
    .title { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
    .title b { font-size: 15px; font-weight: 600; white-space: nowrap; }
    .stats { font-size: 12px; color: #9a9aa8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tools { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .tools button {
      padding: 4px 10px; font-size: 12.5px; border-radius: 7px; cursor: pointer;
      border: 1px solid #45455a; background: #2a2a34; color: #d8d8e2; position: relative;
    }
    .tools button:hover { background: #363644; }
    .tools .spacer { flex: 1; }
    .tools label {
      display: flex; gap: 6px; align-items: center; font-size: 12.5px; color: #bfbfcc;
      cursor: pointer; user-select: none; white-space: nowrap;
    }
    .tools input { accent-color: #6b5aa0; margin: 0; cursor: pointer; }
    .tools button.dot::after {
      content: ''; position: absolute; top: 2px; right: 2px; width: 7px; height: 7px;
      border-radius: 50%; background: ${C.pin};
    }
    .stage { position: relative; flex: 1; overflow: hidden; }
    canvas.main {
      position: absolute; inset: 0; width: 100%; height: 100%; display: block;
      cursor: grab; outline: none; touch-action: none;
    }
    canvas.main.drag { cursor: grabbing; }
    canvas.main.hit { cursor: pointer; }
    canvas.mini {
      position: absolute; left: 10px; bottom: 10px; z-index: 2;
      border: 1px solid #45455a; border-radius: 4px; cursor: crosshair; touch-action: none;
    }
    canvas.mini[hidden] { display: none; }
    .card {
      position: absolute; z-index: 3; max-width: 340px; padding: 8px 10px; border-radius: 8px;
      background: #121218; border: 1px solid #4a4a58; box-shadow: 0 6px 20px rgba(0,0,0,.5);
      font-size: 12.5px; line-height: 1.4; pointer-events: none;
    }
    .card[hidden] { display: none; }
    .card .head { color: #a9a9b8; font-size: 11.5px; margin-bottom: 4px; }
    .card .head b { color: ${C.text}; font-weight: 600; }
    .card .body { color: #e2e2ea; word-break: break-word; }
    .card .body div + div { margin-top: 4px; }
    .card .foot { margin-top: 6px; color: #9a9aa8; font-size: 11.5px; white-space: pre-line; }
    .card .bm { color: ${C.bmText}; font-weight: 600; white-space: pre-line; word-break: break-word; }
    .card .head + .bm { margin-bottom: 4px; }
    .card .foot + .bm { margin-top: 4px; font-size: 11.5px; }
    .card .hint { margin-top: 6px; color: ${C.path}; font-size: 11.5px; }
    .msg {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      padding: 24px; text-align: center; color: #a9a9b8; font-size: 13px; pointer-events: none;
    }
    .msg.error { color: #f0b0b0; }
    .msg[hidden] { display: none; }
    footer {
      display: flex; gap: 12px; align-items: center; min-height: 30px;
      padding: 6px 70px 6px 12px; border-top: 1px solid #30303c; font-size: 11.5px; color: #9a9aa8;
    }
    .legend { display: flex; gap: 10px; flex-wrap: wrap; }
    .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
    .status { color: #d8c27a; }
    .status.error { color: #f0a0a0; }
    .status:empty { display: none; }
  `;

  const ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="4.5" r="2.2"/><circle cx="5.5" cy="19.5" r="2.2"/>
    <circle cx="12" cy="19.5" r="2.2"/><circle cx="18.5" cy="19.5" r="2.2"/>
    <path d="M12 6.7v10.6M5.5 17.3v-4.3h13v4.3"/></svg>`;

  // ------------------------------------------------------------------ state

  let host = null;
  let shadow = null;
  let fab;
  let panel;
  let stage;
  let canvas;
  let ctx;
  let mini;
  let mctx;
  let card;
  let msgEl;
  let statusEl;
  let statsEl;
  let stackBox;
  let reloadBtn;
  let maxBtn;

  let isOpen = false;
  let maximized = false;
  let panelW = 520;
  let stackOn = true;
  let prevFocus = null;
  let observer = null;
  let domTimer = null;

  /** Slim tree of the open conversation (tree-layout buildData + convoId/at). */
  let data = null;
  /** The last few chats' slim trees, so going back to one is instant. */
  const cache = new Map();
  const CACHE_CHATS = 3;
  let loading = null;
  let loadingId = null;
  let token = null;
  let refetchTimer = null;
  /** The unknown ids the last automatic refetch was for: the same ones
   *  again (the server does not have them) never trigger another. */
  let refetchedFor = '';
  /** messageId -> bookmark names. */
  let bookmarks = new Map();
  let unwatch = null;
  let watchedId = null;
  /** Bookmark labels drawn zoomed out, in stage px, for hover and click. */
  let labelHits = [];

  /** What is drawn: visual nodes, rows sorted by column, bounds. */
  let vis = null;
  const view = { s: 1, tx: 0, ty: 0 };
  let fitted = false;
  /** The view shows the whole tree (last move was Fit): resizing refits. */
  let showingAll = false;
  let pathIds = [];
  let pathSet = new Set();
  let inViewId = null;
  let inViewTimer = null;
  let collapsed = new Set();
  let openStacks = new Set();
  let hover = null;
  let drag = null;
  let drawPending = false;
  let anim = null;
  let animToken = null;
  let jumping = false;
  let miniCache = null;
  let lastDrawMs = 0;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const fmt = (n) => n.toLocaleString('en-US');
  const tick = () => new Promise((r) => setTimeout(r, 0));

  async function getOpt(name, fallback) {
    try {
      return await storage.getOption(name, fallback);
    } catch {
      return fallback;
    }
  }
  function setOpt(name, value) {
    try {
      storage.setOption(name, value);
    } catch {
      /** chrome.storage is missing when the scripts are injected for tests. */
    }
  }

  // ---------------------------------------------------------------- shell UI

  function init() {
    if (host) return;
    /** An extension reload leaves the old host behind in open tabs. */
    document.getElementById('lcbm-tree-host')?.remove();
    host = document.createElement('div');
    host.id = 'lcbm-tree-host';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${CSS}</style>
      <button class="fab" title="Branch tree (Alt+T)" aria-label="Branch tree">${ICON}</button>
      <section class="panel" role="dialog" aria-label="Branch tree" hidden>
        <div class="resizer" title="Drag to resize"></div>
        <header>
          <div class="title"><b>Branch tree</b><span class="stats"></span></div>
          <div class="tools">
            <button class="fit" title="Show the whole tree (0)">Fit</button>
            <button class="here" title="Center on the message you are reading (C)">&#9678; Here</button>
            <label title="Fold childless versions at a fork into one stack"><input type="checkbox" class="stack"> Stack dead ends</label>
            <span class="spacer"></span>
            <button class="reload" title="Reload from the server">&#8635;</button>
            <button class="maxi" title="Fill the window">&#10530;</button>
            <button class="close" title="Close (Esc)">&#10005;</button>
          </div>
        </header>
        <div class="stage">
          <canvas class="main" tabindex="0" aria-label="Conversation tree"></canvas>
          <canvas class="mini" hidden title="Overview: click or drag to move there"></canvas>
          <div class="card" hidden></div>
          <div class="msg" hidden></div>
        </div>
        <footer>
          <span class="legend">
            <span><i style="background:${C.path}"></i>your branch</span>
            <span><i style="background:${C.userStrip}"></i>you</span>
            <span><i style="background:${C.aiStrip}"></i>AI</span>
            <span><i style="background:${C.bm}"></i>bookmark</span>
            <span><i style="background:transparent;border:2px solid ${C.ring}"></i>reading</span>
          </span>
          <span class="status"></span>
        </footer>
      </section>`;

    fab = shadow.querySelector('.fab');
    panel = shadow.querySelector('.panel');
    stage = shadow.querySelector('.stage');
    canvas = shadow.querySelector('canvas.main');
    ctx = canvas.getContext('2d');
    mini = shadow.querySelector('canvas.mini');
    mctx = mini.getContext('2d');
    card = shadow.querySelector('.card');
    msgEl = shadow.querySelector('.msg');
    statusEl = shadow.querySelector('.status');
    statsEl = shadow.querySelector('.stats');
    stackBox = shadow.querySelector('.stack');
    reloadBtn = shadow.querySelector('.reload');
    maxBtn = shadow.querySelector('.maxi');

    fab.addEventListener('click', toggle);
    shadow.querySelector('.close').addEventListener('click', close);
    shadow.querySelector('.fit').addEventListener('click', () => fit(true));
    shadow.querySelector('.here').addEventListener('click', centerHere);
    reloadBtn.addEventListener('click', () => load(true));
    maxBtn.addEventListener('click', () => setMax(!maximized));
    stackBox.checked = stackOn;
    stackBox.addEventListener('change', () => {
      stackOn = stackBox.checked;
      setOpt('treeStack', stackOn);
      if (!stackOn) openStacks = new Set();
      rebuild(anchorId());
    });

    wireResizer(shadow.querySelector('.resizer'));
    wireCanvas();
    wireMini();
    panel.addEventListener('keydown', onPanelKey);
    new ResizeObserver(() => {
      if (!isOpen) return;
      if (showingAll) fit(false);
      else requestDraw();
    }).observe(stage);
    window.addEventListener('resize', () => isOpen && applyDock());
    document.addEventListener('scroll', () => isOpen && scheduleInView(), { capture: true, passive: true });
    document.addEventListener('keydown', onGlobalKey, true);

    getOpt('treeWidth', 520).then((w) => {
      panelW = +w || 520;
      if (isOpen) applyDock();
    });
    getOpt('treeStack', true).then((v) => {
      stackOn = v !== false;
      stackBox.checked = stackOn;
    });
    onRoute();
  }

  function onGlobalKey(e) {
    if (e.code !== 'KeyT' || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return;
    if (!isOpen && !adapter.isChatPage()) return;
    e.preventDefault();
    e.stopPropagation();
    toggle();
  }

  function onPanelKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const onCanvas = shadow.activeElement === canvas;
    const cw = stage.clientWidth;
    const ch = stage.clientHeight;
    let handled = true;
    if (e.key === 'Escape') {
      if (maximized) setMax(false);
      else close();
    } else if (!onCanvas) {
      handled = false;
    } else if (e.key === '+' || e.key === '=') zoomAt(cw / 2, ch / 2, 1.25);
    else if (e.key === '-' || e.key === '_') zoomAt(cw / 2, ch / 2, 0.8);
    else if (e.key === '0' || e.key === 'f' || e.key === 'F') fit(true);
    else if (e.key === 'c' || e.key === 'C') centerHere();
    else if (e.key === 'ArrowLeft') panBy(90, 0);
    else if (e.key === 'ArrowRight') panBy(-90, 0);
    else if (e.key === 'ArrowUp') panBy(0, 90);
    else if (e.key === 'ArrowDown') panBy(0, -90);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  /** Keep getting moves outside the element. Throws for a pointer the
   *  browser does not know (synthetic test events); dragging works without. */
  function capture(el, e) {
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable */
    }
  }

  function wireResizer(el) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      capture(el, e);
      const move = (ev) => {
        panelW = Math.round(innerWidth - ev.clientX);
        applyDock();
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        setOpt('treeWidth', panelW);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
  }

  /**
   * Docked, the panel pushes LibreChat aside through a margin on <body>
   * (page-styles.css), unless that would leave the chat narrower than 640px;
   * then it just floats over it.
   */
  function applyDock() {
    panelW = clamp(panelW, MIN_W, Math.max(MIN_W, innerWidth - 240));
    panel.style.setProperty('--w', `${panelW}px`);
    panel.classList.toggle('max', maximized);
    maxBtn.innerHTML = maximized ? '&#10529;' : '&#10530;';
    maxBtn.title = maximized ? 'Dock to the side' : 'Fill the window';
    const push = isOpen && !maximized && innerWidth - panelW >= 640;
    const root = document.documentElement;
    root.classList.toggle('lcbm-tree-docked', push);
    root.style.setProperty('--lcbm-tree-w', push ? `${panelW}px` : '0px');
    requestDraw();
  }

  function setMax(on) {
    maximized = on;
    applyDock();
  }

  function toggle() {
    if (isOpen) close();
    else open();
  }

  async function open() {
    init();
    if (isOpen) return;
    isOpen = true;
    fab.classList.add('on');
    panel.hidden = false;
    applyDock();
    prevFocus = document.activeElement;
    canvas.focus({ preventScroll: true });
    observer = new MutationObserver(() => {
      clearTimeout(domTimer);
      domTimer = setTimeout(onDom, 250);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    await load(false);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    fab.classList.remove('on');
    panel.hidden = true;
    hover = null;
    hideCard();
    if (observer) observer.disconnect();
    observer = null;
    clearTimeout(refetchTimer);
    applyDock();
    if (prevFocus && prevFocus === adapter.getComposer()) prevFocus.focus({ preventScroll: true });
    prevFocus = null;
  }

  /** Called by main.js on every route change. */
  function onRoute() {
    if (!host) return;
    fab.hidden = !adapter.isChatPage() && !isOpen;
    if (!isOpen) return;
    if (!adapter.isChatPage()) {
      vis = null;
      showMsg('Open a conversation to see its tree.');
      requestDraw();
      return;
    }
    if (!data || data.convoId !== adapter.getConversationId()) load(false);
  }

  function showMsg(text, error = false) {
    msgEl.textContent = text;
    msgEl.className = `msg${error ? ' error' : ''}`;
    msgEl.hidden = !text;
  }
  function setStatus(text, error = false) {
    statusEl.textContent = text || '';
    statusEl.className = `status${error ? ' error' : ''}`;
  }

  // -------------------------------------------------------------- data flow

  async function getToken(renew) {
    if (!token || renew) token = await api.refreshToken();
    return token;
  }

  /** GET /api/messages/:id with a byte counter: the biggest chat is 100+ MB. */
  async function fetchMessages(id, onBytes) {
    const url = `/api/messages/${encodeURIComponent(id)}`;
    let res = await fetch(url, { headers: { Authorization: `Bearer ${await getToken()}` } });
    if (res.status === 401) res = await fetch(url, { headers: { Authorization: `Bearer ${await getToken(true)}` } });
    if (!res.ok) throw new Error(`Could not load the messages (HTTP ${res.status}).`);
    if (!res.body || !res.body.getReader) return res.json();
    const reader = res.body.getReader();
    const chunks = [];
    let bytes = 0;
    let shown = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      bytes += value.byteLength;
      if (bytes - shown > 4e6) {
        shown = bytes;
        onBytes(bytes);
      }
    }
    return JSON.parse(await new Blob(chunks).text());
  }

  function setBookmarks(list) {
    const map = new Map();
    for (const b of list) {
      if (!b || !b.messageId) continue;
      if (!map.has(b.messageId)) map.set(b.messageId, []);
      map.get(b.messageId).push(b.name || '');
    }
    bookmarks = map;
  }

  async function loadBookmarks(id) {
    try {
      setBookmarks(await storage.list(id));
    } catch {
      /** No chrome.storage when injected for tests: no bookmarks. */
      bookmarks = new Map();
    }
    watchBookmarks(id);
  }

  /** Bookmarks added, renamed or removed (🔖 panel, another tab) show at once. */
  function watchBookmarks(id) {
    if (watchedId === id) return;
    if (unwatch) unwatch();
    unwatch = null;
    watchedId = null;
    try {
      unwatch = storage.watch(id, (list) => {
        if (!data || data.convoId !== id) return;
        setBookmarks(list);
        if (isOpen) rebuild(anchorId());
      });
      watchedId = id;
    } catch {
      /* no chrome.storage.onChanged */
    }
  }

  /** A bookmark's name as the tree shows it. The default name starts with
   *  the date, which would eat the room; the hover card has the full name. */
  function bmLabel(names) {
    const name = (names[0] || '').trim();
    const short = name.replace(/^\d{1,2}\.\d{1,2}\.\d{2,4}\s+(?=\S)/, '') || 'Bookmark';
    return names.length > 1 ? `${short} +${names.length - 1}` : short;
  }

  /**
   * Fetch (or reuse) the tree of the conversation on screen. force = ↻.
   * Switching chats resets folds and the view.
   */
  async function load(force) {
    const id = adapter.getConversationId();
    if (!id) {
      vis = null;
      showMsg('Open a conversation to see its tree.');
      requestDraw();
      return;
    }
    if (!data || data.convoId !== id) {
      data = cache.get(id) || null;
      if (data) {
        cache.delete(id);
        cache.set(id, data);
      }
      vis = null;
      collapsed = new Set();
      openStacks = new Set();
      fitted = false;
      inViewId = null;
      requestDraw();
    }
    if (data && !force && (data.total > AUTO_REFETCH_MAX || Date.now() - data.at < RELOAD_AFTER_MS)) {
      await loadBookmarks(id);
      onDom(true);
      if (!fitted) {
        fit(false);
        fitted = true;
      }
      return;
    }
    if (loading) {
      if (loadingId === id) return loading;
      /** Still fetching the chat we just left: let it finish, then start. */
      await loading;
      return load(force);
    }
    loadingId = id;
    loading = (async () => {
      try {
        setStatus('');
        if (!data) showMsg('Loading messages…');
        else setStatus('Reloading…');
        const msgs = await fetchMessages(id, (b) => {
          const text = `Loading messages… ${(b / 1048576).toFixed(0)} MB`;
          if (!data) showMsg(text);
          else setStatus(text);
        });
        if (adapter.getConversationId() !== id) return;
        if (!data) showMsg(`Building the tree of ${fmt(msgs.length)} messages…`);
        await tick();
        const keepView = !!data && data.convoId === id;
        const anchor = keepView ? anchorId() : null;
        data = TL.buildData(msgs);
        data.convoId = id;
        data.at = Date.now();
        cache.delete(id);
        cache.set(id, data);
        if (cache.size > CACHE_CHATS) cache.delete(cache.keys().next().value);
        reloadBtn.classList.remove('dot');
        reloadBtn.title = 'Reload from the server';
        await loadBookmarks(id);
        showMsg('');
        setStatus('');
        if (!data.total) {
          vis = null;
          showMsg('This conversation has no messages yet.');
          requestDraw();
          return;
        }
        readPath();
        spliceNew();
        rebuild(anchor);
        if (!fitted) {
          fit(false);
          fitted = true;
        }
        scheduleInView();
      } catch (err) {
        if (!data) showMsg(err.message, true);
        else setStatus(err.message, true);
      } finally {
        loading = null;
        loadingId = null;
      }
    })();
    return loading;
  }

  /** Displayed branch from the DOM. Returns the last id shared with the old one. */
  function readPath() {
    const ids = adapter.getDisplayedMessages().map((d) => d.id);
    let common = null;
    for (let i = 0; i < Math.min(ids.length, pathIds.length) && ids[i] === pathIds[i]; i++) common = ids[i];
    const changed = ids.length !== pathIds.length || common !== (ids.length ? ids[ids.length - 1] : null);
    pathIds = ids;
    pathSet = new Set(ids);
    /** A dead end you have been on stays spread out, so moving on later does
     *  not fold it back and reshuffle the picture under the mouse. */
    if (data) {
      for (const id of ids) {
        const n = data.nodes.get(id);
        if (n && !n.kids.length && n.sibs > 1) openStacks.add(n.parent);
      }
    }
    return { changed, common };
  }

  /** Messages on screen that the fetched tree does not have yet. */
  function spliceNew() {
    if (!data) return 0;
    const disp = adapter.getDisplayedMessages().filter((d) => UUID_RE.test(d.id));
    const unknown = disp.filter((d) => !data.nodes.has(d.id)).map((d) => d.id);
    if (!unknown.length) return 0;
    const added = TL.spliceDisplayed(
      data,
      disp.map((d) =>
        data.nodes.has(d.id)
          ? { id: d.id }
          : { id: d.id, user: !!d.el.querySelector('.user-turn'), preview: adapter.getMessageText(d.el) },
      ),
    );
    if (!added) return 0;
    const key = unknown.join(',');
    if (data.total <= AUTO_REFETCH_MAX && key !== refetchedFor) {
      refetchedFor = key;
      clearTimeout(refetchTimer);
      refetchTimer = setTimeout(() => isOpen && load(true), 4000);
    } else if (data.total > AUTO_REFETCH_MAX) {
      reloadBtn.classList.add('dot');
      reloadBtn.title = 'New messages since the tree was loaded. Reload for exact previews.';
    }
    return added;
  }

  /** DOM changed (branch switched, message sent, chat opened). */
  function onDom(forceRebuild = false) {
    if (!isOpen) return;
    const id = adapter.getConversationId();
    if (!data || data.convoId !== id) {
      if (id && !loading) load(false);
      return;
    }
    const { changed, common } = readPath();
    const added = spliceNew();
    if (changed) hideCard();
    if (changed || added || forceRebuild) rebuild(common || anchorId());
    scheduleInView();
  }

  // ----------------------------------------------------------------- layout

  const wx = (v) => PAD + (v.x - vis.minX) * COL_W;
  const wy = (v) => PAD + (v.row - vis.rowBase) * ROW_H;

  /** Message to keep still across a relayout: hovered, else reading, else none. */
  function anchorId() {
    if (hover && hover.v.kind === 'msg') return hover.v.id;
    return inViewId || null;
  }

  /**
   * Rebuild the visual tree. The anchor message keeps its spot on screen, so
   * folding or a branch switch does not throw the picture around.
   */
  function rebuild(anchor) {
    if (!data || !data.total) return;
    showMsg('');
    /** Screen spot of whatever stands for the anchor now (itself, its stack,
     *  a folded ancestor); afterwards whatever stands for it goes there. */
    let keep = null;
    if (vis && anchor) {
      const v = visibleFor(anchor);
      if (v) keep = { id: anchor, sx: wx(v) * view.s + view.tx, sy: wy(v) * ys() + view.ty };
    }
    const { root, list } = TL.buildVisual(data, {
      collapsed,
      openStacks,
      stack: stackOn,
      path: pathSet,
      keep: bookmarks,
    });
    const b = TL.layoutVisual(list);
    /** One first message: no "Start" node above it. */
    const single = root.kids.length === 1 && root.kids[0].kind === 'msg';
    const rowBase = single ? 1 : 0;
    const drawList = single ? list.slice(1) : list;
    const rows = [];
    const byId = new Map();
    const stackOf = new Map();
    for (const v of drawList) {
      (rows[v.row] || (rows[v.row] = [])).push(v);
      byId.set(v.id, v);
      if (v.kind === 'stack') for (const id of v.ids) stackOf.set(id, v);
    }
    for (const r of rows) if (r) r.sort((a, z) => a.x - z.x);
    vis = {
      root,
      list: drawList,
      rows,
      byId,
      stackOf,
      single,
      minX: b.minX,
      maxX: b.maxX,
      maxRow: b.maxRow,
      rowBase,
      worldW: PAD * 2 + (b.maxX - b.minX) * COL_W + NODE_W,
      worldH: PAD * 2 + (b.maxRow - rowBase) * ROW_H + NODE_H + 24,
      /** Folded node id -> names of the bookmarks hidden below it. */
      bmInside: new Map(),
    };
    for (const [id, names] of bookmarks) {
      if (byId.has(id)) continue;
      const v = visibleFor(id);
      if (!v || v.kind !== 'msg') continue;
      if (!vis.bmInside.has(v.id)) vis.bmInside.set(v.id, []);
      vis.bmInside.get(v.id).push(bmLabel(names));
    }
    if (hover) hover = byId.get(hover.v.id) ? { ...hover, v: byId.get(hover.v.id) } : null;
    if (keep) {
      const v = visibleFor(keep.id);
      if (v) {
        showingAll = false;
        view.tx = keep.sx - wx(v) * view.s;
        view.ty = keep.sy - wy(v) * ys();
      }
    }
    miniCache = null;
    statsEl.textContent =
      `${fmt(data.total)} messages · ${fmt(data.forks)} fork${data.forks === 1 ? '' : 's'} · ` +
      `${fmt(data.ends)} branch end${data.ends === 1 ? '' : 's'}`;
    requestDraw();
  }

  /** The visual node standing for a message: itself, its stack, or the
   *  nearest ancestor still shown when it is folded away. */
  function visibleFor(id) {
    if (!vis) return null;
    let cur = id;
    for (let guard = 0; cur && guard < 100000; guard++) {
      const v = vis.byId.get(cur) || vis.stackOf.get(cur);
      if (v) return v;
      const n = data && data.nodes.get(cur);
      if (!n || n.parent === TL.NO_PARENT) return null;
      cur = n.parent;
    }
    return null;
  }

  // ------------------------------------------------------------------- view

  function fitScale() {
    if (!vis) return 1;
    return Math.min(stage.clientWidth / vis.worldW, stage.clientHeight / vis.worldH);
  }

  /**
   * Vertical zoom for a horizontal zoom s. A bushy chat is far wider than
   * tall (one long chat: 624 columns, 73 rows), so zoomed out the rows never get
   * squeezed below what fills the panel's height: the overview is the whole
   * shape, not a thin strip. Up from BOX_ZOOM it is always s, so boxes and
   * text keep their true proportions.
   */
  function ys(s = view.s) {
    if (!vis || !stage.clientHeight) return s;
    return Math.max(s, Math.min(BOX_ZOOM, stage.clientHeight / vis.worldH));
  }
  function minScale() {
    return Math.min(fitScale() * 0.6, 0.25);
  }

  /** Whole tree in view (never zoomed past 100%). */
  function fit(animate) {
    if (!vis) return;
    const s = Math.min(fitScale(), 1);
    const cw = stage.clientWidth;
    const ch = stage.clientHeight;
    const tx = (cw - vis.worldW * s) / 2;
    const ty = Math.max(0, (ch - vis.worldH * ys(s)) / 2);
    setView(s, tx, ty, animate);
    showingAll = true;
  }

  /** Center a message (or what stands for it) at a readable zoom. */
  function centerOn(id, animate = true) {
    const v = visibleFor(id);
    if (!v) return;
    const s = Math.max(view.s, 0.85);
    const cw = stage.clientWidth;
    const ch = stage.clientHeight;
    setView(s, cw / 2 - (wx(v) + NODE_W / 2) * s, ch * 0.4 - (wy(v) + NODE_H / 2) * s, animate);
  }

  function centerHere() {
    const id = computeInView() || pathIds[pathIds.length - 1];
    if (id) centerOn(id);
  }

  /** Any manual move wins over a running Fit/Here/zoom-in animation. */
  function stopAnim() {
    cancelAnimationFrame(anim);
    anim = null;
    animToken = null;
  }

  function setView(s, tx, ty, animate) {
    showingAll = false;
    stopAnim();
    if (!animate || document.hidden) {
      Object.assign(view, { s, tx, ty });
      requestDraw();
      return;
    }
    /** Ease the world point at the stage center and the zoom (in log space). */
    const cw = stage.clientWidth / 2;
    const ch = stage.clientHeight / 2;
    const s0 = view.s;
    const c0 = { x: (cw - view.tx) / s0, y: (ch - view.ty) / ys(s0) };
    const c1 = { x: (cw - tx) / s, y: (ch - ty) / ys(s) };
    const t0 = performance.now();
    let ran = false;
    const token = (animToken = {});
    /** No frame soon (minimized window): land at once instead of hanging. */
    setTimeout(() => {
      if (ran || animToken !== token) return;
      cancelAnimationFrame(anim);
      anim = null;
      Object.assign(view, { s, tx, ty });
      requestDraw();
    }, 120);
    const step = (now) => {
      ran = true;
      const k = Math.min(1, (now - t0) / 240);
      const e = 1 - (1 - k) ** 3;
      const sk = s0 * (s / s0) ** e;
      view.s = sk;
      view.tx = cw - (c0.x + (c1.x - c0.x) * e) * sk;
      view.ty = ch - (c0.y + (c1.y - c0.y) * e) * ys(sk);
      draw();
      anim = k < 1 ? requestAnimationFrame(step) : null;
    };
    anim = requestAnimationFrame(step);
  }

  function zoomAt(mx, my, factor) {
    showingAll = false;
    stopAnim();
    const s1 = view.s;
    const s2 = clamp(s1 * factor, minScale(), MAX_S);
    const sy1 = ys(s1);
    view.tx = mx - (mx - view.tx) * (s2 / s1);
    view.ty = my - (my - view.ty) * (ys(s2) / sy1);
    view.s = s2;
    requestDraw();
  }

  function panBy(dx, dy) {
    showingAll = false;
    stopAnim();
    view.tx += dx;
    view.ty += dy;
    requestDraw();
  }

  // ------------------------------------------------------------- input

  function toWorld(e) {
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    return { sx, sy, x: (sx - view.tx) / view.s, y: (sy - view.ty) / ys() };
  }

  function wireCanvas() {
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      canvas.focus({ preventScroll: true });
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false };
      capture(canvas, e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (drag && drag.id === e.pointerId) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 4) {
          drag.moved = true;
          canvas.classList.add('drag');
          hover = null;
          hideCard();
        }
        if (drag.moved) {
          showingAll = false;
          stopAnim();
          view.tx = drag.tx + dx;
          view.ty = drag.ty + dy;
          requestDraw();
          return;
        }
      }
      updateHover(e);
    });
    const end = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const click = !drag.moved && e.type === 'pointerup';
      drag = null;
      canvas.classList.remove('drag');
      if (click) onClick(e);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => {
      if (drag) return;
      hover = null;
      hideCard();
      requestDraw();
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = toWorld(e);
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
        if (e.shiftKey && !e.ctrlKey) {
          panBy(-(e.deltaY || e.deltaX) * unit, 0);
          return;
        }
        zoomAt(p.sx, p.sy, Math.exp(-e.deltaY * unit * 0.0015));
        updateHover(e);
      },
      { passive: false },
    );
  }

  function wireMini() {
    const moveTo = (e) => {
      if (!vis) return;
      const r = mini.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * vis.worldW;
      const y = ((e.clientY - r.top) / r.height) * vis.worldH;
      showingAll = false;
      stopAnim();
      view.tx = stage.clientWidth / 2 - x * view.s;
      view.ty = stage.clientHeight / 2 - y * ys();
      requestDraw();
    };
    mini.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      capture(mini, e);
      moveTo(e);
    });
    mini.addEventListener('pointermove', (e) => {
      if (e.buttons & 1) moveTo(e);
    });
  }

  /**
   * Visual node under a world point. zone 'toggle' = the fold control under
   * a node that has replies. Zoomed far out, the nearest dot within a few
   * screen pixels counts.
   */
  function hitTest(px, py) {
    if (!vis) return null;
    const s = view.s;
    const sy = ys(s);
    const far = s < BOX_ZOOM;
    const r = far
      ? Math.round((py - PAD - NODE_H / 2) / ROW_H) + vis.rowBase
      : Math.floor((py - PAD) / ROW_H) + vis.rowBase;
    const row = vis.rows[r];
    if (!row) return null;
    const col = Math.round((px - PAD - NODE_W / 2) / COL_W) + vis.minX;
    let lo = 0;
    let hi = row.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (row[mid].x < col) lo = mid + 1;
      else hi = mid;
    }
    const v = row[lo];
    if (!v || v.x !== col) return null;
    const x = wx(v);
    const y = wy(v);
    const cx = x + NODE_W / 2;
    if (far) {
      /** Dots are at least 2 screen px; give them 5 px of slack around. */
      const w = Math.max(NODE_W, 2 / s);
      const h = Math.max(NODE_H, 2 / sy);
      if (Math.abs(px - cx) <= w / 2 + 5 / s && Math.abs(py - (y + h / 2)) <= h / 2 + 5 / sy) return { v, zone: 'node' };
      return null;
    }
    if (px < x - 4 || px > x + NODE_W + 4) return null;
    if (v.kind === 'msg' && v.n.kids.length && Math.abs(py - (y + NODE_H + 2)) <= 10) {
      const half = collapsed.has(v.id) ? pillWidth(v) / 2 + 2 : 11;
      if (Math.abs(px - cx) <= half) return { v, zone: 'toggle' };
    }
    if (py >= y && py <= y + NODE_H) return { v, zone: 'node' };
    return null;
  }

  /** A bookmark label (zoomed out) under a stage point. */
  function labelAt(sx, sy) {
    if (view.s >= TEXT_ZOOM) return null;
    for (const l of labelHits) {
      if (sx >= l.x && sx <= l.x + l.w && sy >= l.y && sy <= l.y + l.h) return { v: l.v, zone: 'label' };
    }
    return null;
  }

  function updateHover(e) {
    const p = toWorld(e);
    const h = labelAt(p.sx, p.sy) || hitTest(p.x, p.y);
    const same = h && hover && h.v === hover.v && h.zone === hover.zone;
    if (!same && (h || hover)) {
      hover = h;
      requestDraw();
    }
    canvas.classList.toggle('hit', !!h);
    if (h) showCard(h, p.sx, p.sy);
    else hideCard();
  }

  function onClick(e) {
    const p = toWorld(e);
    /** A bookmark's label is not a blind click: it jumps right away. */
    const label = labelAt(p.sx, p.sy);
    if (label) {
      jumpTo(label.v.id);
      return;
    }
    if (view.s < TEXT_ZOOM) {
      /** Zoomed out, a click zooms in on the spot instead of jumping blind. */
      const s = 0.9;
      setView(s, p.sx - p.x * s, p.sy - p.y * s, true);
      return;
    }
    const h = hitTest(p.x, p.y);
    if (!h) return;
    const v = h.v;
    if (v.kind === 'msg' && (h.zone === 'toggle' || e.altKey)) {
      if (collapsed.has(v.id)) collapsed.delete(v.id);
      else collapsed.add(v.id);
      rebuild(v.id);
      return;
    }
    if (v.kind === 'stack') {
      openStacks.add(v.fork);
      rebuild(v.ids[0]);
      hideCard();
      return;
    }
    if (v.kind === 'msg') jumpTo(v.id);
  }

  async function jumpTo(id) {
    if (jumping) return;
    jumping = true;
    const convoId = adapter.getConversationId();
    setStatus('Opening that branch…');
    try {
      await navigate.jumpToMessage(convoId, id, (s) => setStatus(s || ''));
      setStatus('');
    } catch (err) {
      setStatus(err.message, true);
    } finally {
      jumping = false;
      setTimeout(() => onDom(), 300);
    }
  }

  // ------------------------------------------------------------ hover card

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(+d)) return '';
    return d.toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function line(cls, text) {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    return el;
  }

  function showCard(h, sx, sy) {
    const v = h.v;
    const far = view.s < TEXT_ZOOM;
    card.replaceChildren();
    if (v.kind === 'msg') {
      const n = v.n;
      const head = document.createElement('div');
      head.className = 'head';
      const who = document.createElement('b');
      who.textContent = n.user ? 'You' : n.sender || 'AI';
      head.append(who);
      const bits = [`#${v.row}`];
      if (n.sibs > 1) bits.push(`version ${n.idx} of ${n.sibs}`);
      const when = fmtDate(n.created);
      if (when) bits.push(when);
      head.append(` · ${bits.join(' · ')}`);
      card.append(head);
      const names = bookmarks.get(n.id);
      if (names) card.append(line('bm', names.map((name) => `🔖 ${name}`).join('\n')));
      card.append(line('body', n.preview.length > 360 ? `${n.preview.slice(0, 360)}…` : n.preview));
      const foot = [];
      if (n.kids.length) foot.push(`${fmt(n.size - 1)} message${n.size === 2 ? '' : 's'} below · ${fmt(n.ends)} branch end${n.ends === 1 ? '' : 's'}`);
      if (n.provisional) foot.push('new since the tree was loaded');
      if (foot.length) card.append(line('foot', foot.join('\n')));
      const inside = vis.bmInside.get(n.id);
      if (inside) {
        const more = inside.length > 4 ? ` · +${inside.length - 4} more` : '';
        card.append(line('bm', `🔖 folded below: ${inside.slice(0, 4).join(' · ')}${more}`));
      }
      let hint;
      if (h.zone === 'label') hint = pathSet.has(n.id) ? 'On your branch: click to scroll there' : 'Click to switch the chat to this bookmark';
      else if (far) hint = 'Click to zoom in here';
      else if (h.zone === 'toggle') hint = collapsed.has(n.id) ? 'Click to unfold this branch' : 'Click to fold this branch';
      else if (pathSet.has(n.id)) hint = 'On your branch: click to scroll there';
      else hint = 'Click to switch the chat to this branch';
      card.append(line('hint', hint));
    } else if (v.kind === 'stack') {
      const head = document.createElement('div');
      head.className = 'head';
      const b = document.createElement('b');
      b.textContent = `${v.ids.length} dead-end versions`;
      head.append(b, ' · no replies under them');
      const body = document.createElement('div');
      body.className = 'body';
      for (const id of v.ids.slice(0, 4)) {
        const n = data.nodes.get(id);
        body.append(line('', `${n.idx}/${n.sibs}: ${n.preview.slice(0, 90)}${n.preview.length > 90 ? '…' : ''}`));
      }
      if (v.ids.length > 4) body.append(line('', `… and ${v.ids.length - 4} more`));
      card.append(head, body, line('hint', far ? 'Click to zoom in here' : 'Click to spread them out'));
    } else {
      card.append(line('head', 'Conversation start'), line('body', `${data.roots.length} versions of the first message`));
    }
    card.hidden = false;
    const cw = stage.clientWidth;
    const ch = stage.clientHeight;
    const r = card.getBoundingClientRect();
    let left = sx + 16;
    let top = sy + 16;
    if (left + r.width > cw - 8) left = Math.max(8, sx - r.width - 16);
    if (top + r.height > ch - 8) top = Math.max(8, sy - r.height - 16);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  function hideCard() {
    if (card) card.hidden = true;
  }

  // ------------------------------------------------------------- in view

  /** The displayed message crossing a line a third down the transcript. */
  function computeInView() {
    const disp = adapter.getDisplayedMessages();
    if (!disp.length) return null;
    const scroller = adapter.getScroller(disp[0].el);
    const box = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: innerHeight };
    const top = box.top + (scroller ? adapter.HEADER_OVERLAY_PX : 0);
    const y = top + (box.bottom - top) / 3;
    let best = null;
    let bestDist = Infinity;
    for (const d of disp) {
      const r = d.el.getBoundingClientRect();
      const dist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (dist < bestDist) {
        bestDist = dist;
        best = d.id;
      }
      if (r.top > y) break;
    }
    return best;
  }

  function scheduleInView() {
    if (inViewTimer) return;
    inViewTimer = setTimeout(() => {
      inViewTimer = null;
      if (!isOpen) return;
      const id = computeInView();
      if (id !== inViewId) {
        inViewId = id;
        requestDraw();
      }
    }, 150);
  }

  // ---------------------------------------------------------------- drawing

  function requestDraw() {
    if (drawPending) return;
    drawPending = true;
    const run = () => {
      if (!drawPending) return;
      drawPending = false;
      draw();
    };
    /** Whichever comes first: a minimized window can stall rAF while
     *  document.hidden is still false, and a hidden page never runs it. */
    if (!document.hidden) requestAnimationFrame(run);
    setTimeout(run, 50);
  }

  const onPath = (v) => (v.kind === 'msg' ? pathSet.has(v.id) : v.kind === 'root');

  function draw() {
    if (!isOpen || !ctx) return;
    const t0 = performance.now();
    const dpr = window.devicePixelRatio || 1;
    const cw = stage.clientWidth;
    const ch = stage.clientHeight;
    const W = Math.round(cw * dpr);
    const H = Math.round(ch * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    if (!vis) {
      mini.hidden = true;
      return;
    }
    const s = view.s;
    const sy = ys(s);
    const x0 = -view.tx / s;
    const x1 = x0 + cw / s;
    const y0 = -view.ty / sy;
    const y1 = y0 + ch / sy;
    const rA = Math.max(vis.rowBase, Math.floor((y0 - PAD) / ROW_H) + vis.rowBase - 1);
    const rB = Math.min(vis.maxRow, Math.ceil((y1 - PAD) / ROW_H) + vis.rowBase);
    /** Edges and dots in screen px (rows may be stretched), boxes in world units. */
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawEdges(rA, rB, x0, x1, s, sy);
    if (s >= BOX_ZOOM) ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * view.tx, dpr * view.ty);
    drawNodes(rA, rB, x0, x1, s, sy);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    labelHits = [];
    if (s < TEXT_ZOOM) drawLandmarks(rA, rB, s, sy, cw, ch);
    drawMini(cw, ch);
    lastDrawMs = performance.now() - t0;
  }

  /** Bus edges: parent down to a rail, rail across the children, down into each. */
  function drawEdges(rA, rB, x0, x1, s, sy) {
    const X = (x) => view.tx + x * s;
    const Y = (y) => view.ty + y * sy;
    const half = (ROW_H - NODE_H) / 2;
    const gold = [];
    ctx.beginPath();
    for (let r = Math.max(vis.rowBase, rA - 1); r <= rB; r++) {
      const row = vis.rows[r];
      if (!row) continue;
      for (const v of row) {
        if (!v.kids.length) continue;
        const px = wx(v) + NODE_W / 2;
        const left = Math.min(px, wx(v.kids[0]) + NODE_W / 2);
        const right = Math.max(px, wx(v.kids[v.kids.length - 1]) + NODE_W / 2);
        if (right < x0 || left > x1) continue;
        const top = Y(wy(v) + NODE_H);
        const rail = Y(wy(v) + NODE_H + half);
        const bottom = Y(wy(v) + ROW_H);
        ctx.moveTo(X(px), top);
        ctx.lineTo(X(px), rail);
        if (right > left) {
          ctx.moveTo(X(left), rail);
          ctx.lineTo(X(right), rail);
        }
        for (const c of v.kids) {
          const cx = wx(c) + NODE_W / 2;
          if (cx < x0 - 4 || cx > x1 + 4) continue;
          ctx.moveTo(X(cx), rail);
          ctx.lineTo(X(cx), bottom);
        }
        if (onPath(v)) {
          const pc = v.kids.find(onPath);
          if (pc) gold.push(X(px), top, rail, X(wx(pc) + NODE_W / 2), bottom);
        }
      }
    }
    ctx.strokeStyle = C.edge;
    ctx.lineWidth = clamp(1.25 * s, 1, 2.5);
    ctx.stroke();
    if (gold.length) {
      ctx.beginPath();
      for (let i = 0; i < gold.length; i += 5) {
        ctx.moveTo(gold[i], gold[i + 1]);
        ctx.lineTo(gold[i], gold[i + 2]);
        ctx.lineTo(gold[i + 3], gold[i + 2]);
        ctx.lineTo(gold[i + 3], gold[i + 4]);
      }
      ctx.strokeStyle = C.path;
      ctx.lineWidth = clamp(2.5 * s, 2, 5);
      ctx.stroke();
    }
  }

  function drawNodes(rA, rB, x0, x1, s, sy) {
    const boxes = s >= BOX_ZOOM;
    const text = s >= TEXT_ZOOM;
    let ringV = null;
    for (let r = rA; r <= rB; r++) {
      const row = vis.rows[r];
      if (!row) continue;
      const colMin = (x0 - PAD - NODE_W) / COL_W + vis.minX;
      let lo = 0;
      let hi = row.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (row[mid].x < colMin) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < row.length; i++) {
        const v = row[i];
        const x = wx(v);
        if (x > x1) break;
        const y = wy(v);
        if (v.kind === 'msg' && v.id === inViewId) ringV = v;
        if (!boxes) drawDot(v, view.tx + x * s, view.ty + y * sy, s, sy);
        else if (v.kind === 'stack') drawStack(v, x, y, s, text);
        else drawBox(v, x, y, s, text);
      }
    }
    if (inViewId && !ringV) {
      /** Reading a message that sits in a stack or a folded branch. */
      const v = visibleFor(inViewId);
      if (v && v.row >= rA && v.row <= rB) ringV = v;
    }
    if (!ringV) return;
    ctx.strokeStyle = C.ring;
    ctx.beginPath();
    if (boxes) {
      ctx.lineWidth = Math.max(2, 2 / s);
      ctx.roundRect(wx(ringV) - 5, wy(ringV) - 5, NODE_W + 10, NODE_H + 10, 10);
    } else {
      ctx.lineWidth = 2;
      const x = view.tx + wx(ringV) * s;
      const y = view.ty + wy(ringV) * sy;
      ctx.rect(x - 3, y - 3, Math.max(2, NODE_W * s) + 6, Math.max(2, NODE_H * sy) + 6);
    }
    ctx.stroke();
  }

  /** Zoomed far out: a plain colored rect in screen px, at least 2 px.
   *  Bookmarks are left to drawLandmarks, which puts them on top. */
  function drawDot(v, x, y, s, sy) {
    if (v.kind === 'msg' && bookmarks.has(v.id)) return;
    const path = onPath(v);
    ctx.globalAlpha = path ? 1 : 0.7;
    ctx.fillStyle = path
      ? C.path
      : v.kind === 'stack'
        ? C.stackLine
        : v.kind === 'root'
          ? C.sub
          : v.n.error
            ? C.errStrip
            : v.n.user
              ? C.userStrip
              : C.aiStrip;
    ctx.fillRect(x, y, Math.max(2, NODE_W * s), Math.max(2, NODE_H * sy));
    ctx.globalAlpha = 1;
  }

  function drawBox(v, x, y, s, text) {
    const path = onPath(v);
    const hov = hover && hover.v === v;
    const n = v.n;
    const isRoot = v.kind === 'root';
    const names = isRoot ? null : bookmarks.get(n.id);
    ctx.beginPath();
    ctx.roundRect(x, y, NODE_W, NODE_H, 7);
    ctx.fillStyle = hov
      ? names
        ? C.bmHoverFill
        : C.hoverFill
      : isRoot
        ? C.stackFill
        : names
          ? C.bmFill
          : n.user
            ? C.userFill
            : C.aiFill;
    ctx.fill();
    ctx.lineWidth = path ? Math.max(2, 2 / s) : names ? Math.max(1.5, 1.5 / s) : Math.max(1, 1 / s);
    ctx.strokeStyle = path ? C.path : names ? C.bm : C.border;
    ctx.stroke();
    if (!isRoot) {
      ctx.fillStyle = n.error ? C.errStrip : n.user ? C.userStrip : C.aiStrip;
      ctx.fillRect(x + 1, y + 7, 3, NODE_H - 14);
    }
    /** Bookmark ribbon on the top edge. */
    if (names) ribbon(x + NODE_W - 15, y - 1, 9, 13);
    if (text) {
      ctx.textBaseline = 'alphabetic';
      ctx.font = FONT_HEAD;
      if (isRoot) {
        ctx.textAlign = 'left';
        ctx.fillStyle = C.text;
        ctx.fillText('Start', x + 10, y + 17);
        ctx.font = FONT_BODY;
        ctx.fillStyle = C.sub;
        ctx.fillText(`${data.roots.length} versions of the first message`, x + 10, y + 34, NODE_W - 18);
        return;
      }
      /** A bookmark's name takes the sender's place (the strip still says
       *  who), and when both do not fit it wins over the "#24 · 2/9". */
      const meta = `#${v.row}${n.sibs > 1 ? ` · ${n.idx}/${n.sibs}` : ''}`;
      const left = x + 10;
      const right = x + NODE_W - (names ? 20 : 8);
      const head = names ? bmLabel(names) : n.user ? 'You' : n.sender || 'AI';
      let metaW = ctx.measureText(meta).width + 8;
      if (names && ctx.measureText(head).width > right - left - metaW) metaW = 0;
      if (metaW) {
        ctx.textAlign = 'right';
        ctx.fillStyle = C.sub;
        ctx.fillText(meta, right, y + 17);
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = names ? C.bmText : path ? C.path : C.text;
      const headW = right - metaW - left;
      ctx.fillText(names ? bmFit(names, headW) : clip(head, headW), left, y + 17);
      ctx.font = FONT_BODY;
      ctx.fillStyle = path ? '#dcdce6' : C.sub;
      const lines = wrap(n);
      ctx.fillText(lines[0], x + 10, y + 33);
      ctx.fillText(lines[1], x + 10, y + 47);
    }
    if (isRoot || !n.kids.length) return;
    if (collapsed.has(n.id)) drawPill(v, x, y, s, hov && hover.zone === 'toggle');
    else if (hov && text) drawFoldButton(x, y, s, hover.zone === 'toggle');
  }

  function drawStack(v, x, y, s, text) {
    const hov = hover && hover.v === v;
    ctx.lineWidth = Math.max(1, 1 / s);
    for (const d of [6, 3]) {
      ctx.beginPath();
      ctx.roundRect(x + d, y - d, NODE_W, NODE_H, 7);
      ctx.fillStyle = '#23232a';
      ctx.fill();
      ctx.strokeStyle = C.stackLine;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.roundRect(x, y, NODE_W, NODE_H, 7);
    ctx.fillStyle = hov ? C.hoverFill : C.stackFill;
    ctx.fill();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = C.stackLine;
    ctx.stroke();
    ctx.setLineDash([]);
    if (!text) return;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = FONT_HEAD;
    ctx.fillStyle = C.text;
    ctx.fillText(`+${v.ids.length} more versions`, x + 10, y + 21);
    ctx.font = FONT_BODY;
    ctx.fillStyle = C.sub;
    ctx.fillText('dead ends · click to show', x + 10, y + 39);
  }

  /** Bookmark ribbon: a strip with a notch cut into its bottom. */
  function ribbon(bx, by, w, h) {
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + w, by);
    ctx.lineTo(bx + w, by + h);
    ctx.lineTo(bx + w / 2, by + h * 0.7);
    ctx.lineTo(bx, by + h);
    ctx.closePath();
    ctx.fillStyle = C.bm;
    ctx.fill();
  }

  function pillWidth(v) {
    ctx.font = FONT_HEAD;
    return ctx.measureText(`+${fmt(v.n.size - 1)}`).width + 14 + (vis.bmInside.has(v.id) ? 12 : 0);
  }

  /** "+N" under a folded node; click it to unfold. Green with a ribbon
   *  when bookmarks are folded away under it. */
  function drawPill(v, x, y, s, hot) {
    const w = pillWidth(v);
    const marked = vis.bmInside.has(v.id);
    const cx = x + NODE_W / 2;
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, y + NODE_H - 6, w, 17, 8.5);
    ctx.fillStyle = hot ? '#4a4a60' : '#33333f';
    ctx.fill();
    ctx.lineWidth = Math.max(1, 1 / s);
    ctx.strokeStyle = marked ? C.bm : C.stackLine;
    ctx.stroke();
    if (s < TEXT_ZOOM) return;
    ctx.font = FONT_HEAD;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = C.text;
    ctx.fillText(`+${fmt(v.n.size - 1)}`, cx - (marked ? 6 : 0), y + NODE_H + 2.5);
    ctx.textBaseline = 'alphabetic';
    if (marked) ribbon(cx + w / 2 - 15, y + NODE_H - 2, 7, 10);
  }

  /**
   * Zoomed out, bookmarks are landmarks: their dots go on top of the rest,
   * and their names float above them as labels. Your branch's bookmarks are
   * placed first, then the rest from the top row down; a label that would
   * overlap one already placed is skipped (zoom in to see it). The labels
   * are clickable (labelHits). Screen px.
   */
  function drawLandmarks(rA, rB, s, sy, cw, ch) {
    const items = [];
    for (const [id, names] of bookmarks) {
      const v = vis.byId.get(id);
      if (!v || v.row < rA || v.row > rB) continue;
      const w = Math.max(2, NODE_W * s);
      const h = Math.max(2, NODE_H * sy);
      const x = view.tx + wx(v) * s;
      const y = view.ty + wy(v) * sy;
      const cx = x + w / 2;
      if (cx < 0 || cx > cw || y + h < 0 || y > ch + 22) continue;
      items.push({ v, names, x, y, w, h, cx, path: pathSet.has(id) });
    }
    if (!items.length) return;
    if (s < BOX_ZOOM) {
      for (const it of items) {
        const w = Math.max(5, it.w);
        const h = Math.max(5, it.h);
        ctx.fillStyle = C.bm;
        ctx.fillRect(it.cx - w / 2, it.y + it.h / 2 - h / 2, w, h);
        ctx.lineWidth = 1;
        ctx.strokeStyle = it.path ? C.path : C.bg;
        ctx.strokeRect(it.cx - w / 2 - 0.5, it.y + it.h / 2 - h / 2 - 0.5, w + 1, h + 1);
      }
    }
    const hotId = hover && hover.zone === 'label' ? hover.v.id : null;
    items.sort((a, z) => (z.v.id === hotId) - (a.v.id === hotId) || z.path - a.path || a.v.row - z.v.row || a.x - z.x);
    ctx.font = FONT_LABEL;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const lh = 17;
    for (const it of items) {
      const text = bmLabel(it.names);
      const lw = Math.min(LABEL_MAX_W, Math.ceil(ctx.measureText(text).width) + 12);
      /** Slid inward at the edges; it still spans its dot (cx is on screen). */
      const lx = clamp(it.cx - lw / 2, 2, cw - lw - 2);
      let ly = it.y - lh - 3;
      if (ly < 2) ly = it.y + it.h + 3;
      if (labelHits.some((p) => lx < p.x + p.w + 4 && lx + lw + 4 > p.x && ly < p.y + p.h + 2 && ly + lh + 2 > p.y)) continue;
      labelHits.push({ x: lx, y: ly, w: lw, h: lh, v: it.v });
      ctx.beginPath();
      ctx.roundRect(lx, ly, lw, lh, 5);
      ctx.fillStyle = it.v.id === hotId ? C.bmHoverFill : C.bmFill;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = it.path ? C.path : C.bm;
      ctx.stroke();
      ctx.fillStyle = C.bmText;
      ctx.fillText(bmFit(it.names, lw - 12), lx + 6, ly + lh / 2 + 0.5);
    }
    ctx.textBaseline = 'alphabetic';
  }

  /** ⊖ under the hovered node: folds its branch. */
  function drawFoldButton(x, y, s, hot) {
    const cx = x + NODE_W / 2;
    const cy = y + NODE_H + 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = hot ? '#4a4a60' : '#33333f';
    ctx.fill();
    ctx.lineWidth = Math.max(1, 1 / s);
    ctx.strokeStyle = C.stackLine;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy);
    ctx.lineTo(cx + 4, cy);
    ctx.strokeStyle = C.text;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  /** Text cut to a width with an ellipsis (current ctx font). */
  function clip(str, maxW) {
    if (ctx.measureText(str).width <= maxW) return str;
    let lo = 0;
    let hi = str.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(`${str.slice(0, mid)}…`).width <= maxW) lo = mid;
      else hi = mid - 1;
    }
    return `${str.slice(0, lo).trimEnd()}…`;
  }

  /** bmLabel cut to a width (current ctx font), keeping the "+1" for a
   *  second bookmark on the same message. */
  function bmFit(names, maxW) {
    const full = bmLabel(names);
    if (names.length < 2 || ctx.measureText(full).width <= maxW) return clip(full, maxW);
    const more = ` +${names.length - 1}`;
    return clip(bmLabel(names.slice(0, 1)), maxW - ctx.measureText(more).width) + more;
  }

  /** Two preview lines, measured once per message (FONT_BODY must be set). */
  function wrap(n) {
    if (n._wrap) return n._wrap;
    const maxW = NODE_W - 18;
    const words = n.preview.split(' ');
    const lines = ['', ''];
    let li = 0;
    for (let i = 0; i < words.length && li < 2; i++) {
      const cand = lines[li] ? `${lines[li]} ${words[i]}` : words[i];
      if (ctx.measureText(cand).width <= maxW) {
        lines[li] = cand;
        continue;
      }
      if (li === 0) {
        if (!lines[0]) lines[0] = clip(words[i], maxW);
        else i--;
        li = 1;
        continue;
      }
      lines[1] = clip(cand, maxW);
      li = 2;
    }
    n._wrap = lines;
    return lines;
  }

  /** Overview in the corner while zoomed in; a box marks the view. */
  function drawMini(cw, ch) {
    const show = view.s > fitScale() * 1.15 && cw > 360 && ch > 240;
    mini.hidden = !show;
    if (!show) return;
    const mw = Math.round(Math.min(180, cw * 0.3));
    const mh = Math.round(clamp((mw * vis.worldH) / vis.worldW, 30, 110));
    const dpr = window.devicePixelRatio || 1;
    if (!miniCache || miniCache.width !== Math.round(mw * dpr) || miniCache.height !== Math.round(mh * dpr)) {
      const off = document.createElement('canvas');
      off.width = Math.round(mw * dpr);
      off.height = Math.round(mh * dpr);
      const o = off.getContext('2d');
      const kx = off.width / vis.worldW;
      const ky = off.height / vis.worldH;
      o.fillStyle = 'rgba(18,18,24,.92)';
      o.fillRect(0, 0, off.width, off.height);
      const dot = (v) => o.fillRect(wx(v) * kx, wy(v) * ky, Math.max(1, NODE_W * kx), Math.max(1, NODE_H * ky));
      o.fillStyle = '#6b6b80';
      for (const v of vis.list) if (!onPath(v)) dot(v);
      o.fillStyle = C.path;
      for (const v of vis.list) if (onPath(v)) dot(v);
      /** Bookmarks on top, at least 2 CSS px so they show. */
      o.fillStyle = C.bm;
      const bw = Math.max(2 * dpr, NODE_W * kx);
      const bh = Math.max(2 * dpr, NODE_H * ky);
      for (const id of bookmarks.keys()) {
        const v = vis.byId.get(id);
        if (v) o.fillRect((wx(v) + NODE_W / 2) * kx - bw / 2, (wy(v) + NODE_H / 2) * ky - bh / 2, bw, bh);
      }
      miniCache = off;
    }
    if (mini.width !== miniCache.width || mini.height !== miniCache.height) {
      mini.width = miniCache.width;
      mini.height = miniCache.height;
      mini.style.width = `${mw}px`;
      mini.style.height = `${mh}px`;
    }
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.drawImage(miniCache, 0, 0);
    const kx = mini.width / vis.worldW;
    const ky = mini.height / vis.worldH;
    const vx = (-view.tx / view.s) * kx;
    const vy = (-view.ty / ys()) * ky;
    const vw = Math.max(3, (cw / view.s) * kx);
    const vh = Math.max(3, (ch / ys()) * ky);
    mctx.strokeStyle = '#ffffff';
    mctx.lineWidth = Math.max(1, dpr);
    mctx.strokeRect(vx, vy, vw, vh);
  }

  /** Test hook: where a message's node is on screen (CSS px in the stage). */
  function screenOf(id) {
    const v = visibleFor(id);
    if (!v) return null;
    const r = canvas.getBoundingClientRect();
    return {
      kind: v.kind,
      x: r.left + view.tx + (wx(v) + NODE_W / 2) * view.s,
      y: r.top + view.ty + (wy(v) + NODE_H / 2) * ys(),
    };
  }

  /** Test hook: ids of drawn nodes of one kind ('msg' | 'stack'), the
   *  ones with the most below them first. */
  function nodesOf(kind, n = 10) {
    if (!vis) return [];
    return vis.list
      .filter((v) => v.kind === kind)
      .sort((a, z) => z.size - a.size)
      .slice(0, n)
      .map((v) => ({ id: v.id, row: v.row, size: v.size, onPath: onPath(v) }));
  }

  /** Test hook: the bookmark labels drawn zoomed out, centers in client px. */
  function labels() {
    const r = canvas.getBoundingClientRect();
    return labelHits.map((l) => ({ id: l.v.id, x: r.left + l.x + l.w / 2, y: r.top + l.y + l.h / 2, w: l.w }));
  }

  function debug() {
    return {
      isOpen,
      maximized,
      view: { ...view },
      nodes: vis ? vis.list.length : 0,
      columns: vis ? vis.maxX - vis.minX + 1 : 0,
      rows: vis ? vis.maxRow - vis.rowBase + 1 : 0,
      total: data ? data.total : 0,
      path: pathIds.length,
      inViewId,
      hover: hover ? { kind: hover.v.kind, id: hover.v.id, zone: hover.zone } : null,
      collapsed: [...collapsed],
      openStacks: openStacks.size,
      stacks: vis ? vis.list.filter((v) => v.kind === 'stack').length : 0,
      miniShown: mini ? !mini.hidden : false,
      bookmarks: bookmarks.size,
      labels: labelHits.length,
      bmInside: vis ? vis.bmInside.size : 0,
      lastDrawMs: Math.round(lastDrawMs * 10) / 10,
      status: statusEl ? statusEl.textContent : '',
      msg: msgEl && !msgEl.hidden ? msgEl.textContent : '',
    };
  }

  LCBM.treeView = { init, open, close, toggle, onRoute, screenOf, centerOn, nodesOf, labels, debug };
})();

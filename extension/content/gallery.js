/**
 * GALLERY — a round 🖼 button (and Alt+G) that opens every picture an image
 * tool made in LibreChat (NovelAI MCP and friends), newest first.
 *
 * The list is GET /api/files, filtered to context "image_generation". Each
 * file knows its chat (conversationId + messageId) only on a LibreChat with
 * the local patch `image-gallery-link.patch` (older pictures were filled in
 * once by a backfill script); without it "Go to reply" stays greyed out.
 *
 * Click a picture to see it big; "Go to reply" opens its chat at the reply
 * that made it (same machinery as bookmarks, any branch). ← / → step through,
 * Esc goes back to the grid, then closes.
 */
(() => {
  'use strict';

  const LCBM = (window.LCBM = window.LCBM || {});
  const { api, adapter } = LCBM;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, sans-serif; }
    .fab {
      position: fixed; right: 21px; bottom: 364px; z-index: 2147483000;
      width: 34px; height: 34px; border-radius: 50%; border: none; cursor: pointer;
      background: #3a3a48; color: #e8e8ee; font-size: 16px; line-height: 1;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 10px rgba(0,0,0,.4); opacity: .8;
    }
    .fab:hover, .fab.on { opacity: 1; }
    .fab.on { background: #4b3a7a; }
    .shade {
      position: fixed; inset: 0; z-index: 2147483001; background: rgba(0,0,0,.55);
      display: flex; align-items: center; justify-content: center;
    }
    .shade[hidden] { display: none; }
    .win {
      width: min(1180px, calc(100vw - 32px)); height: min(90vh, 1000px);
      display: flex; flex-direction: column;
      background: #26262e; color: #e8e8ee; border: 1px solid #3a3a46;
      border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,.6); overflow: hidden;
    }
    header {
      display: flex; align-items: center; gap: 8px; padding: 12px 14px 10px 16px;
      border-bottom: 1px solid #30303c; flex-wrap: wrap;
    }
    header h1 { margin: 0; flex: 1; font-size: 15px; font-weight: 600; min-width: 140px; }
    button.b, select {
      border: 1px solid #4a4a58; background: transparent; color: #dcdce6;
      font-size: 12px; cursor: pointer; padding: 4px 10px; border-radius: 7px;
    }
    select { background: #26262e; max-width: 260px; }
    button.b:hover { background: #32323e; color: #fff; }
    button.b.main { background: #4b3a7a; border-color: #6a55a8; color: #fff; }
    button.b.main:hover { background: #5a4790; }
    button.b:disabled { opacity: .4; cursor: default; }
    .x { border: none; background: transparent; font-size: 18px; padding: 2px 6px; color: #a3a3b4; cursor: pointer; }
    .x:hover { color: #fff; }
    .body { flex: 1; min-height: 0; overflow: auto; padding: 12px 16px 16px; }
    .msg { padding: 30px 10px; text-align: center; color: #a9a9b8; font-size: 13px; line-height: 1.5; }
    .msg.err { color: #f0a0a0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
    .tile {
      display: flex; flex-direction: column; gap: 4px; padding: 0; border: 1px solid #34343f;
      background: #1e1e25; border-radius: 9px; overflow: hidden; cursor: pointer; text-align: left; color: inherit;
    }
    .tile:hover, .tile:focus-visible { border-color: #8a72d0; outline: none; }
    .tile .ph { aspect-ratio: 2 / 3; background: #17171d; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .tile .cap { padding: 2px 8px 7px; font-size: 11.5px; line-height: 1.35; color: #c8c8d4; }
    .tile .cap b { display: block; font-weight: 500; color: #e8e8ee; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tile .cap span { color: #8f8fa0; }
    .view { display: flex; flex-direction: column; height: 100%; gap: 10px; }
    .view .pic { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
    .view .pic img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 6px; cursor: zoom-in; }
    .view .bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .view .info { flex: 1; min-width: 180px; font-size: 12.5px; color: #c8c8d4; line-height: 1.4; }
    .view .info b { color: #e8e8ee; font-weight: 600; }
    .view .info span { color: #8f8fa0; }
  `;

  let shadow = null;
  let fab = null;
  let shade = null;
  let bodyEl = null;
  let titleEl = null;
  let filterEl = null;
  /** [{ file_id, url, at, conv, msg, w, h }] newest first */
  let items = [];
  /** conversationId -> title */
  const titles = new Map();
  let loaded = false;
  let loading = null;
  /** index into shown() while a picture is open, else -1 */
  let current = -1;
  let gridScroll = 0;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function fmtWhen(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString(undefined, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  // ------------------------------------------------------------------ data

  async function load() {
    const files = await api.authedFetch('/api/files');
    items = (Array.isArray(files) ? files : [])
      .filter((f) => f && f.context === 'image_generation' && f.filepath)
      .map((f) => ({
        file_id: f.file_id,
        url: f.filepath,
        at: f.createdAt || '',
        conv: f.conversationId || '',
        msg: f.messageId || '',
        w: f.width,
        h: f.height,
      }))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const convs = [...new Set(items.map((i) => i.conv).filter((c) => c && !titles.has(c)))];
    /** a few at a time; a deleted chat answers 404 */
    for (let i = 0; i < convs.length; i += 6) {
      await Promise.all(
        convs.slice(i, i + 6).map(async (c) => {
          try {
            const convo = await api.authedFetch(`/api/convos/${encodeURIComponent(c)}`);
            titles.set(c, (convo && convo.title) || 'Untitled chat');
          } catch {
            titles.set(c, '');
          }
        }),
      );
    }
    loaded = true;
  }

  function ensureLoaded(force) {
    if (force) loaded = false;
    if (loaded) return Promise.resolve();
    if (!loading) {
      loading = load().finally(() => {
        loading = null;
      });
    }
    return loading;
  }

  function titleOf(it) {
    if (!it.conv) return 'Chat unknown';
    const t = titles.get(it.conv);
    return t === '' ? 'Chat deleted' : t || '…';
  }

  /** Items after the chat filter. */
  function shown() {
    const f = filterEl ? filterEl.value : '';
    if (!f) return items;
    if (f === '__here') {
      const here = adapter.getConversationId();
      return items.filter((i) => i.conv && i.conv === here);
    }
    return items.filter((i) => i.conv === f);
  }

  // -------------------------------------------------------------------- UI

  function init() {
    if (shadow) return;
    const host = document.createElement('div');
    host.id = 'lcqol-gallery-host';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${CSS}</style>
      <button class="fab" title="Generated images (Alt+G)" aria-label="Generated images">🖼</button>
      <div class="shade" hidden>
        <div class="win" role="dialog" aria-label="Generated images">
          <header>
            <h1>Generated images</h1>
            <select class="filter" title="Which chat"></select>
            <button class="b refresh" title="Load the list again">Refresh</button>
            <button class="x close" title="Close (Esc)">✕</button>
          </header>
          <div class="body"></div>
        </div>
      </div>`;
    fab = shadow.querySelector('.fab');
    shade = shadow.querySelector('.shade');
    bodyEl = shadow.querySelector('.body');
    titleEl = shadow.querySelector('h1');
    filterEl = shadow.querySelector('.filter');
    fab.addEventListener('click', toggle);
    shadow.querySelector('.close').addEventListener('click', close);
    shadow.querySelector('.refresh').addEventListener('click', () => refresh(true));
    filterEl.addEventListener('change', () => {
      current = -1;
      gridScroll = 0;
      renderGrid();
    });
    shade.addEventListener('mousedown', (e) => {
      if (e.target === shade) close();
    });
    window.addEventListener('keydown', onKey, true);
  }

  function isOpen() {
    return !!shade && !shade.hidden;
  }

  function toggle() {
    if (isOpen()) close();
    else open();
  }

  function open() {
    init();
    shade.hidden = false;
    fab.classList.add('on');
    current = -1;
    /** each open re-reads the list, so new pictures show up */
    refresh(true);
  }

  function close() {
    if (!shade) return;
    shade.hidden = true;
    fab.classList.remove('on');
    current = -1;
  }

  async function refresh(force) {
    if (!loaded || force) {
      if (!items.length) bodyEl.replaceChildren(el('div', 'msg', 'Loading…'));
    }
    try {
      await ensureLoaded(force);
    } catch (err) {
      bodyEl.replaceChildren(el('div', 'msg err', `Could not load the pictures: ${err.message || err}`));
      return;
    }
    fillFilter();
    if (current >= 0) renderView();
    else renderGrid();
  }

  function fillFilter() {
    const keep = filterEl.value;
    const counts = new Map();
    for (const i of items) if (i.conv) counts.set(i.conv, (counts.get(i.conv) || 0) + 1);
    const here = adapter.getConversationId();
    const opts = [['', `All chats (${items.length})`]];
    if (here && counts.has(here)) opts.push(['__here', `This chat (${counts.get(here)})`]);
    /** chats by their newest picture */
    const order = [];
    for (const i of items) if (i.conv && !order.includes(i.conv)) order.push(i.conv);
    for (const c of order) opts.push([c, `${titleOf({ conv: c })} (${counts.get(c)})`]);
    filterEl.replaceChildren(
      ...opts.map(([v, t]) => {
        const o = el('option', '', t);
        o.value = v;
        return o;
      }),
    );
    filterEl.value = opts.some(([v]) => v === keep) ? keep : '';
  }

  function renderGrid() {
    const list = shown();
    titleEl.textContent = `Generated images (${list.length})`;
    if (!list.length) {
      bodyEl.replaceChildren(
        el('div', 'msg', items.length ? 'No pictures in this chat.' : 'No generated pictures yet.'),
      );
      return;
    }
    const grid = el('div', 'grid');
    list.forEach((it, idx) => {
      const tile = el('button', 'tile');
      tile.type = 'button';
      const ph = el('div', 'ph');
      const img = el('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = '';
      img.src = it.url;
      ph.appendChild(img);
      const cap = el('div', 'cap');
      cap.appendChild(el('b', '', titleOf(it)));
      cap.appendChild(el('span', '', fmtWhen(it.at)));
      tile.append(ph, cap);
      tile.title = `${titleOf(it)} — ${fmtWhen(it.at)}`;
      tile.addEventListener('click', () => {
        gridScroll = bodyEl.scrollTop;
        current = idx;
        renderView();
      });
      grid.appendChild(tile);
    });
    bodyEl.replaceChildren(grid);
    bodyEl.scrollTop = gridScroll;
  }

  function renderView() {
    const list = shown();
    if (current < 0 || current >= list.length) {
      current = -1;
      renderGrid();
      return;
    }
    const it = list[current];
    titleEl.textContent = `Picture ${current + 1} of ${list.length}`;
    const view = el('div', 'view');
    const pic = el('div', 'pic');
    const img = el('img');
    img.src = it.url;
    img.alt = '';
    img.title = 'Open full size in a new tab';
    img.addEventListener('click', () => window.open(it.url, '_blank', 'noopener'));
    pic.appendChild(img);

    const bar = el('div', 'bar');
    const back = el('button', 'b', '← Grid');
    back.addEventListener('click', backToGrid);
    const prev = el('button', 'b', '‹ Newer');
    prev.disabled = current === 0;
    prev.addEventListener('click', () => step(-1));
    const next = el('button', 'b', 'Older ›');
    next.disabled = current === list.length - 1;
    next.addEventListener('click', () => step(1));
    const info = el('div', 'info');
    info.appendChild(el('b', '', titleOf(it)));
    info.appendChild(document.createTextNode(' '));
    info.appendChild(el('span', '', `${fmtWhen(it.at)}${it.w ? ` · ${it.w}×${it.h}` : ''}`));
    const full = el('button', 'b', 'Full size');
    full.addEventListener('click', () => window.open(it.url, '_blank', 'noopener'));
    const go = el('button', 'b main', 'Go to reply');
    go.disabled = !(it.conv && it.msg && titles.get(it.conv) !== '');
    go.addEventListener('click', () => goTo(it));
    bar.append(back, prev, next, info, full, go);

    view.append(pic, bar);
    bodyEl.replaceChildren(view);
    bodyEl.scrollTop = 0;
  }

  function backToGrid() {
    current = -1;
    renderGrid();
  }

  function step(d) {
    const n = current + d;
    if (n < 0 || n >= shown().length) return;
    current = n;
    renderView();
  }

  function goTo(it) {
    if (!it.conv || !it.msg) return;
    close();
    if (adapter.getConversationId() === it.conv) {
      LCBM.ui.jumpFromLink(it.conv, it.msg);
      return;
    }
    /** deeplink.js picks this up after the page loads */
    location.assign(`/c/${encodeURIComponent(it.conv)}#lcjump=${encodeURIComponent(it.msg)}`);
  }

  function onKey(e) {
    if (e.isComposing) return;
    const plain = !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    if (e.code === 'KeyG' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (!e.repeat) toggle();
    } else if (!isOpen()) {
      return;
    } else if (e.key === 'Escape' && plain) {
      if (current >= 0) backToGrid();
      else close();
    } else if (current >= 0 && plain && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      step(e.key === 'ArrowLeft' ? -1 : 1);
    } else if (current >= 0 && plain && e.key === 'Enter' && shadow.activeElement == null) {
      const it = shown()[current];
      if (it) goTo(it);
    } else {
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  LCBM.gallery = { init, open, close, toggle, isOpen };
})();

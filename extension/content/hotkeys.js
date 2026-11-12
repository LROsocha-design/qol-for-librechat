/**
 * HOTKEYS — a small ⌨ button (and Alt+K) that lists every custom hotkey:
 * this extension's, plus (with `config.patchHotkeys`) the ones the author's
 * LibreChat patches add; those rows and groups are marked `patch`.
 *
 * The list is written by hand below. When a hotkey is added or changed in
 * this extension, librechat-skill-styles or a LibreChat patch, add it here.
 * Keys that live in LibreChat's own shortcut table (Ctrl+S in the Agent
 * Builder, Ctrl+Shift+F) are read from its `customKeyboardShortcuts`
 * localStorage entry, so a rebinding in LibreChat's shortcut dialog shows
 * up here too.
 *
 * The window is not modal: the page keeps working while it is open. Esc or
 * a click anywhere else closes it.
 */
(() => {
  'use strict';

  const LCBM = (window.LCBM = window.LCBM || {});

  /** A row is [keys, what it does, 'patch'?]. Keys is a list of alternatives; an
   *  object { lc, def } is a LibreChat shortcut id with its default chord. */
  const ALL_GROUPS = [
    {
      title: 'Anywhere in LibreChat',
      rows: [
        [['Alt+K'], 'This list'],
        [['Alt+B'], 'Bookmarks and navigation'],
        [['Alt+T'], 'Branch tree of this chat (again to close)'],
        [['Alt+M'], 'Mark the message you are looking at, so ← / → flip its branches'],
        [['Alt+Click'], 'Edit a message at the clicked word (select text first to edit at the selection)'],
        [[{ lc: 'searchConversation', def: 'Control+Shift+F' }], 'Find in this chat', 'patch'],
      ],
    },
    {
      title: 'While a message is marked',
      note: 'Mark one with Alt+M or the ⇆ under a message.',
      rows: [
        [['←', '→'], 'Previous / next branch of the marked message'],
        [['Shift+↑', 'Shift+↓'], 'Move the mark to the message above / below'],
        [['Esc'], 'Unmark'],
      ],
    },
    {
      title: 'Branch tree',
      note: 'The keys work after you click the tree once.',
      rows: [
        [['Alt+Click'], 'Fold or unfold everything below a message'],
        [['Shift+Wheel'], 'Scroll sideways'],
        [['+', '−'], 'Zoom in / out'],
        [['0', 'F'], 'Show the whole tree'],
        [['C'], 'Center on the message you are reading'],
        [['←', '→', '↑', '↓'], 'Move around'],
        [['Esc'], 'Leave full window, then close'],
      ],
    },
    {
      title: 'Find in chat',
      patch: true,
      rows: [
        [['↑', '↓'], 'Move through the results'],
        [['Enter'], 'Preview the result; Enter again goes there'],
        [['Ctrl+Enter', 'Ctrl+Click'], 'Go there without the preview'],
        [['Shift+↑', 'Shift+↓'], 'Previous / next match inside the preview'],
        [['PgUp', 'PgDn'], 'Scroll the preview'],
        [['Esc'], 'Back to the list, then close'],
      ],
    },
    {
      title: 'Editing a message',
      patch: true,
      note: 'In the edit box (the pencil), on your messages and on AI replies.',
      rows: [
        [['Ctrl+S'], 'Save'],
        [['Ctrl+Enter'], 'Save & Submit'],
        [['Esc'], 'Cancel'],
      ],
    },
    {
      title: 'Saving',
      patch: true,
      rows: [
        [[{ lc: 'saveAgent', def: 'Control+S' }], 'Save the agent (Agent Builder)'],
        [['Ctrl+S'], 'Save the skill (skill editor window)'],
      ],
    },
  ];

  const WITH_PATCHES = !!(LCBM.config && LCBM.config.patchHotkeys);
  const GROUPS = ALL_GROUPS.filter((g) => WITH_PATCHES || !g.patch).map((g) => ({
    ...g,
    rows: g.rows.filter((row) => WITH_PATCHES || row[2] !== 'patch'),
  }));

  /** LibreChat's own "Keyboard shortcuts" dialog. */
  const STOCK_LIST = { lc: 'showShortcuts', def: 'Control+Shift+/' };

  /** The physical key LibreChat reads for punctuation (utils/shortcuts.ts). */
  const CODE_BY_PUNCT = {
    '`': 'Backquote', '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight',
    '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash',
  };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, sans-serif; }
    .fab {
      position: fixed; right: 21px; bottom: 220px; z-index: 2147483000;
      width: 34px; height: 34px; border-radius: 50%; border: none; cursor: pointer;
      background: #3a3a48; color: #e8e8ee; font-size: 17px;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 10px rgba(0,0,0,.4); opacity: .8;
    }
    .fab:hover, .fab.on { opacity: 1; }
    .fab.on { background: #4b3a7a; }
    .win {
      position: fixed; right: 66px; bottom: 76px; z-index: 2147483002;
      width: min(430px, calc(100vw - 32px)); max-height: min(78vh, 680px);
      display: flex; flex-direction: column;
      background: #26262e; color: #e8e8ee; border: 1px solid #3a3a46;
      border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,.6); overflow: hidden;
    }
    .win[hidden] { display: none; }
    header {
      display: flex; align-items: center; padding: 12px 14px 8px 16px;
      border-bottom: 1px solid #30303c;
    }
    header h1 { margin: 0; flex: 1; font-size: 15px; font-weight: 600; }
    header .x {
      border: none; background: transparent; color: #a3a3b4; font-size: 16px;
      cursor: pointer; padding: 2px 6px; border-radius: 6px;
    }
    header .x:hover { background: #32323e; color: #fff; }
    .body { overflow: auto; padding: 4px 16px 10px; }
    h2 {
      margin: 12px 0 2px; font-size: 11.5px; font-weight: 600; letter-spacing: .04em;
      text-transform: uppercase; color: #c9a227;
    }
    .note { margin: 0 0 4px; font-size: 11.5px; color: #8f8fa0; }
    .row {
      display: grid; grid-template-columns: 148px 1fr; gap: 10px; align-items: baseline;
      padding: 4px 0; font-size: 12.5px; line-height: 1.4; border-bottom: 1px solid #2e2e38;
    }
    .row:last-child { border-bottom: none; }
    .keys { display: flex; flex-wrap: wrap; gap: 3px 4px; align-items: baseline; }
    .keys .or { color: #6f6f80; font-size: 11px; }
    kbd {
      display: inline-block; padding: 1px 6px; border-radius: 5px; white-space: nowrap;
      background: #1b1b22; border: 1px solid #4a4a58; border-bottom-width: 2px;
      font: 600 11.5px ui-monospace, Consolas, monospace; color: #e8e8ee;
    }
    kbd.off { color: #8f8fa0; font-weight: 400; font-family: system-ui, sans-serif; }
    .what { color: #cfcfda; }
    footer {
      display: flex; align-items: center; gap: 8px; padding: 10px 16px 12px;
      border-top: 1px solid #30303c;
    }
    footer button {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 6px 10px; font-size: 12.5px; border-radius: 8px; cursor: pointer;
      border: 1px solid #4a4a58; background: transparent; color: #dcdce6;
    }
    footer button:hover { background: #32323e; }
    footer button:disabled { opacity: .5; cursor: default; }
  `;

  let host = null;
  let shadow = null;
  let fab = null;
  let win = null;

  function init() {
    if (host) return;
    document.getElementById('lcbm-keys-host')?.remove();
    host = document.createElement('div');
    host.id = 'lcbm-keys-host';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${CSS}</style>
      <button class="fab" title="Your hotkeys (Alt+K)" aria-label="Your hotkeys">&#9000;</button>
      <div class="win" role="dialog" aria-label="Your hotkeys" hidden>
        <header><h1>Your hotkeys</h1><button class="x" title="Close (Esc)">&#10005;</button></header>
        <div class="body"></div>
        <footer><button class="stock"></button></footer>
      </div>`;
    fab = shadow.querySelector('.fab');
    win = shadow.querySelector('.win');
    fab.addEventListener('click', toggle);
    shadow.querySelector('.x').addEventListener('click', close);
    shadow.querySelector('.stock').addEventListener('click', openStockList);
    /** Window capture runs before the mark keys' and LibreChat's listeners,
     *  so the Esc that closes this list does nothing else. */
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', (e) => {
      if (isOpen() && !e.composedPath().includes(host)) close();
    }, true);
  }

  function isOpen() {
    return !!win && !win.hidden;
  }

  function toggle() {
    if (isOpen()) close();
    else open();
  }

  function open() {
    init();
    render();
    win.hidden = false;
    fab.classList.add('on');
  }

  function close() {
    if (!win) return;
    win.hidden = true;
    fab.classList.remove('on');
  }

  function onKey(e) {
    if (e.isComposing) return;
    const altK = e.code === 'KeyK' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    const esc = e.key === 'Escape' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    if (altK) {
      if (e.repeat) return;
      toggle();
    } else if (esc && isOpen()) {
      close();
    } else {
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  // ------------------------------------------------------- LibreChat bindings

  function customShortcuts() {
    try {
      return JSON.parse(localStorage.getItem('customKeyboardShortcuts') || '{}') || {};
    } catch {
      return {};
    }
  }

  /** The chord LibreChat has for a shortcut id, as stored ("Control+Shift+F"),
   *  or null when it was switched off in LibreChat's shortcut dialog. */
  function lcChord(item, custom) {
    const o = custom[item.lc];
    if (o && 'other' in o) return o.other || null;
    return item.def;
  }

  function prettyChord(stored) {
    return stored.replace(/\bControl\b/g, 'Ctrl').replace(/\bMeta\b/g, 'Win');
  }

  function parseChord(stored) {
    const parts = stored.split('+');
    /** "Control++" means the + key itself. */
    if (parts[parts.length - 1] === '' && parts.length > 1) {
      parts.splice(-2, 2, '+');
    }
    const key = parts.pop();
    return {
      key,
      ctrl: parts.includes('Control') || parts.includes('Ctrl'),
      shift: parts.includes('Shift'),
      alt: parts.includes('Alt'),
      meta: parts.includes('Meta'),
    };
  }

  /** Opens LibreChat's own list by pressing its chord; its listener sits on
   *  window, so a keydown from <body> reaches it. */
  function openStockList() {
    const stored = lcChord(STOCK_LIST, customShortcuts());
    if (!stored) return;
    const c = parseChord(stored);
    let code = CODE_BY_PUNCT[c.key] || '';
    if (/^[a-z]$/i.test(c.key)) code = `Key${c.key.toUpperCase()}`;
    else if (/^[0-9]$/.test(c.key)) code = `Digit${c.key}`;
    close();
    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: c.key.length === 1 ? c.key.toLowerCase() : c.key,
      code,
      ctrlKey: c.ctrl,
      shiftKey: c.shift,
      altKey: c.alt,
      metaKey: c.meta,
      bubbles: true,
      cancelable: true,
    }));
  }

  // ------------------------------------------------------------------ render

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function render() {
    const custom = customShortcuts();
    const body = shadow.querySelector('.body');
    body.textContent = '';
    for (const g of GROUPS) {
      body.appendChild(el('h2', null, g.title));
      if (g.note) body.appendChild(el('p', 'note', g.note));
      for (const [keys, what] of g.rows) {
        const row = el('div', 'row');
        const kc = el('div', 'keys');
        keys.forEach((k, i) => {
          if (i) kc.appendChild(el('span', 'or', '/'));
          if (typeof k === 'string') {
            kc.appendChild(el('kbd', null, k));
            return;
          }
          const chord = lcChord(k, custom);
          if (chord) kc.appendChild(el('kbd', null, prettyChord(chord)));
          else kc.appendChild(el('kbd', 'off', 'off'));
        });
        row.appendChild(kc);
        row.appendChild(el('div', 'what', what));
        body.appendChild(row);
      }
    }

    const stock = shadow.querySelector('.stock');
    stock.textContent = "LibreChat's own shortcuts";
    const chord = lcChord(STOCK_LIST, custom);
    stock.disabled = !chord;
    if (chord) stock.appendChild(el('kbd', null, prettyChord(chord)));
    else stock.title = "Its key is switched off in LibreChat's shortcut settings";
  }

  LCBM.hotkeys = { init, open, close, toggle, isOpen };
})();

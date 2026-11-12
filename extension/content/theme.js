/**
 * THEME — your own colors and fonts for LibreChat's dark mode, with an editor.
 *
 * A round palette button opens the editor: a master switch, presets
 * ("LibreChat default", "Claude dark", and the ones you save), fonts and text
 * size, and one row per color. Every change shows at once and is saved.
 *
 * How it works: LibreChat paints almost everything from CSS variables
 * (`--surface-primary`, `--text-primary`, …) that it defines under `.dark`.
 * The theme is one <style> element that sets those variables again under
 * `html.dark`, which wins. Three things need more than a variable:
 *   - Tailwind's own grays (`dark:bg-gray-800`, …) are hard-coded hex in
 *     LibreChat's build, so those classes get rules that point them at the
 *     gray scale (`--gray-800`, …) whenever a gray is changed.
 *   - The shadcn-style variables (`--background`, `--border`, …) hold bare
 *     "H S% L%" triplets; they are derived from the matching colors.
 *   - Fonts, text size and chat width are plain rules on LibreChat's classes
 *     (`.agent-turn .markdown`, `.user-turn .text-message`, `.message-render`).
 * Colors apply in dark mode only; fonts, size and width always.
 *
 * "Claude dark" holds the colors read from claude.ai's dark theme on
 * 2026-11-12 (neutral grays) and claude.ai's text settings (15px replies, a
 * 736px column). claude.ai's fonts, Anthropic Sans and Anthropic Serif, are
 * its own files and are NOT part of this extension: the preset names them
 * first, so they are used if they are ever installed on this PC, and falls
 * back to the fonts claude.ai itself falls back to (Segoe UI, Georgia).
 *
 * Storage: chrome.storage.local `lcbm.theme` (the state) and localStorage
 * `lcbm.theme.css` (the compiled CSS, for theme-early.js). Without
 * chrome.storage (script pasted into a page for a test) localStorage holds
 * the state too.
 */
(() => {
  'use strict';

  const LCBM = (window.LCBM = window.LCBM || {});

  const STORE_KEY = 'lcbm.theme';
  const CSS_KEY = 'lcbm.theme.css';
  const STYLE_ID = 'lcbm-theme-style';

  /** [variable, label]. Names are LibreChat's (client/src/style.css). */
  const COLOR_GROUPS = [
    {
      title: 'Backgrounds',
      items: [
        ['--presentation', 'Chat area'],
        ['--surface-primary-alt', 'Sidebar'],
        ['--surface-chat', 'Message box'],
        ['--surface-primary', 'Base surface (menus, inputs)'],
        ['--surface-secondary', 'Panels and cards'],
        ['--surface-tertiary', 'Raised items (chips, tiles)'],
        ['--surface-dialog', 'Dialogs'],
        ['--surface-hover', 'Hovered item'],
        ['--surface-active-alt', 'Selected item'],
        ['--surface-active', 'Pressed item'],
        ['--lcbm-user-bubble', 'Bubble behind your messages (empty = none)'],
        ['--lcbm-code-bg', 'Code blocks (empty = LibreChat\'s)'],
      ],
    },
    {
      title: 'Text',
      items: [
        ['--text-primary', 'Main text'],
        ['--text-secondary', 'Secondary text'],
        ['--text-secondary-alt', 'Muted text and icons'],
        ['--text-tertiary', 'Faint text'],
        ['--lcbm-link', 'Links in messages (empty = LibreChat\'s)'],
      ],
    },
    {
      title: 'Lines',
      items: [
        ['--border-light', 'Faint lines'],
        ['--border-medium', 'Normal lines'],
        ['--border-heavy', 'Strong lines'],
        ['--border-xheavy', 'Focus rings'],
      ],
    },
    {
      title: 'Accent',
      items: [
        ['--surface-submit', 'Main buttons (Save, Select)'],
        ['--surface-submit-hover', 'Main buttons, hovered'],
        ['--surface-destructive', 'Delete buttons'],
      ],
    },
    {
      title: 'Gray scale',
      note:
        'LibreChat builds the colors above from these unless you set them, and many small parts use a gray directly.',
      items: [
        ['--gray-900', 'Gray 900 (darkest)'],
        ['--gray-850', 'Gray 850'],
        ['--gray-800', 'Gray 800'],
        ['--gray-700', 'Gray 700'],
        ['--gray-600', 'Gray 600'],
        ['--gray-500', 'Gray 500'],
        ['--gray-400', 'Gray 400'],
        ['--gray-300', 'Gray 300'],
        ['--gray-200', 'Gray 200'],
        ['--gray-100', 'Gray 100 (lightest)'],
      ],
    },
  ];
  const GRAYS = ['900', '850', '800', '700', '600', '500', '400', '300', '200', '100'];

  /** [key, label, kind, placeholder] */
  const TEXT_FIELDS = [
    ['ui', 'Interface font', 'font', 'Inter'],
    ['reply', 'Reply font', 'font', 'same as the interface'],
    ['user', 'Your messages\' font', 'font', 'same as the interface'],
    ['code', 'Code font', 'font', 'Roboto Mono'],
    ['size', 'Reply text size (px)', 'number', '16'],
    ['line', 'Reply line height', 'number', '1.4'],
    ['width', 'Chat column width (px)', 'number', '752 / 880'],
  ];
  const FONT_SUGGESTIONS = [
    'Georgia', 'Cambria', 'Constantia', 'Sitka Text', 'Palatino Linotype', 'Times New Roman',
    'Segoe UI', 'Inter', 'system-ui', 'Arial', 'Verdana', 'Calibri',
    'Cascadia Code', 'Cascadia Mono', 'Consolas', 'Roboto Mono',
  ];

  const PRESETS = {
    'LibreChat default': { colors: {}, text: {} },
    'Claude dark': {
      colors: {
        '--presentation': '#191919',
        '--surface-primary': '#191919',
        '--surface-primary-alt': '#1f1f1f',
        '--surface-primary-contrast': '#1f1f1f',
        '--surface-secondary': '#242424',
        '--surface-secondary-alt': '#242424',
        '--surface-tertiary': '#2c2c2c',
        '--surface-tertiary-alt': '#2c2c2c',
        '--surface-dialog': '#1f1f1f',
        '--surface-chat': '#303030',
        '--surface-hover': '#333333',
        '--surface-hover-alt': '#333333',
        '--surface-active': '#474747',
        '--surface-active-alt': '#2c2c2c',
        '--header-primary': '#2c2c2c',
        '--header-hover': '#333333',
        '--header-button-hover': '#2c2c2c',
        '--text-primary': '#ededed',
        '--text-secondary': '#c2c2c2',
        '--text-secondary-alt': '#959595',
        '--text-tertiary': '#7d7d7d',
        '--border-light': '#2a2a2a',
        '--border-medium': '#353535',
        '--border-medium-alt': '#353535',
        '--border-heavy': '#4a4a4a',
        '--border-xheavy': '#666666',
        '--surface-submit': '#c6613f',
        '--surface-submit-hover': '#b05534',
        '--gray-900': '#191919',
        '--gray-850': '#1f1f1f',
        '--gray-800': '#242424',
        '--gray-700': '#2c2c2c',
        '--gray-600': '#383838',
        '--gray-500': '#5c5c5c',
        '--gray-400': '#959595',
        '--gray-300': '#c2c2c2',
        '--gray-200': '#dedede',
        '--gray-100': '#ededed',
        '--lcbm-user-bubble': '#262626',
        '--lcbm-link': '#d97757',
      },
      text: {
        ui: '"Anthropic Sans", "anthropic-sans", system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        reply: '"Anthropic Serif", "anthropic-serif", "Tiempos Text", Georgia, "Times New Roman", serif',
        user: '',
        code: '',
        size: '15',
        line: '1.4',
        width: '736',
      },
    },
  };

  /** enabled; base = the preset last loaded; colors/text = the theme being edited; saved = your presets */
  let state = { enabled: false, base: 'LibreChat default', colors: {}, text: {}, saved: {} };

  // ---------------------------------------------------------------- colors

  let probe = null;
  /** Any CSS color -> '#rrggbb' (alpha dropped), or null when it is not a color. */
  function toHex(value) {
    if (!value) return null;
    probe = probe || document.createElement('canvas').getContext('2d');
    /** An invalid value leaves fillStyle as it was: try from two starting colors. */
    probe.fillStyle = '#010203';
    probe.fillStyle = value;
    const out = probe.fillStyle;
    probe.fillStyle = '#030201';
    probe.fillStyle = value;
    if (probe.fillStyle !== out) return null;
    if (out.startsWith('#')) return out;
    const m = /rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/.exec(out);
    return m ? `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}` : null;
  }

  /** '#rrggbb' -> 'H S% L%', the bare triplet the shadcn-style variables hold. */
  function hslTriplet(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) / 255;
    const g = ((n >> 8) & 255) / 255;
    const b = (n & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    const round = (x) => Math.round(x * 10) / 10;
    return `${round(h * 360)} ${round(s * 100)}% ${round(l * 100)}%`;
  }

  // ------------------------------------------------------------------ fonts

  /** Is a font family installed (or loaded by the page)? Compares the width
   *  of a test string against three generic fallbacks. */
  function fontAvailable(name) {
    const family = name.replace(/^["']|["']$/g, '');
    if (/^(serif|sans-serif|monospace|system-ui|ui-serif|ui-sans-serif|ui-monospace|cursive|fantasy)$/i.test(family)) {
      return true;
    }
    const ctx = document.createElement('canvas').getContext('2d');
    const text = 'mmmmmmmmmmlliWQ@0123456789 Hamburgefonstiv';
    return ['monospace', 'serif', 'sans-serif'].some((base) => {
      ctx.font = `72px ${base}`;
      const plain = ctx.measureText(text).width;
      ctx.font = `72px "${family}", ${base}`;
      return ctx.measureText(text).width !== plain;
    });
  }

  function families(stack) {
    return String(stack || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** "Using Georgia (Anthropic Serif is not on this PC)" for a font stack. */
  function fontNote(stack) {
    const list = families(stack);
    if (!list.length) return '';
    const clean = (s) => s.replace(/^["']|["']$/g, '');
    const used = list.find(fontAvailable);
    if (!used) return 'None of these fonts is on this PC.';
    if (used === list[0]) return `Using ${clean(used)}.`;
    return `Using ${clean(used)}. ${clean(list[0])} is not on this PC.`;
  }

  // ---------------------------------------------------------------- compile

  function cssString(value) {
    /** A font stack or number goes into a rule as is; keep it on one line and
     *  out of the way of the rule's own braces. */
    return String(value).replace(/[{};<>]/g, '').replace(/\s+/g, ' ').trim();
  }

  function compile(s) {
    if (!s.enabled) return '';
    const colors = s.colors || {};
    const text = s.text || {};
    const out = [];
    const vars = [];
    for (const [name, value] of Object.entries(colors)) {
      if (/^--[\w-]+$/.test(name) && value && toHex(value)) vars.push(`  ${name}: ${cssString(value)};`);
    }
    /** shadcn-style triplets follow the colors they stand for */
    const triplet = (name, from) => {
      const hex = toHex(colors[from]);
      if (hex) vars.push(`  ${name}: ${hslTriplet(hex)};`);
    };
    triplet('--background', '--presentation');
    triplet('--card', '--surface-secondary');
    triplet('--secondary', '--surface-tertiary');
    triplet('--muted', '--surface-tertiary');
    triplet('--accent', '--surface-tertiary');
    triplet('--border', '--border-medium');
    triplet('--input', '--border-medium');
    triplet('--foreground', '--text-primary');
    triplet('--card-foreground', '--text-primary');
    triplet('--muted-foreground', '--text-secondary-alt');
    if (vars.length) out.push(`html.dark {\n${vars.join('\n')}\n}`);

    if (toHex(colors['--presentation'])) {
      out.push('html.dark body { background-color: var(--presentation); }');
    }
    /** Tailwind's hard-coded grays follow the gray scale */
    if (GRAYS.some((g) => toHex(colors[`--gray-${g}`]))) {
      for (const g of GRAYS) {
        if (!toHex(colors[`--gray-${g}`])) continue;
        const v = `var(--gray-${g}) !important`;
        out.push(
          `html.dark .dark\\:bg-gray-${g}, html.dark .dark\\:hover\\:bg-gray-${g}:hover { background-color: ${v}; }`,
          `html.dark .dark\\:text-gray-${g}, html.dark .dark\\:hover\\:text-gray-${g}:hover { color: ${v}; }`,
          `html.dark .dark\\:border-gray-${g} { border-color: ${v}; }`,
        );
      }
    }
    if (toHex(colors['--lcbm-user-bubble'])) {
      out.push(
        'html.dark .user-turn .text-message { background-color: var(--lcbm-user-bubble); border-radius: 12px; padding: 10px 16px; width: fit-content; max-width: 100%; }',
      );
    }
    if (toHex(colors['--lcbm-link'])) {
      out.push('html.dark .message-render .markdown a { color: var(--lcbm-link) !important; }');
    }
    if (toHex(colors['--lcbm-code-bg'])) {
      out.push(
        'html.dark .message-render .markdown pre, html.dark .message-render .markdown pre > div { background-color: var(--lcbm-code-bg) !important; }',
      );
    }

    const ui = cssString(text.ui || '');
    const reply = cssString(text.reply || '');
    const user = cssString(text.user || '');
    const code = cssString(text.code || '');
    const size = parseFloat(text.size);
    const line = parseFloat(text.line);
    const width = parseFloat(text.width);
    if (ui) out.push(`html, .font-sans { font-family: ${ui} !important; }`);
    if (reply) {
      out.push(`.agent-turn .markdown, .agent-turn .message-content { font-family: ${reply} !important; }`);
    }
    if (user) out.push(`.user-turn .text-message { font-family: ${user} !important; }`);
    if (code) {
      out.push(
        `code, pre, kbd, samp, .font-mono, .message-render .markdown :is(code, pre) { font-family: ${code} !important; }`,
      );
    }
    if (size >= 8 && size <= 40) {
      out.push(
        `.agent-turn .markdown, .agent-turn .markdown :is(p, li), .user-turn .text-message { font-size: ${size}px !important; }`,
      );
    }
    if (line >= 1 && line <= 3) {
      out.push(
        `.agent-turn .markdown, .agent-turn .markdown :is(p, li), .user-turn .text-message { line-height: ${line} !important; }`,
      );
    }
    if (width >= 320 && width <= 4000) {
      out.push(
        /** the messages, and the message box's form (a little wider, as LibreChat has it) */
        `@media (min-width: 768px) { .message-render, [class*="md:max-w-[47rem]"] { max-width: ${width}px !important; } form[class*="md:max-w-3xl"] { max-width: ${width + 16}px !important; } }`,
      );
    }
    return out.join('\n');
  }

  // ----------------------------------------------------------------- store

  function hasChromeStore() {
    return typeof chrome !== 'undefined' && !!(chrome.storage && chrome.storage.local);
  }

  function normalize(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    return {
      enabled: s.enabled === true,
      base: typeof s.base === 'string' ? s.base : 'LibreChat default',
      colors: s.colors && typeof s.colors === 'object' ? { ...s.colors } : {},
      text: s.text && typeof s.text === 'object' ? { ...s.text } : {},
      saved: s.saved && typeof s.saved === 'object' ? { ...s.saved } : {},
    };
  }

  async function loadState() {
    let raw = null;
    if (hasChromeStore()) {
      try {
        raw = (await chrome.storage.local.get(STORE_KEY))[STORE_KEY] || null;
      } catch {
        raw = null;
      }
    }
    if (!raw) {
      try {
        raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      } catch {
        raw = null;
      }
    }
    return normalize(raw);
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
      } catch {
        /* storage full or blocked: the chrome.storage copy below still holds it */
      }
      if (hasChromeStore()) chrome.storage.local.set({ [STORE_KEY]: state }).catch(() => {});
    }, 250);
  }

  // ----------------------------------------------------------------- apply

  let styleEl = null;
  function apply() {
    const css = compile(state);
    styleEl = styleEl || document.getElementById(STYLE_ID);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
    }
    styleEl.textContent = css;
    /** last in the document, so it also wins against equal selectors */
    if (styleEl.parentNode !== document.documentElement || styleEl.nextSibling) {
      document.documentElement.appendChild(styleEl);
    }
    try {
      if (css) localStorage.setItem(CSS_KEY, css);
      else localStorage.removeItem(CSS_KEY);
    } catch {
      /* theme-early.js then has nothing to show before this script loads */
    }
  }

  /** LibreChat's own value of each color, read with the theme switched off. */
  function stockColors() {
    const stock = {};
    const was = styleEl ? styleEl.textContent : '';
    if (styleEl) styleEl.textContent = '';
    const cs = getComputedStyle(document.documentElement);
    for (const group of COLOR_GROUPS) {
      for (const [name] of group.items) stock[name] = cs.getPropertyValue(name).trim();
    }
    if (styleEl) styleEl.textContent = was;
    return stock;
  }

  // -------------------------------------------------------------------- UI

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, sans-serif; }
    .fab {
      position: fixed; right: 21px; bottom: 316px; z-index: 2147483000;
      width: 34px; height: 34px; border-radius: 50%; border: none; cursor: pointer;
      background: #3a3a48; color: #e8e8ee; font-size: 16px;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 10px rgba(0,0,0,.4); opacity: .8;
    }
    .fab:hover, .fab.on { opacity: 1; }
    .fab.on { background: #4b3a7a; }
    .fab.live { box-shadow: 0 0 0 2px #d97757, 0 2px 10px rgba(0,0,0,.4); }
    .win {
      position: fixed; right: 66px; bottom: 76px; z-index: 2147483002;
      width: min(440px, calc(100vw - 32px)); max-height: min(86vh, 860px);
      display: flex; flex-direction: column;
      background: #26262e; color: #e8e8ee; border: 1px solid #3a3a46;
      border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,.6); overflow: hidden;
    }
    .win[hidden] { display: none; }
    header {
      display: flex; align-items: center; gap: 10px; padding: 12px 14px 10px 16px;
      border-bottom: 1px solid #30303c;
    }
    header h1 { margin: 0; flex: 1; font-size: 15px; font-weight: 600; }
    .switch { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; cursor: pointer; color: #dcdce6; }
    button {
      border: 1px solid #4a4a58; background: transparent; color: #dcdce6;
      font-size: 12px; cursor: pointer; padding: 4px 9px; border-radius: 7px;
    }
    button:hover { background: #32323e; color: #fff; }
    button:disabled { opacity: .45; cursor: default; }
    header .x { border: none; font-size: 16px; padding: 2px 6px; color: #a3a3b4; }
    .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 16px 8px; border-bottom: 1px solid #30303c; }
    .bar label { font-size: 12px; color: #a9a9b8; }
    select, input[type=text], input[type=number], textarea {
      background: #1b1b22; color: #e8e8ee; border: 1px solid #4a4a58; border-radius: 7px;
      font-size: 12.5px; padding: 4px 7px; min-width: 0;
    }
    select { flex: 1; }
    .hint { padding: 6px 16px 0; font-size: 11.5px; color: #e0b94a; line-height: 1.4; }
    .hint:empty { display: none; }
    .body { overflow: auto; padding: 2px 16px 12px; flex: 1; min-height: 0; }
    h2 {
      margin: 14px 0 4px; font-size: 11.5px; font-weight: 600; letter-spacing: .04em;
      text-transform: uppercase; color: #c9a227;
    }
    .note { margin: 0 0 6px; font-size: 11.5px; color: #8f8fa0; line-height: 1.4; }
    .row { display: grid; grid-template-columns: 1fr 30px 118px 26px; gap: 6px; align-items: center; padding: 3px 0; }
    .row .lab { font-size: 12.5px; color: #cfcfda; line-height: 1.3; }
    .row.set .lab { color: #fff; font-weight: 600; }
    input[type=color] { width: 30px; height: 24px; padding: 0; border: 1px solid #4a4a58; border-radius: 6px; background: none; cursor: pointer; }
    .row input[type=text] { width: 118px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
    .row .rs { padding: 2px 0; width: 26px; text-align: center; }
    .trow { display: grid; grid-template-columns: 150px 1fr; gap: 8px; align-items: center; padding: 3px 0; }
    .trow .lab { font-size: 12.5px; color: #cfcfda; }
    .trow input { width: 100%; }
    .used { grid-column: 2; font-size: 11px; color: #8f8fa0; margin: -1px 0 2px; }
    .used:empty { display: none; }
    .io { padding: 8px 16px 12px; border-top: 1px solid #30303c; }
    .io[hidden] { display: none; }
    .io textarea { width: 100%; height: 110px; font: 11.5px ui-monospace, Consolas, monospace; resize: vertical; }
    .io .btns { display: flex; gap: 6px; margin-top: 6px; align-items: center; }
    .io .msg { font-size: 11.5px; color: #a9a9b8; }
    footer { display: flex; flex-wrap: wrap; gap: 6px; padding: 9px 16px 11px; border-top: 1px solid #30303c; }
    footer .grow { flex: 1; }
  `;

  let host = null;
  let shadow = null;
  let fab = null;
  let win = null;
  let stock = {};

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function init() {
    if (host) return;
    document.getElementById('lcbm-theme-host')?.remove();
    host = document.createElement('div');
    host.id = 'lcbm-theme-host';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${CSS}</style>
      <button class="fab" title="Theme: colors and fonts" aria-label="Theme: colors and fonts">&#127912;</button>
      <div class="win" role="dialog" aria-label="Theme" hidden>
        <header>
          <h1>Theme</h1>
          <label class="switch"><input type="checkbox" class="enable"> On</label>
          <button class="x" title="Close (Esc)">&#10005;</button>
        </header>
        <div class="bar">
          <label for="preset">Start from</label>
          <select id="preset" class="preset"></select>
          <button class="del" title="Delete this saved preset">Delete</button>
        </div>
        <div class="hint"></div>
        <div class="body"></div>
        <div class="io" hidden>
          <textarea spellcheck="false" placeholder="A theme as text. Export fills this box; paste a theme here and press Import."></textarea>
          <div class="btns"><button class="imp">Import</button><button class="cp">Copy</button><span class="msg"></span></div>
        </div>
        <footer>
          <input type="text" class="name" placeholder="Name for a preset" style="flex:2;min-width:150px">
          <button class="saveas">Save as preset</button>
          <span class="grow"></span>
          <button class="exp">Export / import</button>
        </footer>
      </div>`;
    fab = shadow.querySelector('.fab');
    win = shadow.querySelector('.win');
    fab.addEventListener('click', toggle);
    shadow.querySelector('.x').addEventListener('click', close);
    shadow.querySelector('.enable').addEventListener('change', (e) => {
      state.enabled = e.target.checked;
      commit();
      render();
    });
    shadow.querySelector('.preset').addEventListener('change', (e) => loadPreset(e.target.value));
    shadow.querySelector('.del').addEventListener('click', deletePreset);
    shadow.querySelector('.saveas').addEventListener('click', saveAsPreset);
    shadow.querySelector('.exp').addEventListener('click', toggleIo);
    shadow.querySelector('.imp').addEventListener('click', importTheme);
    shadow.querySelector('.cp').addEventListener('click', async () => {
      const box = shadow.querySelector('.io textarea');
      try {
        await navigator.clipboard.writeText(box.value);
        ioMsg('Copied.');
      } catch {
        box.select();
        ioMsg('Select all and copy by hand.');
      }
    });
    window.addEventListener('keydown', onKey, true);
    paintFab();
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
    stock = stockColors();
    win.hidden = false;
    fab.classList.add('on');
    render();
  }
  function close() {
    if (!win) return;
    win.hidden = true;
    fab.classList.remove('on');
  }
  function onKey(e) {
    if (e.isComposing || !isOpen() || e.key !== 'Escape') return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    close();
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function paintFab() {
    if (fab) fab.classList.toggle('live', state.enabled);
  }

  /** Apply + save after any change. */
  function commit() {
    apply();
    save();
    paintFab();
  }

  function presetNames() {
    return [...Object.keys(PRESETS), ...Object.keys(state.saved).sort((a, b) => a.localeCompare(b))];
  }
  function presetByName(name) {
    return PRESETS[name] || state.saved[name] || null;
  }
  function sameTheme(a, b) {
    const norm = (o) => JSON.stringify(Object.entries(o || {}).filter(([, v]) => v !== '' && v != null).sort());
    return norm(a.colors) === norm(b.colors) && norm(a.text) === norm(b.text);
  }

  function loadPreset(name) {
    const preset = presetByName(name);
    if (!preset) return;
    state.base = name;
    state.colors = { ...preset.colors };
    state.text = { ...preset.text };
    /** Loading a look is asking to see it; the default needs no theme at all. */
    state.enabled = name !== 'LibreChat default';
    commit();
    render();
  }

  function saveAsPreset() {
    const input = shadow.querySelector('.name');
    const name = input.value.trim();
    if (!name) {
      input.focus();
      return;
    }
    if (PRESETS[name]) {
      input.value = '';
      input.placeholder = 'That name is a built-in preset; pick another';
      return;
    }
    state.saved[name] = { colors: { ...state.colors }, text: { ...state.text } };
    state.base = name;
    input.value = '';
    input.placeholder = 'Name for a preset';
    commit();
    render();
  }

  function deletePreset() {
    const name = shadow.querySelector('.preset').value;
    if (!state.saved[name]) return;
    delete state.saved[name];
    if (state.base === name) state.base = 'LibreChat default';
    commit();
    render();
  }

  function ioMsg(text) {
    shadow.querySelector('.io .msg').textContent = text;
  }
  function toggleIo() {
    const io = shadow.querySelector('.io');
    io.hidden = !io.hidden;
    if (!io.hidden) {
      io.querySelector('textarea').value = JSON.stringify(
        { name: state.base, colors: state.colors, text: state.text },
        null,
        2,
      );
      ioMsg('This is the theme you are editing.');
    }
  }
  function importTheme() {
    let data;
    try {
      data = JSON.parse(shadow.querySelector('.io textarea').value);
    } catch {
      ioMsg('That is not a theme (not valid JSON).');
      return;
    }
    if (!data || typeof data !== 'object' || (typeof data.colors !== 'object' && typeof data.text !== 'object')) {
      ioMsg('That is not a theme (no colors or text settings).');
      return;
    }
    const colors = {};
    for (const [name, value] of Object.entries(data.colors || {})) {
      if (/^--[\w-]+$/.test(name) && typeof value === 'string' && toHex(value)) colors[name] = value;
    }
    const text = {};
    for (const [key] of TEXT_FIELDS) {
      if (typeof (data.text || {})[key] === 'string') text[key] = data.text[key];
    }
    state.colors = colors;
    state.text = text;
    state.base = typeof data.name === 'string' && data.name ? `${data.name} (imported)` : 'Imported';
    state.enabled = true;
    commit();
    render();
    ioMsg('Imported and switched on.');
  }

  function render() {
    if (!isOpen()) return;
    renderHead();
    renderBody();
  }

  /** The switch, the preset list and the hint. Cheap, so it runs after every
   *  edit; the rows below are only rebuilt when the whole theme changes, so
   *  typing never loses its place. */
  function renderHead() {
    if (!isOpen()) return;
    shadow.querySelector('.enable').checked = state.enabled;

    const select = shadow.querySelector('.preset');
    select.textContent = '';
    const names = presetNames();
    const base = presetByName(state.base);
    const edited = !base || !sameTheme(base, state);
    if (edited) {
      const o = el('option', '', base ? `${state.base} (changed)` : state.base || 'Your theme');
      o.value = '';
      select.appendChild(o);
    }
    for (const name of names) {
      const o = el('option', '', PRESETS[name] ? name : `${name} (yours)`);
      o.value = name;
      select.appendChild(o);
    }
    select.value = edited ? '' : state.base;
    shadow.querySelector('.del').disabled = !state.saved[select.value];

    const dark = document.documentElement.classList.contains('dark');
    shadow.querySelector('.hint').textContent = !state.enabled
      ? 'The theme is off. Switch it on to see your changes.'
      : dark
        ? ''
        : 'LibreChat is in light mode. The colors only apply in dark mode (Settings, General, Theme); fonts and width apply now.';
  }

  function renderBody() {
    const body = shadow.querySelector('.body');
    const keepScroll = body.scrollTop;
    body.textContent = '';

    body.appendChild(el('h2', '', 'Fonts and text'));
    const list = el('datalist');
    list.id = 'lcbm-fonts';
    for (const f of FONT_SUGGESTIONS) {
      const o = document.createElement('option');
      o.value = f;
      list.appendChild(o);
    }
    body.appendChild(list);
    for (const [key, label, kind, placeholder] of TEXT_FIELDS) {
      const row = el('div', 'trow');
      row.appendChild(el('span', 'lab', label));
      const input = document.createElement('input');
      input.type = kind === 'number' ? 'number' : 'text';
      if (kind === 'number') input.step = key === 'line' ? '0.05' : '1';
      else input.setAttribute('list', 'lcbm-fonts');
      input.placeholder = placeholder;
      input.value = state.text[key] ?? '';
      const used = el('div', 'used', kind === 'font' ? fontNote(input.value) : '');
      const onChange = () => {
        state.text[key] = input.value.trim();
        if (kind === 'font') used.textContent = fontNote(input.value);
        commit();
        renderHead();
      };
      input.addEventListener('input', onChange);
      row.appendChild(input);
      row.appendChild(used);
      body.appendChild(row);
    }

    for (const group of COLOR_GROUPS) {
      body.appendChild(el('h2', '', group.title));
      if (group.note) body.appendChild(el('p', 'note', group.note));
      for (const [name, label] of group.items) body.appendChild(colorRow(name, label));
    }
    body.scrollTop = keepScroll;
  }

  function colorRow(name, label) {
    const own = state.colors[name] || '';
    const row = el('div', `row${own ? ' set' : ''}`);
    row.appendChild(el('span', 'lab', label));

    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = toHex(own) || toHex(stock[name]) || '#000000';
    picker.title = 'Pick a color';

    const field = document.createElement('input');
    field.type = 'text';
    field.value = own;
    field.placeholder = toHex(stock[name]) || 'none';
    field.spellcheck = false;
    field.title = 'A hex color, or any CSS color such as rgba(255, 255, 255, 0.08)';

    const reset = el('button', 'rs', '↺');
    reset.title = 'Back to LibreChat\'s own color';
    reset.disabled = !own;

    const set = (value) => {
      if (value) state.colors[name] = value;
      else delete state.colors[name];
      row.classList.toggle('set', !!value);
      reset.disabled = !value;
      commit();
      renderHead();
    };
    picker.addEventListener('input', () => {
      field.value = picker.value;
      set(picker.value);
    });
    field.addEventListener('change', () => {
      const value = field.value.trim();
      if (value && !toHex(value)) {
        field.value = state.colors[name] || '';
        return;
      }
      set(value);
      picker.value = toHex(value) || toHex(stock[name]) || '#000000';
    });
    reset.addEventListener('click', () => {
      set('');
      field.value = '';
      picker.value = toHex(stock[name]) || '#000000';
    });

    row.append(picker, field, reset);
    return row;
  }

  async function boot() {
    state = await loadState();
    apply();
    init();
    /** A change made in another LibreChat tab shows here too. */
    if (hasChromeStore() && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[STORE_KEY]) return;
        const next = normalize(changes[STORE_KEY].newValue);
        if (JSON.stringify(next) === JSON.stringify(state)) return;
        state = next;
        apply();
        paintFab();
        render();
      });
    }
  }

  LCBM.theme = { boot, open, close, toggle, isOpen, compile, toHex, hslTriplet, PRESETS, getState: () => state };
})();

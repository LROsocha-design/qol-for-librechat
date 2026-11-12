/**
 * PREFILL — a "Prefill" pill next to Styles. While it is on, the saved text
 * goes into every empty message box: on page load, in every chat you open,
 * and again each time a sent message empties the box.
 *
 * How the composer behaves (LibreChat v0.8.7, verified in source):
 * - The textarea is `#prompt-textarea`, registered with react-hook-form. A
 *   send ends in `methods.reset()` (useSubmitMessage.ts), which empties it
 *   programmatically, with no `input` event.
 * - Draft autosave (useAutoSave.ts) keys drafts by conversation and swaps to
 *   PENDING_CONVO while a reply streams, so the box is rewritten from drafts
 *   at the start and the end of every run. So we only fill once the box has
 *   held the same value for SETTLE_MS with no run going.
 * - During a run, text in the box turns the Stop button into the steer/queue
 *   send button (ChatForm.tsx duringRunSlot). So an untouched prefill is
 *   taken out while a reply generates and put back afterwards.
 *
 * "Untouched" = the box holds exactly the rendered prefill. Such a box is
 * never sent (the submit is swallowed). It is advertised as
 * `data-lc-prefill` on the textarea so the QoL extension's arrow keys treat
 * it like an empty box.
 *
 * Emptying the box by hand (a real keystroke leaving it empty) keeps it
 * empty until the next send or chat switch, for a message without the prefill.
 */
(() => {
  const LCSS = (window.LCSS = window.LCSS || {});

  const ON_KEY = 'lcpf.on';
  const TEXT_KEY = 'lcpf.text';
  const HISTORY_KEY = 'lcpf.history';
  const CURSOR = '{{cursor}}';
  const DEFAULT_TEXT = '((OOC: ))\n---\nIC: ';
  const COMPOSER_ID = 'prompt-textarea';
  const RUN_MARKERS =
    '[data-testid="stop-generation-button"], [data-testid="during-run-send-button"], [data-testid="interrupt-steer-button"]';
  const POP_WIDTH = 380;
  const SETTLE_MS = 400;
  const TICK_MS = 200;
  const HISTORY_MAX = 10;

  // Reloading the extension leaves the old copy of this script running in open
  // tabs (its timer and listeners outlive it). The newest copy claims the page;
  // older ones see the claim change and stand down.
  const GEN = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  document.documentElement.dataset.lcpfGen = GEN;
  const current = () => document.documentElement.dataset.lcpfGen === GEN;

  const ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h1a3 3 0 0 1 3 3 3 3 0 0 1 3-3h1"/><path d="M13 20h-1a3 3 0 0 1-3-3 3 3 0 0 1-3 3H5"/><path d="M5 16H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h1"/><path d="M13 8h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-7"/><path d="M9 7v10"/></svg>';

  const STYLE = `
    :host { position: fixed; inset: 0; z-index: 10000; pointer-events: none; }
    * { box-sizing: border-box; }
    .pop {
      position: absolute; pointer-events: auto;
      width: ${POP_WIDTH}px; display: flex; flex-direction: column;
      background: var(--surface-primary, #fff); color: var(--text-primary, #111);
      border: 1px solid var(--border-medium, #ccc); border-radius: 14px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
    }
    .pop[hidden] { display: none; }
    .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px 6px; }
    .title { font-weight: 600; font-size: 14px; }
    .sub { color: var(--text-tertiary, #777); font-size: 12px; flex: 1; }
    .iconbtn {
      border: 0; background: transparent; color: var(--text-secondary, #555);
      cursor: pointer; border-radius: 8px; padding: 2px 7px; font-size: 15px; line-height: 1.2;
    }
    .iconbtn:hover { background: var(--surface-hover, #eee); }
    .onrow {
      display: flex; align-items: center; gap: 8px; padding: 2px 12px 8px;
      cursor: pointer; user-select: none; font-size: 13px;
    }
    .onrow input { width: 16px; height: 16px; margin: 0; accent-color: var(--brand-purple, #ab68ff); cursor: pointer; }
    .tpl {
      display: block; width: calc(100% - 24px); margin: 0 12px; min-height: 96px; max-height: 40vh;
      resize: vertical; padding: 8px 10px; border-radius: 10px;
      border: 1px solid var(--border-medium, #ccc);
      background: var(--surface-secondary, #f7f7f7); color: var(--text-primary, #111);
      font: 13px/1.45 ui-monospace, "Cascadia Mono", Consolas, monospace; white-space: pre-wrap;
    }
    .tpl:focus { outline: 2px solid var(--brand-purple, #ab68ff); outline-offset: -1px; }
    .hint { padding: 8px 12px 4px; color: var(--text-tertiary, #777); font-size: 11.5px; }
    .hint code { font-size: 11px; }
    .foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 6px 12px 8px; }
    .btn {
      border: 1px solid var(--border-medium, #ccc); background: var(--surface-secondary, #f7f7f7);
      color: var(--text-primary, #111); border-radius: 999px; padding: 4px 10px; font-size: 12px; cursor: pointer;
    }
    .btn:hover { background: var(--surface-hover, #eee); }
    .btn:disabled { opacity: 0.5; cursor: default; }
    .status { padding: 0 12px 8px; font-size: 11.5px; color: var(--text-tertiary, #777); min-height: 20px; }
    .status.err { color: #dc2626; }
  `;

  /* ---------- settings (per browser, wrapped: storage can throw) ---------- */

  function read(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch {
      return fallback;
    }
  }
  function write(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode etc. */
    }
  }

  function isOn() {
    return read(ON_KEY, '0') === '1';
  }
  function template() {
    return read(TEXT_KEY, DEFAULT_TEXT);
  }

  /** The text that goes into the box, and where the caret lands in it. */
  function render(tpl) {
    const at = tpl.indexOf(CURSOR);
    const text = tpl.split(CURSOR).join('');
    return { text, caret: at < 0 ? text.length : at };
  }

  /** Earlier renderings, so a saved draft still holding an old prefill is recognised. */
  function history() {
    try {
      const list = JSON.parse(read(HISTORY_KEY, '[]'));
      return Array.isArray(list) ? list.filter((s) => typeof s === 'string') : [];
    } catch {
      return [];
    }
  }
  function remember(text) {
    if (!text) return;
    const list = history().filter((s) => s !== text);
    list.unshift(text);
    write(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
  }

  /* ---------- composer ---------- */

  function composer() {
    return document.getElementById(COMPOSER_ID);
  }

  /**
   * Set the box's text the way typing would reach react-hook-form: the
   * prototype setter skips React's value tracker (so it sees a change), and
   * the `input` event runs its onChange plus the draft autosave.
   */
  function writeComposer(ta, value, caret) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, value);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    if (caret != null) {
      try {
        ta.setSelectionRange(caret, caret);
      } catch {
        /* detached */
      }
    }
  }

  function isRunning(ta) {
    const form = ta.closest('form');
    if (!form) return false;
    return !!form.querySelector(RUN_MARKERS) || !form.querySelector('[data-testid="send-button"]');
  }

  /** An `ask_user_question` pause turns the box into the answer field; leave it alone then. */
  function askOpen() {
    return document.querySelector('div.popover') !== null;
  }

  let tracked = null; // the composer element the state below belongs to
  let userEmptied = false;
  let lastValue = null;
  let stableSince = 0;
  let lastHref = location.href;

  function resetState() {
    userEmptied = false;
    lastValue = null;
  }

  document.addEventListener(
    'input',
    (e) => {
      // Only real keystrokes count; our own writes dispatch untrusted events.
      if (current() && e.isTrusted && e.target && e.target.id === COMPOSER_ID) userEmptied = e.target.value === '';
    },
    true,
  );

  document.addEventListener(
    'submit',
    (e) => {
      const ta = composer();
      if (!current() || !ta || !(e.target instanceof HTMLFormElement) || !e.target.contains(ta)) return;
      const { text } = render(template());
      if (isOn() && text && ta.value === text) {
        // Capture on document runs before React's root listener, so this send never starts.
        e.preventDefault();
        e.stopImmediatePropagation();
        flashPill();
        return;
      }
      userEmptied = false;
    },
    true,
  );

  function tick() {
    if (!current()) return;
    const ta = composer();
    if (ta !== tracked) {
      tracked = ta;
      resetState();
    }
    if (location.href !== lastHref) {
      lastHref = location.href;
      resetState();
    }
    if (!ta) return;

    const on = isOn();
    const { text, caret } = render(template());
    if (on && text) {
      if (ta.dataset.lcPrefill !== text) ta.dataset.lcPrefill = text;
    } else if ('lcPrefill' in ta.dataset) {
      delete ta.dataset.lcPrefill;
    }

    const v = ta.value;
    const now = Date.now();
    if (v !== lastValue) {
      lastValue = v;
      stableSince = now;
      return;
    }
    if (ta.disabled) return;
    if (isRunning(ta)) {
      if (on && text && v === text) writeComposer(ta, '', null);
      stableSince = now;
      return;
    }
    if (now - stableSince < SETTLE_MS || askOpen()) return;

    if (v !== '' && history().includes(v) && (v !== text || !on)) {
      // A draft saved with an older (or a now switched-off) prefill.
      writeComposer(ta, on ? text : '', on ? caret : null);
      return;
    }
    if (on && text && v === '' && !userEmptied) {
      writeComposer(ta, text, caret);
      remember(text);
    }
  }

  /* ---------- pill + popover ---------- */

  let pillEl = null;
  let host = null;
  let pop = null;
  let onEl = null;
  let tplEl = null;
  let statusEl = null;
  let saveTimer = 0;

  function buildPill() {
    const b = document.createElement('button');
    b.id = 'lcpf-pill';
    b.type = 'button';
    b.setAttribute('aria-label', 'Prefill: text that starts every new message');
    b.setAttribute('aria-haspopup', 'dialog');
    b.className =
      'relative rounded-full border border-border-medium text-sm font-medium transition-shadow bg-surface-chat shadow-sm hover:bg-surface-hover hover:shadow-md active:scale-95';
    b.innerHTML = ICON_SVG + '<span class="lcss-label">Prefill</span><span class="lcpf-dot" hidden></span>';
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });
    pillEl = b;
    updatePill();
    return b;
  }

  function updatePill() {
    if (!pillEl) return;
    const on = isOn();
    pillEl.querySelector('.lcpf-dot').hidden = !on;
    pillEl.classList.toggle('bg-surface-active', on);
    pillEl.classList.toggle('shadow-md', on);
    pillEl.classList.toggle('bg-surface-chat', !on);
    pillEl.classList.toggle('shadow-sm', !on);
    pillEl.title = on ? `Prefill on:\n${render(template()).text}` : 'Prefill off';
  }

  function flashPill() {
    if (!pillEl) return;
    pillEl.classList.remove('lcpf-flash');
    void pillEl.offsetWidth; // restart the animation
    pillEl.classList.add('lcpf-flash');
    pillEl.title = 'Nothing typed after the prefill yet, so it was not sent.';
    setTimeout(updatePill, 2500);
  }

  function setStatus(msg, isErr) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('err', !!isErr);
  }

  function ensureHost() {
    if (host && document.contains(host)) return;
    host = document.createElement('div');
    host.id = 'lcpf-host';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    shadow.appendChild(style);

    pop = document.createElement('div');
    pop.className = 'pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Prefill');
    pop.hidden = true;
    pop.innerHTML = `
      <div class="head">
        <span class="title">Prefill</span>
        <span class="sub">starts every new message</span>
        <button type="button" class="iconbtn close" title="Close">&#x2715;</button>
      </div>
      <label class="onrow"><input type="checkbox" class="on"> On</label>
      <textarea class="tpl" spellcheck="false" aria-label="Prefill text"></textarea>
      <div class="hint">Saved as you type. Put <code>${CURSOR}</code> where the caret should land (otherwise it lands at the end). It goes into the empty message box after every send and in every chat you open. To send one message without it, empty the box by hand. A box holding only the prefill is never sent.</div>
      <div class="foot">
        <button type="button" class="btn example" title="Put the OOC / --- / IC example back">Example</button>
        <button type="button" class="btn insert" title="Put the prefill at the start of the message box now">Insert now</button>
      </div>
      <div class="status"></div>
    `;
    shadow.appendChild(pop);

    onEl = pop.querySelector('.on');
    tplEl = pop.querySelector('.tpl');
    statusEl = pop.querySelector('.status');

    onEl.addEventListener('change', () => setOn(onEl.checked));
    tplEl.addEventListener('input', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveTemplate(tplEl.value), 250);
    });
    pop.querySelector('.close').addEventListener('click', close);
    pop.querySelector('.example').addEventListener('click', () => {
      tplEl.value = DEFAULT_TEXT;
      saveTemplate(DEFAULT_TEXT);
      tplEl.focus();
    });
    pop.querySelector('.insert').addEventListener('click', insertNow);
    // Keys typed in the template must not reach LibreChat's window shortcuts:
    // from outside the shadow root the target looks like a plain <div>.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      pop.addEventListener(type, (e) => {
        if (e.key !== 'Escape') e.stopPropagation();
      });
    }

    document.body.appendChild(host);
    document.addEventListener('pointerdown', onDocPointerDown, true);
    document.addEventListener('keydown', onDocKeyDown, true);
  }

  function onDocPointerDown(e) {
    if (!pop || pop.hidden) return;
    const path = e.composedPath();
    if (path.includes(pop) || (pillEl && path.includes(pillEl))) return;
    close();
  }
  function onDocKeyDown(e) {
    if (e.key === 'Escape' && pop && !pop.hidden) {
      close();
      e.stopPropagation();
    }
  }

  function setOn(value) {
    const ta = composer();
    const { text, caret } = render(template());
    write(ON_KEY, value ? '1' : '0');
    if (ta && text && !ta.disabled && !isRunning(ta)) {
      if (value && ta.value === '') {
        writeComposer(ta, text, caret);
        remember(text);
      } else if (!value && ta.value === text) {
        writeComposer(ta, '', null);
      }
    }
    lastValue = null;
    setStatus(value ? 'On: every new message starts with this.' : 'Off.');
    updatePill();
  }

  function saveTemplate(tpl) {
    const before = render(template()).text;
    write(TEXT_KEY, tpl);
    const { text, caret } = render(tpl);
    const ta = composer();
    // An untouched prefill in the box follows the edit.
    if (isOn() && ta && before && ta.value === before && !isRunning(ta)) {
      writeComposer(ta, text, caret);
      remember(text);
    }
    lastValue = null;
    setStatus(text ? 'Saved.' : 'Saved (empty: nothing will be added).');
    updatePill();
  }

  /** Put the prefill in front of whatever is in the box; the typed text goes where the caret mark is. */
  function insertNow() {
    const ta = composer();
    if (!ta || ta.disabled) {
      setStatus('No message box on this page.', true);
      return;
    }
    const { text, caret } = render(template());
    if (!text) {
      setStatus('The prefill is empty.', true);
      return;
    }
    if (ta.value === text || ta.value.startsWith(text)) {
      setStatus('The box already starts with it.');
      return;
    }
    const typed = ta.value;
    writeComposer(ta, text.slice(0, caret) + typed + text.slice(caret), caret + typed.length);
    remember(text);
    lastValue = null;
    close();
    ta.focus();
  }

  function position() {
    if (!pillEl || !pop) return;
    const r = pillEl.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - POP_WIDTH - 8));
    pop.style.left = `${left}px`;
    if (r.top > window.innerHeight * 0.45) {
      pop.style.top = '';
      pop.style.bottom = `${window.innerHeight - r.top + 8}px`;
    } else {
      pop.style.bottom = '';
      pop.style.top = `${r.bottom + 8}px`;
    }
  }

  function open() {
    ensureHost();
    onEl.checked = isOn();
    tplEl.value = template();
    setStatus('');
    pop.hidden = false;
    position();
    tplEl.focus();
    const end = tplEl.value.length;
    tplEl.setSelectionRange(end, end);
  }
  function close() {
    if (!pop || pop.hidden) return;
    clearTimeout(saveTimer);
    if (tplEl.value !== template()) saveTemplate(tplEl.value);
    pop.hidden = true;
  }
  function toggle() {
    if (!pop || pop.hidden) open();
    else close();
  }

  setInterval(tick, TICK_MS);

  LCSS.prefill = { buildPill, position, close, render, writeComposer, DEFAULT_TEXT };
})();

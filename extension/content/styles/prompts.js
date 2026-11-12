/**
 * PROMPTS — a pill in the composer's badge row that lists the saved prompts from
 * LibreChat's Prompts tab and puts the chosen one into the message box, at the caret.
 *
 * Server side (stock, api/server/routes/prompts.js):
 *   GET  /api/prompts/all             → [group] each with productionPrompt { _id, prompt },
 *                                        most used first, then last updated
 *   POST /api/prompts/groups/:id/use  → counts a use, as the `/` command does
 *
 * Variables follow the stock rules (client/src/utils/prompts.ts, VariableForm.tsx):
 * {{current_date}}, {{current_datetime}}, {{iso_datetime}} and {{current_user}} are
 * filled in; any other {{name}} or {{name:a|b|c}} gets a field in the popover first.
 *
 * Text lands where the caret was in the message box (a textarea keeps its selection
 * while it is blurred), so with the Prefill on it goes into the prefill's caret slot.
 */
(() => {
  const LCSS = (window.LCSS = window.LCSS || {});
  const URL_ = '/api/prompts/all';
  const COMPOSER_ID = 'prompt-textarea';
  const POP_WIDTH = 380;
  const SPECIAL = ['current_date', 'current_datetime', 'iso_datetime', 'current_user'];

  const ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 12a2 2 0 0 0 2-2V8H8"/><path d="M14 12a2 2 0 0 0 2-2V8h-2"/></svg>';

  const STYLE = `
    :host { position: fixed; inset: 0; z-index: 10000; pointer-events: none; }
    * { box-sizing: border-box; }
    .pop {
      position: absolute; pointer-events: auto;
      width: ${POP_WIDTH}px; max-height: 70vh; display: flex; flex-direction: column;
      background: var(--surface-primary, #fff); color: var(--text-primary, #111);
      border: 1px solid var(--border-medium, #ccc); border-radius: 14px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
    }
    .pop[hidden], [hidden] { display: none !important; }
    .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px 6px; }
    .title { font-weight: 600; font-size: 14px; }
    .sub { color: var(--text-tertiary, #777); font-size: 12px; flex: 1; }
    .iconbtn {
      border: 0; background: transparent; color: var(--text-secondary, #555);
      cursor: pointer; border-radius: 8px; padding: 2px 7px; font-size: 15px; line-height: 1.2;
    }
    .iconbtn:hover { background: var(--surface-hover, #eee); }
    .search {
      display: block; width: calc(100% - 24px); margin: 0 12px 6px; padding: 6px 10px;
      border-radius: 10px; border: 1px solid var(--border-medium, #ccc);
      background: var(--surface-secondary, #f7f7f7); color: var(--text-primary, #111); font: inherit;
    }
    .search:focus, .field input:focus { outline: 2px solid var(--brand-purple, #ab68ff); outline-offset: -1px; }
    .list { overflow: auto; padding: 0 8px 6px; flex: 1; min-height: 0; }
    .row {
      display: flex; align-items: flex-start; gap: 8px; padding: 7px 8px; border-radius: 10px;
      cursor: pointer; border: 1px solid transparent;
    }
    .row.active { background: var(--surface-hover, #eee); border-color: var(--border-medium, #ccc); }
    .row .txt { flex: 1; min-width: 0; }
    .row .name { font-weight: 600; }
    .row .tag {
      display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 999px;
      font-size: 11px; font-weight: 500; vertical-align: 1px;
      background: var(--surface-tertiary, #e5e5e5); color: var(--text-secondary, #555);
    }
    .row .desc {
      color: var(--text-secondary, #555); font-size: 12px; margin-top: 2px;
      overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      white-space: pre-line; overflow-wrap: anywhere;
    }
    .row .iconbtn { flex: none; font-size: 13px; opacity: 0.6; }
    .row:hover .iconbtn, .row.active .iconbtn { opacity: 1; }
    .empty { padding: 10px 8px; color: var(--text-tertiary, #777); }
    .vars { padding: 0 12px 4px; overflow: auto; }
    .vars .for { font-weight: 600; margin-bottom: 6px; }
    .field { display: block; margin-bottom: 8px; }
    .field span { display: block; font-size: 12px; color: var(--text-secondary, #555); margin-bottom: 2px; }
    .field input {
      width: 100%; padding: 5px 9px; border-radius: 8px; border: 1px solid var(--border-medium, #ccc);
      background: var(--surface-secondary, #f7f7f7); color: var(--text-primary, #111); font: inherit;
    }
    .foot { display: flex; justify-content: flex-end; gap: 8px; padding: 4px 12px 8px; }
    .btn {
      border: 1px solid var(--border-medium, #ccc); background: var(--surface-secondary, #f7f7f7);
      color: var(--text-primary, #111); border-radius: 999px; padding: 4px 12px; font-size: 12px; cursor: pointer;
    }
    .btn:hover { background: var(--surface-hover, #eee); }
    .hint { padding: 2px 12px 4px; color: var(--text-tertiary, #777); font-size: 11.5px; }
    .status { padding: 0 12px 8px; font-size: 11.5px; color: var(--text-tertiary, #777); min-height: 18px; white-space: pre-wrap; }
    .status.err { color: #dc2626; }
  `;

  let groups = null; // last list from the server
  let loadError = null;
  let userName = null;
  let query = '';
  let active = 0;
  let shown = []; // groups currently listed, in order
  let filling = null; // { group, text, vars } while the variable form is open

  let pillEl = null;
  let host = null;
  let pop = null;
  let searchEl = null;
  let listEl = null;
  let subEl = null;
  let varsEl = null;
  let pickEls = [];
  let statusEl = null;

  /* ---------- server ---------- */

  async function fetchGroups() {
    let res;
    try {
      res = await LCSS.api.authedFetch(URL_);
    } catch (e) {
      loadError = e.message;
      return;
    }
    const data = await LCSS.api.readJson(res);
    if (res.status === 403) {
      loadError = 'Your account has no access to prompts.';
      return;
    }
    if (!res.ok || !Array.isArray(data)) {
      loadError = (data && data.error) || `Loading prompts failed (HTTP ${res.status})`;
      return;
    }
    loadError = null;
    groups = data;
  }

  async function fetchUserName() {
    if (userName !== null) return;
    try {
      const me = await LCSS.api.getMe();
      userName = (me && me.name) || '';
    } catch {
      /* {{current_user}} stays as written */
    }
  }

  function recordUse(id) {
    LCSS.api.authedFetch(`/api/prompts/groups/${encodeURIComponent(id)}/use`, { method: 'POST' }).catch(() => {});
  }

  /* ---------- text ---------- */

  function textOf(g) {
    return (g.productionPrompt && g.productionPrompt.prompt) || '';
  }

  /** Same output as replaceSpecialVars in librechat-data-provider (parsers.ts). */
  function fillSpecial(text) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const off = -now.getTimezoneOffset();
    const zone = `${off < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    let out = text
      .replace(/{{\s*current_date\s*}}/gi, `${date} (${weekday})`)
      .replace(/{{\s*current_datetime\s*}}/gi, `${date} ${time} ${zone} (${weekday})`)
      .replace(/{{\s*iso_datetime\s*}}/gi, now.toISOString());
    if (userName) out = out.replace(/{{\s*current_user\s*}}/gi, userName);
    return out;
  }

  /** The {{...}} left after the special ones, unique, in order of first use. */
  function variablesIn(text) {
    const seen = new Set();
    for (const m of text.matchAll(/{{(.*?)}}/g)) {
      if (!SPECIAL.includes(m[1].trim().toLowerCase())) seen.add(m[1]);
    }
    return [...seen].map((raw) => {
      const content = raw.trim();
      const [name, options] = content.split(':');
      if (content.includes(':') && options && options.includes('|')) {
        return { raw, label: name.trim(), options: options.split('|').map((o) => o.trim()) };
      }
      return { raw, label: content, options: null };
    });
  }

  /* ---------- composer ---------- */

  function composer() {
    return document.getElementById(COMPOSER_ID);
  }

  /** Put the text at the caret (over a selection); a newline first if it would touch a word. */
  function insert(text) {
    const ta = composer();
    if (!ta || ta.disabled) {
      setStatus('No message box on this page.', true);
      return false;
    }
    const value = ta.value;
    const start = Math.min(ta.selectionStart ?? value.length, value.length);
    const end = Math.max(start, Math.min(ta.selectionEnd ?? start, value.length));
    const before = value.slice(0, start);
    const sep = before && !/\s$/.test(before) ? '\n' : '';
    const head = before + sep + text;
    LCSS.prefill.writeComposer(ta, head + value.slice(end), head.length);
    ta.focus();
    return true;
  }

  function choose(group) {
    if (!group) return;
    const text = fillSpecial(textOf(group));
    const vars = variablesIn(text);
    if (vars.length) {
      openVars(group, text, vars);
      return;
    }
    finish(group, text);
  }

  function finish(group, text) {
    if (!insert(text)) return;
    recordUse(group._id);
    close(false);
  }

  /* ---------- pill ---------- */

  function buildPill() {
    const b = document.createElement('button');
    b.id = 'lcpr-pill';
    b.type = 'button';
    b.setAttribute('aria-label', 'Prompts: put a saved prompt into the message box');
    b.setAttribute('aria-haspopup', 'dialog');
    b.title = 'Prompts';
    b.className =
      'relative rounded-full border border-border-medium text-sm font-medium transition-shadow bg-surface-chat shadow-sm hover:bg-surface-hover hover:shadow-md active:scale-95';
    b.innerHTML = ICON_SVG + '<span class="lcss-label">Prompts</span>';
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });
    pillEl = b;
    return b;
  }

  /* ---------- popover ---------- */

  function setStatus(msg, isErr) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('err', !!isErr);
  }

  function ensureHost() {
    if (host && document.contains(host)) return;
    host = document.createElement('div');
    host.id = 'lcpr-host';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    shadow.appendChild(style);

    pop = document.createElement('div');
    pop.className = 'pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Prompts');
    pop.hidden = true;
    pop.innerHTML = `
      <div class="head">
        <span class="title">Prompts</span>
        <span class="sub"></span>
        <button type="button" class="iconbtn refresh" title="Load again">&#x21bb;</button>
        <button type="button" class="iconbtn close" title="Close">&#x2715;</button>
      </div>
      <input type="text" class="search pick" placeholder="Search prompts…" spellcheck="false" aria-label="Search prompts">
      <div class="list pick" role="listbox"></div>
      <div class="hint pick">Click one, or pick with ↑ ↓ and Enter. It goes where the caret is in the message box.</div>
      <div class="vars" hidden></div>
      <div class="foot vars-foot" hidden>
        <button type="button" class="btn back">Back</button>
        <button type="button" class="btn put">Insert</button>
      </div>
      <div class="status"></div>
    `;
    shadow.appendChild(pop);

    searchEl = pop.querySelector('.search');
    listEl = pop.querySelector('.list');
    subEl = pop.querySelector('.sub');
    varsEl = pop.querySelector('.vars');
    statusEl = pop.querySelector('.status');
    pickEls = [...pop.querySelectorAll('.pick')];

    pop.querySelector('.close').addEventListener('click', () => close(true));
    pop.querySelector('.refresh').addEventListener('click', async () => {
      setStatus('Loading…');
      await fetchGroups();
      render();
      setStatus(loadError || 'Up to date.', !!loadError);
    });
    pop.querySelector('.back').addEventListener('click', closeVars);
    pop.querySelector('.put').addEventListener('click', putVars);
    searchEl.addEventListener('input', () => {
      query = searchEl.value;
      active = 0;
      render();
    });
    searchEl.addEventListener('keydown', onSearchKey);
    varsEl.addEventListener('keydown', onVarsKey);
    listEl.addEventListener('mousemove', (e) => {
      const row = e.target.closest && e.target.closest('.row');
      if (row && Number(row.dataset.i) !== active) setActive(Number(row.dataset.i), false);
    });
    listEl.addEventListener('click', onListClick);
    // Keys typed here must not reach LibreChat's window shortcuts.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      pop.addEventListener(type, (e) => {
        if (e.key !== 'Escape') e.stopPropagation();
      });
    }

    document.body.appendChild(host);
    document.addEventListener('pointerdown', onDocPointerDown, true);
    document.addEventListener('keydown', onDocKeyDown, true);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  /** Name and /command matches first, then matches anywhere in the text. */
  function matching() {
    const q = query.trim().toLowerCase();
    if (!groups) return [];
    if (!q) return groups.slice();
    const has = (s) => (s || '').toLowerCase().includes(q);
    const top = groups.filter((g) => has(g.name) || has(g.command));
    const rest = groups.filter((g) => !top.includes(g) && (has(g.category) || has(g.oneliner) || has(textOf(g))));
    return top.concat(rest);
  }

  function render() {
    if (!pop) return;
    subEl.textContent = groups ? `${groups.length} saved` : '';
    if (loadError) setStatus(loadError, true);
    if (!groups) {
      listEl.innerHTML = `<div class="empty">${loadError ? '' : 'Loading…'}</div>`;
      return;
    }
    shown = matching();
    active = Math.min(active, Math.max(shown.length - 1, 0));
    if (!groups.length) {
      listEl.innerHTML = '<div class="empty">No saved prompts yet. Make one in the Prompts tab.</div>';
      return;
    }
    if (!shown.length) {
      listEl.innerHTML = '<div class="empty">Nothing matches.</div>';
      return;
    }
    listEl.innerHTML = shown
      .map((g, i) => {
        const text = textOf(g);
        const cmd = g.command ? `<span class="tag">/${escapeHtml(g.command)}</span>` : '';
        const desc = (g.oneliner || text).slice(0, 300);
        const tip = text.length > 1200 ? text.slice(0, 1200) + '…' : text;
        return `<div class="row${i === active ? ' active' : ''}" role="option" data-i="${i}" title="${escapeHtml(tip)}"><div class="txt"><div><span class="name">${escapeHtml(g.name)}</span>${cmd}</div><div class="desc">${escapeHtml(desc)}</div></div><button type="button" class="iconbtn edit" title="Edit in the Prompts tab (new browser tab)">&#x270E;</button></div>`;
      })
      .join('');
  }

  function setActive(i, scroll) {
    if (!shown.length) return;
    active = (i + shown.length) % shown.length;
    listEl.querySelectorAll('.row').forEach((r) => r.classList.toggle('active', Number(r.dataset.i) === active));
    if (scroll) {
      const row = listEl.querySelector(`.row[data-i="${active}"]`);
      if (row) row.scrollIntoView({ block: 'nearest' });
    }
  }

  function onSearchKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(active + (e.key === 'ArrowDown' ? 1 : -1), true);
    } else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      choose(shown[active]);
    }
  }

  function onListClick(e) {
    const row = e.target.closest && e.target.closest('.row');
    if (!row) return;
    const group = shown[Number(row.dataset.i)];
    if (!group) return;
    if (e.target.closest('.edit')) {
      window.open(`/prompts/${encodeURIComponent(group._id)}`, '_blank', 'noopener');
      return;
    }
    choose(group);
  }

  /* ---------- variable form ---------- */

  function openVars(group, text, vars) {
    filling = { group, text, vars };
    pickEls.forEach((el) => (el.hidden = true));
    varsEl.hidden = false;
    pop.querySelector('.vars-foot').hidden = false;
    varsEl.innerHTML =
      `<div class="for">${escapeHtml(group.name)}</div>` +
      vars
        .map((v, i) => {
          const list = v.options ? ` list="lcpr-opt-${i}"` : '';
          const opts = v.options
            ? `<datalist id="lcpr-opt-${i}">${v.options.map((o) => `<option value="${escapeHtml(o)}"></option>`).join('')}</datalist>`
            : '';
          const ph = v.options ? v.options.join(' / ') : '';
          return `<label class="field"><span>${escapeHtml(v.label)}</span><input type="text" data-i="${i}"${list} placeholder="${escapeHtml(ph)}" spellcheck="false">${opts}</label>`;
        })
        .join('');
    setStatus('Fields left empty stay as {{…}} in the text.');
    const first = varsEl.querySelector('input');
    if (first) first.focus();
  }

  function closeVars() {
    filling = null;
    varsEl.hidden = true;
    varsEl.innerHTML = '';
    pop.querySelector('.vars-foot').hidden = true;
    pickEls.forEach((el) => (el.hidden = false));
    setStatus('');
    searchEl.focus();
  }

  function putVars() {
    if (!filling) return;
    let text = filling.text;
    varsEl.querySelectorAll('input[data-i]').forEach((input) => {
      const v = filling.vars[Number(input.dataset.i)];
      if (input.value) text = text.split(`{{${v.raw}}}`).join(input.value);
    });
    finish(filling.group, text);
  }

  function onVarsKey(e) {
    if (e.key !== 'Enter' || e.isComposing || !e.target.matches('input[data-i]')) return;
    e.preventDefault();
    const inputs = [...varsEl.querySelectorAll('input[data-i]')];
    const next = inputs[inputs.indexOf(e.target) + 1];
    if (next) next.focus();
    else putVars();
  }

  /* ---------- open / close ---------- */

  function onDocPointerDown(e) {
    if (!pop || pop.hidden) return;
    const path = e.composedPath();
    if (path.includes(pop) || (pillEl && path.includes(pillEl))) return;
    close(false);
  }
  function onDocKeyDown(e) {
    if (e.key === 'Escape' && pop && !pop.hidden) {
      close(true);
      e.stopPropagation();
    }
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

  async function open() {
    ensureHost();
    if (filling) closeVars();
    query = '';
    active = 0;
    searchEl.value = '';
    setStatus('');
    render();
    pop.hidden = false;
    position();
    searchEl.focus();
    await Promise.all([fetchGroups(), fetchUserName()]);
    if (!pop.hidden && !filling) render();
  }

  /** `refocus`: give the message box its caret back (Escape, ✕). */
  function close(refocus) {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    if (filling) closeVars();
    if (refocus) {
      const ta = composer();
      if (ta) ta.focus();
    }
  }
  function toggle() {
    if (!pop || pop.hidden) open();
    else close(true);
  }

  LCSS.prompts = { buildPill, position, close: () => close(false) };
})();

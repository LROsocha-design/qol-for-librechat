/**
 * SKILL-CALLS — a round button with a number: how many times the model
 * called the `skill` tool on the branch you are looking at. Always-apply
 * skills are put into every prompt without any call; this counts only the
 * times the model loaded a skill itself.
 *
 * Click the button for the list: one row per call, grouped by skill. A row
 * jumps to that reply; "Text" shows what the call put into the prompt.
 *
 * Where the text comes from: the chat only keeps the call ({skillName,
 * args}) and a one-line result ("Skill "x" loaded. Follow the instructions
 * below."). The skill's body went into the next request of that reply as
 * plain text, and only the Prompt Inspector's recording of that request
 * still has it as it was then:
 *   GET <inspector>/inspector/skill-call?msg=<replyId>&tool=<callId>&skill=<name>
 * Replies without a recording fall back to the skill as it is NOW
 * (GET /api/skills), and the window says so.
 *
 * The calls are read from GET /api/messages/:conversationId (content parts
 * of type `tool_call` named `skill`), fetched when a chat opens, when the
 * displayed messages change and when a reply stops streaming.
 */
(() => {
  'use strict';

  const LCBM = (window.LCBM = window.LCBM || {});
  const { adapter, api } = LCBM;

  /** Overridable only for a mock page, like prompt-link.js. */
  const INSPECTOR = LCBM.INSPECTOR_URL || (LCBM.config && LCBM.config.inspectorUrl) || '';
  const TOOL_NAME = 'skill';
  /** A call written into the reply by hand (LibreChat's insert-skill-call
   *  patch). Its result holds the skill's text itself, like on claude.ai. */
  const INSERTED_PREFIX = 'toolu_inserted_';
  const REFRESH_DELAY_MS = 1200;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, sans-serif; }
    .fab {
      position: fixed; right: 21px; bottom: 268px; z-index: 2147483000;
      width: 34px; height: 34px; border-radius: 50%; border: none; cursor: pointer;
      background: #3a3a48; color: #e8e8ee; font: 600 13px system-ui, sans-serif;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 10px rgba(0,0,0,.4); opacity: .8;
    }
    .fab[hidden] { display: none; }
    .fab:hover, .fab.on { opacity: 1; }
    .fab.on { background: #4b3a7a; }
    .fab.some { background: #8a5a14; color: #fff; }
    .fab.some.on { background: #4b3a7a; }
    .win {
      position: fixed; right: 66px; bottom: 76px; z-index: 2147483002;
      width: min(520px, calc(100vw - 32px)); max-height: min(78vh, 720px);
      display: flex; flex-direction: column;
      background: #26262e; color: #e8e8ee; border: 1px solid #3a3a46;
      border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,.6); overflow: hidden;
    }
    .win[hidden] { display: none; }
    header {
      display: flex; align-items: center; gap: 8px; padding: 12px 14px 8px 16px;
      border-bottom: 1px solid #30303c;
    }
    header h1 { margin: 0; flex: 1; font-size: 15px; font-weight: 600; min-width: 0; }
    header button, .bar button, .row button {
      border: 1px solid #4a4a58; background: transparent; color: #dcdce6;
      font-size: 12px; cursor: pointer; padding: 3px 9px; border-radius: 7px;
    }
    header button:hover, .bar button:hover, .row button:hover { background: #32323e; color: #fff; }
    header .x { border: none; font-size: 16px; padding: 2px 6px; color: #a3a3b4; }
    .sub { padding: 8px 16px 6px; font-size: 12px; color: #a9a9b8; line-height: 1.45; }
    .sub label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; color: #dcdce6; }
    .body { overflow: auto; padding: 0 16px 12px; flex: 1; min-height: 0; }
    h2 {
      margin: 12px 0 4px; font-size: 12.5px; font-weight: 600; color: #e0b94a;
      display: flex; gap: 8px; align-items: baseline; overflow-wrap: anywhere;
    }
    h2 .n { color: #8f8fa0; font-weight: 400; }
    .row {
      display: flex; align-items: center; gap: 8px; padding: 5px 6px; border-radius: 8px;
      font-size: 12.5px; line-height: 1.35; cursor: pointer; border: 1px solid transparent;
    }
    .row:hover, .row:focus-visible { background: #2f2f3a; border-color: #3d3d4b; outline: none; }
    .row .turn { flex: 0 0 auto; color: #c9c9d6; font-variant-numeric: tabular-nums; min-width: 44px; }
    .row .when { flex: 0 0 auto; color: #8f8fa0; font-size: 11.5px; }
    .row .args {
      flex: 1; min-width: 0; color: #a9a9b8; font-size: 11.5px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .row .off { flex: 0 0 auto; color: #8f8fa0; font-size: 11px; border: 1px solid #4a4a58; border-radius: 6px; padding: 0 5px; }
    .empty { padding: 26px 8px; text-align: center; color: #8f8fa0; font-size: 13px; line-height: 1.5; }
    .bar { display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-bottom: 1px solid #30303c; flex-wrap: wrap; }
    .bar .grow { flex: 1; }
    .src { padding: 8px 16px 0; font-size: 12px; line-height: 1.45; color: #a9a9b8; }
    .src.warn { color: #e0b94a; }
    .src b { color: #e8e8ee; font-weight: 600; }
    pre {
      margin: 8px 0 0; padding: 10px 12px; border-radius: 8px; background: #1b1b22;
      border: 1px solid #30303c; color: #dcdce6; font: 12px/1.5 ui-monospace, Consolas, monospace;
      white-space: pre-wrap; overflow-wrap: anywhere;
    }
    .meta { margin: 8px 0 0; font-size: 12px; color: #a9a9b8; line-height: 1.45; overflow-wrap: anywhere; }
    .meta b { color: #dcdce6; font-weight: 600; }
  `;

  let host = null;
  let shadow = null;
  let fab = null;
  let win = null;
  let listPane = null;
  let textPane = null;

  /** State for the conversation on screen. */
  let convId = null;
  /** Every `skill` call in the conversation, all branches. */
  let calls = [];
  /** messageId -> depth (0 = first message), for the turn number of off-branch calls. */
  let depthOf = new Map();
  let displayedSig = '';
  let wasStreaming = false;
  let refreshTimer = null;
  let fetchSeq = 0;
  let allBranches = false;
  let loadError = '';

  // ------------------------------------------------------------------ data

  function parseArgs(raw) {
    if (raw && typeof raw === 'object') return raw;
    try {
      return JSON.parse(raw || '{}') || {};
    } catch {
      return {};
    }
  }

  /** All `skill` tool calls in a flat message list, in message order. */
  function findCalls(messages) {
    const out = [];
    for (const m of messages) {
      if (!Array.isArray(m.content)) continue;
      for (const part of m.content) {
        const tc = part && part.type === 'tool_call' ? part.tool_call : null;
        if (!tc || tc.name !== TOOL_NAME) continue;
        const args = parseArgs(tc.args);
        out.push({
          messageId: m.messageId,
          toolId: tc.id || '',
          inserted: typeof tc.id === 'string' && tc.id.startsWith(INSERTED_PREFIX),
          skill: String(args.skillName || args.skill || args.name || '(unnamed)'),
          args: args.args === undefined || args.args === null ? '' : String(args.args),
          result: typeof tc.output === 'string' ? tc.output : '',
          at: m.createdAt || '',
        });
      }
    }
    return out;
  }

  function displayedIds() {
    return adapter.getDisplayedMessages().map((d) => d.id);
  }

  function isStreaming() {
    return !!document.querySelector('button[aria-label="Stop generating"]');
  }

  async function load(conv) {
    const seq = ++fetchSeq;
    try {
      const messages = await api.fetchMessages(conv);
      if (seq !== fetchSeq || conv !== adapter.getConversationId()) return;
      const { parentKeyOf } = api.buildIndex(messages);
      const depths = new Map();
      for (const m of messages) depths.set(m.messageId, api.computePath(parentKeyOf, m.messageId).length - 1);
      calls = findCalls(messages);
      depthOf = depths;
      loadError = '';
    } catch (err) {
      if (seq !== fetchSeq) return;
      loadError = err.message || String(err);
    }
    paint();
  }

  function scheduleLoad(delay = REFRESH_DELAY_MS) {
    clearTimeout(refreshTimer);
    const conv = convId;
    if (!conv) return;
    refreshTimer = setTimeout(() => load(conv), delay);
  }

  /** Called on every route check (main.js). */
  function onRoute() {
    init();
    const conv = adapter.getConversationId();
    if (conv === convId) return;
    convId = conv;
    calls = [];
    depthOf = new Map();
    displayedSig = '';
    loadError = '';
    fetchSeq++;
    showList();
    paint();
    /** not at once: the app and the pills refresh their login right at page load */
    if (conv) scheduleLoad(1500);
  }

  /** Called (debounced) whenever the chat's DOM changed (main.js). */
  function onDomChanged() {
    if (!convId) return;
    const sig = displayedIds().join(',');
    const streaming = isStreaming();
    const finished = wasStreaming && !streaming;
    wasStreaming = streaming;
    if (sig !== displayedSig) {
      displayedSig = sig;
      /** A branch switch needs no fetch, only a recount; a new id does. */
      if (displayedIds().some((id) => !depthOf.has(id))) scheduleLoad();
      paint();
    }
    /** The reply's tool calls are saved when it ends. */
    if (finished) scheduleLoad();
  }

  function onBranch() {
    const shown = new Set(displayedIds());
    return calls.filter((c) => shown.has(c.messageId));
  }

  // -------------------------------------------------------------------- UI

  function init() {
    if (host) return;
    document.getElementById('lcbm-skillcalls-host')?.remove();
    host = document.createElement('div');
    host.id = 'lcbm-skillcalls-host';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${CSS}</style>
      <button class="fab" hidden></button>
      <div class="win" role="dialog" aria-label="Skill tool calls" hidden>
        <div class="list" style="display:flex;flex-direction:column;min-height:0;flex:1">
          <header><h1>Skill tool calls</h1><button class="x" title="Close (Esc)">&#10005;</button></header>
          <div class="sub"></div>
          <div class="body"></div>
        </div>
        <div class="text" style="display:none;flex-direction:column;min-height:0;flex:1">
          <div class="bar"></div>
          <div class="src"></div>
          <div class="body"></div>
        </div>
      </div>`;
    fab = shadow.querySelector('.fab');
    win = shadow.querySelector('.win');
    listPane = shadow.querySelector('.list');
    textPane = shadow.querySelector('.text');
    fab.addEventListener('click', toggle);
    listPane.querySelector('.x').addEventListener('click', close);
    /** Window capture, like the hotkey list: the Esc that closes this window
     *  (or leaves the text view) does nothing else. */
    window.addEventListener('keydown', onKey, true);
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
    showList();
    win.hidden = false;
    fab.classList.add('on');
    paint();
    /** The list should be current when it is looked at. */
    if (convId) scheduleLoad(0);
  }

  function close() {
    if (!win) return;
    win.hidden = true;
    fab.classList.remove('on');
  }

  function onKey(e) {
    if (e.isComposing || !isOpen()) return;
    if (e.key !== 'Escape' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (textPane.style.display !== 'none') showList();
    else close();
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function fmtWhen(iso) {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function showList() {
    if (!listPane) return;
    listPane.style.display = 'flex';
    textPane.style.display = 'none';
  }

  function paint() {
    if (!fab) return;
    const branch = onBranch();
    fab.hidden = !convId;
    fab.textContent = String(branch.length);
    fab.classList.toggle('some', branch.length > 0);
    const label =
      `${branch.length} skill tool call${branch.length === 1 ? '' : 's'} on this branch` +
      (calls.length !== branch.length ? ` (${calls.length} in the whole chat)` : '');
    fab.title = label;
    fab.setAttribute('aria-label', label);
    if (isOpen() && textPane.style.display === 'none') renderList(branch);
  }

  function renderList(branch) {
    const sub = listPane.querySelector('.sub');
    const body = listPane.querySelector('.body');
    const keepScroll = body.scrollTop;
    sub.textContent = '';
    body.textContent = '';

    const shown = allBranches ? calls : branch;
    const line = el('div');
    line.textContent =
      `${branch.length} on the branch you are looking at, ${calls.length} in the whole chat. ` +
      'Skills that are always applied are not counted; these are the times the model loaded a skill itself.';
    sub.appendChild(line);
    const lab = el('label');
    lab.style.marginTop = '6px';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = allBranches;
    box.addEventListener('change', () => {
      allBranches = box.checked;
      paint();
    });
    lab.append(box, document.createTextNode('Show the calls on all branches'));
    sub.appendChild(lab);

    if (loadError) {
      body.appendChild(el('div', 'empty', `Could not read this chat's messages: ${loadError}`));
      return;
    }
    if (!shown.length) {
      body.appendChild(
        el('div', 'empty', allBranches ? 'No skill tool calls in this chat.' : 'No skill tool calls on this branch.'),
      );
      return;
    }

    const onPath = new Set(displayedIds());
    const groups = new Map();
    for (const c of shown) {
      if (!groups.has(c.skill)) groups.set(c.skill, []);
      groups.get(c.skill).push(c);
    }
    for (const [skill, list] of groups) {
      const h = el('h2');
      h.append(el('span', '', skill), el('span', 'n', `${list.length} call${list.length === 1 ? '' : 's'}`));
      body.appendChild(h);
      for (const c of list) {
        const row = el('div', 'row');
        row.tabIndex = 0;
        row.title = 'Go to this reply';
        const depth = depthOf.get(c.messageId);
        row.appendChild(el('span', 'turn', depth === undefined ? '#?' : `#${depth + 1}`));
        row.appendChild(el('span', 'when', fmtWhen(c.at)));
        row.appendChild(el('span', 'args', c.args ? c.args.replace(/\s+/g, ' ') : ''));
        if (c.args) row.lastChild.title = c.args;
        if (c.inserted) row.appendChild(el('span', 'off', 'inserted'));
        if (!onPath.has(c.messageId)) row.appendChild(el('span', 'off', 'other branch'));
        const btn = el('button', '', 'Text');
        btn.title = 'Show the text this call put into the prompt';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          showText(c);
        });
        row.appendChild(btn);
        const go = () => jump(c);
        row.addEventListener('click', go);
        row.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            go();
          }
        });
        body.appendChild(row);
      }
    }
    body.scrollTop = keepScroll;
  }

  async function jump(c) {
    const conv = convId;
    if (!conv) return;
    try {
      await LCBM.navigate.jumpToMessage(conv, c.messageId, (text) => {
        if (text) LCBM.ui.toast(text, { sticky: true });
      });
      LCBM.ui.toast(`Skill call: ${c.skill}`);
    } catch (err) {
      LCBM.ui.toast(err.message || String(err), { error: true });
    }
  }

  // ------------------------------------------------------------- text view

  async function recordedText(c) {
    if (!INSPECTOR) return { found: false, reason: 'no-inspector' };
    try {
      const q = new URLSearchParams({ msg: c.messageId, tool: c.toolId, skill: c.skill });
      const r = await fetch(`${INSPECTOR}/inspector/skill-call?${q}`, { cache: 'no-store' });
      if (!r.ok) return { found: false, reason: `inspector answered ${r.status}` };
      return await r.json();
    } catch {
      return { found: false, reason: 'inspector-off' };
    }
  }

  /** The skill as it is now, by name. Needs its own token: api.js only GETs JSON lists. */
  async function currentBody(name) {
    const token = await api.refreshToken();
    const get = async (url) => {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    };
    let cursor = '';
    for (let page = 0; page < 20; page++) {
      const j = await get(`/api/skills?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      const hit = (j.skills || []).find((s) => s.name === name);
      if (hit) {
        const full = await get(`/api/skills/${encodeURIComponent(hit._id || hit.id)}`);
        return { body: full.body || '', version: full.version, updatedAt: full.updatedAt };
      }
      if (!j.has_more || !j.after) break;
      cursor = j.after;
    }
    return null;
  }

  async function showText(c) {
    listPane.style.display = 'none';
    textPane.style.display = 'flex';
    const bar = textPane.querySelector('.bar');
    const src = textPane.querySelector('.src');
    const body = textPane.querySelector('.body');
    bar.textContent = '';
    body.textContent = '';
    src.className = 'src';
    src.textContent = 'Looking up the recorded prompt…';

    const back = el('button', '', '← Back');
    back.title = 'Back to the list (Esc)';
    back.addEventListener('click', showList);
    const title = el('span', 'grow');
    const depth = depthOf.get(c.messageId);
    title.textContent = `${c.skill} · ${depth === undefined ? '' : `#${depth + 1} · `}${fmtWhen(c.at)}`;
    title.style.cssText = 'font-size:13px;font-weight:600;min-width:0;overflow-wrap:anywhere';
    const goBtn = el('button', '', 'Go to reply');
    goBtn.addEventListener('click', () => jump(c));
    const copy = el('button', '', 'Copy');
    copy.disabled = true;
    bar.append(back, title, goBtn, copy);

    let text = '';
    /** An inserted call keeps its text in the chat; nothing to look up. */
    const rec = c.inserted
      ? { found: true, inserted: true, text: c.result }
      : await recordedText(c);
    /** The user may have left this view, or opened another call, meanwhile. */
    if (textPane.style.display === 'none' || !title.isConnected) return;

    if (rec.inserted) {
      text = rec.text || '';
      src.textContent = '';
      src.append(
        el('b', '', 'Stored in the chat. '),
        document.createTextNode(
          'You inserted this call by hand. Its tool result holds this text, and the model reads it at this point on every later turn.',
        ),
      );
    } else if (rec.found) {
      text = rec.text || '';
      src.textContent = '';
      src.append(
        el('b', '', 'Exactly as sent. '),
        document.createTextNode(
          `From the recorded prompt of ${fmtWhen(rec.at)}, the request made right after this call.` +
            (rec.exact ? '' : ' No text there carried this skill\'s name line, so this is the last text after the call.'),
        ),
      );
      const link = el('button', '', 'Whole prompt');
      link.title = 'Open the recorded prompt of this reply in the Prompt Inspector';
      link.addEventListener('click', () => {
        window.open(`${INSPECTOR}/#msg=${encodeURIComponent(c.messageId)}`, 'lc-prompt-inspector');
      });
      bar.insertBefore(link, copy);
    } else {
      src.className = 'src warn';
      const why =
        rec.reason === 'no-inspector'
          ? 'LibreChat keeps the call but not the text it loaded'
          : rec.reason === 'inspector-off'
          ? 'The Prompt Inspector is not running'
          : rec.reason === 'no-capture'
            ? 'No prompt was recorded for this reply'
            : 'The recorded prompts of this reply do not hold the text';
      src.textContent = `${why}. Looking up the skill as it is now…`;
      let now = null;
      let failed = '';
      try {
        now = await currentBody(c.skill);
      } catch (err) {
        failed = err.message || String(err);
      }
      if (textPane.style.display === 'none' || !title.isConnected) return;
      if (now) {
        text = now.body;
        src.textContent =
          `${why}, so this is the skill as it is NOW (version ${now.version}` +
          `${now.updatedAt ? `, saved ${fmtWhen(now.updatedAt)}` : ''}). ` +
          'It may differ from what the model got at the time' +
          (LCBM.config && LCBM.config.skillHistory ? '; the skill\'s History in the editor has the older versions.' : '.');
      } else {
        src.textContent = `${why}, and no skill named "${c.skill}" exists now${failed ? ` (${failed})` : ''}.`;
      }
    }

    const meta = el('div', 'meta');
    meta.append(el('b', '', 'Call: '), document.createTextNode(`skill("${c.skill}")`));
    if (c.args) meta.append(document.createElement('br'), el('b', '', 'Arguments: '), document.createTextNode(c.args));
    if (c.result && !c.inserted) meta.append(document.createElement('br'), el('b', '', 'Tool result kept in the chat: '), document.createTextNode(c.result));
    body.appendChild(meta);
    if (text) {
      body.appendChild(el('pre', '', text));
      copy.disabled = false;
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(text);
          copy.textContent = 'Copied';
        } catch {
          copy.textContent = 'Copy failed';
        }
        setTimeout(() => (copy.textContent = 'Copy'), 1500);
      });
    }
  }

  LCBM.skillCalls = { init, onRoute, onDomChanged, open, close, toggle, isOpen, findCalls };
})();

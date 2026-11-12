/**
 * ST-EXPORT — save the currently displayed branch as a SillyTavern chat.
 *
 * A 💾 button (below the bookmarks one) opens a small dialog: name the log,
 * confirm the persona/character names, save. The extension walks the branch
 * you are LOOKING AT (the displayed root->leaf path), pulls the RAW message
 * text from LibreChat's API (the DOM only has rendered markdown), builds a
 * SillyTavern .jsonl, and hands it to the browser as a download (import it in
 * SillyTavern under Chat History). In a build with `config.stSaveEndpoint`
 * it is POSTed there instead, to a local server that writes the file.
 *
 * The .jsonl format, proven to import cleanly into SillyTavern:
 *   - header {user_name, character_name, create_date, chat_metadata}
 *   - messages {name, is_user, is_system, send_date, mes, extra}
 *   - assistant messages additionally carry swipes/swipe_id/swipe_info
 *   - timestamps are NOW-based, +1s per message (ST sorts Chat History by
 *     last-message date; old stamps bury the chat)
 *   - LF-only, trailing newline (CRLF silently breaks ST's import)
 */
(() => {
  'use strict';

  const LCBM = (window.LCBM = window.LCBM || {});
  const { adapter, storage } = LCBM;

  const cfg = LCBM.config || {};
  const SAVE_ENDPOINT = cfg.stSaveEndpoint || '';
  const DEFAULT_USER = cfg.stDefaultUser || 'User';
  const DEFAULT_CHAR = cfg.stDefaultChar || 'Assistant';
  /** A renamed persona: its old name, saved by earlier versions, would point at an ST folder that no longer exists. */
  const renamedChar = (v) =>
    typeof v !== 'string'
      ? v
      : (cfg.stRenames || []).reduce(
          (text, [from, to]) =>
            text.replace(new RegExp(from, 'gi'), (m) =>
              m === m.toUpperCase() ? to.toUpperCase() : m[0] === m[0].toUpperCase() ? to : to.toLowerCase(),
            ),
          v,
        );

  /** A file name the operating system takes. */
  const safeName = (name) => name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'chat';

  function download(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/x-ndjson' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  let shadow = null;
  let dialogEl = null;

  const toast = (msg, opts) => LCBM.ui && LCBM.ui.toast && LCBM.ui.toast(msg, opts);

  // ------------------------------------------------------------- jsonl build

  /** ISO stamp with .000Z, matching the python script's strftime format. */
  function stamp(base, offsetSeconds) {
    return new Date(base + offsetSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, '.000Z');
  }

  /**
   * Raw prose of a message. Content text-parts are preferred (they can never
   * contain thinking); `text` is the fallback. Think/tool parts are excluded —
   * a SillyTavern log wants the story, not the reasoning.
   */
  function rawText(m) {
    if (Array.isArray(m.content)) {
      const joined = m.content
        .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text)
        .join('\n\n')
        .trim();
      if (joined) return joined;
    }
    return (m.text || '').trim();
  }

  /** Build the .jsonl string. Returns {jsonl, count, skipped}. */
  function buildJsonl(messagesInOrder, userName, charName) {
    const base = Date.now();
    const rows = [];
    rows.push(
      JSON.stringify({
        user_name: userName,
        character_name: charName,
        create_date: stamp(base, 0),
        chat_metadata: { note_interval: 1, note_position: 0, note_depth: 4, note_role: 0 },
      }),
    );

    let i = 0;
    let skipped = 0;
    for (const m of messagesInOrder) {
      const text = rawText(m);
      if (!text) {
        skipped++;
        continue;
      }
      i++;
      const isUser = !!m.isCreatedByUser;
      const row = {
        name: isUser ? userName : charName,
        is_user: isUser,
        is_system: false,
        send_date: stamp(base, i),
        mes: text,
        extra: {},
      };
      if (!isUser) {
        row.swipes = [text];
        row.swipe_id = 0;
        row.swipe_info = [{ send_date: stamp(base, i), extra: {} }];
      }
      rows.push(JSON.stringify(row));
    }
    return { jsonl: rows.join('\n') + '\n', count: i, skipped };
  }

  // ------------------------------------------------------------------ export

  async function runExport(logName, userName, charName, installST) {
    const convoId = adapter.getConversationId();
    if (!convoId) throw new Error('Open a conversation first.');

    const displayed = adapter.getDisplayedMessages();
    if (!displayed.length) throw new Error('No messages on screen.');

    const msgs = await LCBM.api.fetchMessages(convoId);
    const byId = new Map(msgs.map((m) => [m.messageId, m]));

    const ordered = [];
    for (const { id } of displayed) {
      const m = byId.get(id);
      if (m) ordered.push(m);
    }
    if (!ordered.length) {
      throw new Error('Displayed messages not found via API — refresh and retry.');
    }

    const { jsonl, count, skipped } = buildJsonl(ordered, userName, charName);
    if (!count) throw new Error('Branch has no message text to export.');

    if (!SAVE_ENDPOINT) {
      download(`${safeName(logName)}.jsonl`, jsonl);
      return { downloaded: true, count, skipped };
    }

    let res;
    try {
      res = await fetch(SAVE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: logName, jsonl, installST, charName }),
      });
    } catch {
      throw new Error(`The save server is not reachable (it writes the file): ${SAVE_ENDPOINT}`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `Save failed (HTTP ${res.status}).`);
    return { ...data, count, skipped };
  }

  // --------------------------------------------------------------------- UI

  function ensureUI() {
    if (shadow) return;
    const host = document.createElement('div');
    host.id = 'lcbm-st-host';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; font-family: system-ui, sans-serif; }
      .fab {
        position: fixed; right: 18px; bottom: 124px; z-index: 2147483000;
        width: 40px; height: 40px; border-radius: 50%;
        background: #3a5a4a; color: #fff; border: none; cursor: pointer;
        font-size: 17px; line-height: 40px; text-align: center;
        box-shadow: 0 2px 10px rgba(0,0,0,.4); opacity: .85; display: none;
      }
      .fab:hover { opacity: 1; }
      .fab.show { display: block; }
      .overlay {
        position: fixed; inset: 0; z-index: 2147483001; display: none;
        background: rgba(0,0,0,.45);
      }
      .overlay.open { display: block; }
      .dlg {
        position: fixed; left: 50%; top: 50%; transform: translate(-50%,-50%);
        width: min(480px, 92vw); background: #26262e; color: #e8e8ee;
        border: 1px solid #3a3a46; border-radius: 14px;
        box-shadow: 0 10px 40px rgba(0,0,0,.6); padding: 20px 24px;
      }
      .dlg h1 { margin: 0 0 4px; font-size: 17px; font-weight: 600; }
      .dlg .sub { color: #9a9aa8; font-size: 12px; margin-bottom: 14px; }
      .dlg label { display: block; font-size: 12px; color: #bfbfcc; margin: 10px 0 4px; }
      .dlg input {
        width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid #4a4a58;
        background: #1b1b22; color: #e8e8ee; font-size: 13.5px; outline: none;
      }
      .dlg input:focus { border-color: #6b5aa0; }
      .row2 { display: flex; gap: 10px; }
      .row2 > div { flex: 1; }
      .chk {
        display: flex; align-items: center; gap: 8px; margin-top: 14px;
        font-size: 12.5px; color: #cfcfda; cursor: pointer; user-select: none;
      }
      .chk input { width: 15px; height: 15px; accent-color: #3a5a4a; cursor: pointer; }
      .chk-sub { font-size: 11px; color: #8a8a98; margin: 3px 0 0 23px; }
      .actions { display: flex; gap: 10px; margin-top: 18px; }
      .actions button {
        flex: 1; padding: 9px 0; font-size: 13.5px; border-radius: 8px; cursor: pointer;
        border: 1px solid #4a4a58; background: #2c2c37; color: #cfcfda;
      }
      .actions .save { background: #3a5a4a; color: #fff; border-color: #4a6a5a; font-weight: 600; }
      .actions button:hover { filter: brightness(1.15); }
      .actions button:disabled { opacity: .5; cursor: wait; }
    `;
    shadow.appendChild(style);

    const fab = document.createElement('button');
    fab.className = 'fab';
    fab.title = 'Save this branch as a SillyTavern chat';
    fab.textContent = '💾';
    fab.addEventListener('click', openDialog);
    shadow.appendChild(fab);

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="dlg">
        <h1>Save branch for SillyTavern</h1>
        <div class="sub">Exports the branch as displayed right now (<span class="count">0</span> messages)
          <span class="where"></span></div>
        <label>Log name (becomes the filename)</label>
        <input type="text" class="logname" placeholder="e.g. Chapter 3, second route">
        <div class="row2">
          <div>
            <label>Your persona name</label>
            <input type="text" class="username">
          </div>
          <div>
            <label>Character name</label>
            <input type="text" class="charname">
          </div>
        </div>
        <div class="direct">
          <label class="chk">
            <input type="checkbox" class="install" checked>
            Also add to SillyTavern's Chat History under this name
          </label>
          <div class="chk-sub">Writes directly into ST's chats folder — no Import button, no
            “<character> - date imported” rename. ST shows the filename as the chat name.</div>
        </div>
        <div class="actions">
          <button class="save">Save</button>
          <button class="cancel">Cancel</button>
        </div>
      </div>`;
    shadow.appendChild(overlay);
    dialogEl = overlay;
    overlay.querySelector('.where').textContent = SAVE_ENDPOINT
      ? `into “${cfg.stSaveFolder || 'the save server\'s folder'}”.`
      : 'as a .jsonl file to import in SillyTavern (Chat History, Import).';
    /** Writing straight into SillyTavern's folder is the save server's doing. */
    if (!SAVE_ENDPOINT) overlay.querySelector('.direct').remove();

    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) closeDialog();
    });
    overlay.querySelector('.cancel').addEventListener('click', closeDialog);
    overlay.querySelector('.save').addEventListener('click', onSave);
    overlay.querySelector('.logname').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') onSave();
      else if (e.key === 'Escape') closeDialog();
    });

    /** Show the button only on conversation pages. */
    setInterval(() => {
      fab.classList.toggle('show', adapter.isChatPage());
    }, 700);
  }

  async function openDialog() {
    ensureUI();
    const displayed = adapter.getDisplayedMessages();
    dialogEl.querySelector('.count').textContent = String(displayed.length);

    const nameInput = dialogEl.querySelector('.logname');
    /** LibreChat puts the conversation title in document.title. */
    const title = (document.title || '').trim();
    if (!nameInput.value && title && title.toLowerCase() !== 'librechat') {
      nameInput.value = title;
    }
    dialogEl.querySelector('.username').value = await storage.getOption('stUserName', DEFAULT_USER);
    dialogEl.querySelector('.charname').value = renamedChar(await storage.getOption('stCharName', DEFAULT_CHAR));
    const installBox = dialogEl.querySelector('.install');
    if (installBox) installBox.checked = await storage.getOption('stInstall', true);

    dialogEl.classList.add('open');
    nameInput.focus();
    nameInput.select();
  }

  function closeDialog() {
    dialogEl && dialogEl.classList.remove('open');
  }

  async function onSave() {
    const logName = dialogEl.querySelector('.logname').value.trim();
    const userName = dialogEl.querySelector('.username').value.trim() || DEFAULT_USER;
    const charName = dialogEl.querySelector('.charname').value.trim() || DEFAULT_CHAR;
    if (!logName) {
      toast('Give the log a name first.', { error: true });
      return;
    }
    const installBox = dialogEl.querySelector('.install');
    const installST = !!installBox && installBox.checked;
    const saveBtn = dialogEl.querySelector('.save');
    saveBtn.disabled = true;
    try {
      await storage.setOption('stUserName', userName);
      await storage.setOption('stCharName', charName);
      if (installBox) await storage.setOption('stInstall', installST);
      const result = await runExport(logName, userName, charName, installST);
      closeDialog();
      const skippedNote = result.skipped ? ` (${result.skipped} empty skipped)` : '';
      if (result.downloaded) {
        toast(`Downloaded ${result.count} messages${skippedNote} as “${safeName(logName)}.jsonl”.`);
      } else if (result.stWarning) {
        toast(result.stWarning, { error: true });
      } else if (result.stPath) {
        toast(`Saved ${result.count} messages${skippedNote} — now in ST's Chat History as “${logName}”.`);
      } else {
        toast(`Saved ${result.count} messages${skippedNote} → ${result.path}`);
      }
    } catch (err) {
      toast(err.message, { error: true });
    } finally {
      saveBtn.disabled = false;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureUI);
  } else {
    ensureUI();
  }

  LCBM.stExport = { buildJsonl, rawText };
})();

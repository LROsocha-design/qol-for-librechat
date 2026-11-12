/**
 * UI — bookmark buttons on messages, the QoL-style Navigation modal, toasts.
 *
 * The modal mirrors Claude QoL's navigator: bookmarks render as a TREE, where
 * bookmark B nests under bookmark A when A's message is an ancestor of B's in
 * the conversation tree (deepest bookmarked ancestor wins). "Root" is the
 * conversation start; "Go to Latest" jumps to the newest message, "Go to
 * Longest" to the deepest leaf.
 *
 * Modal + toasts live in a shadow root so LibreChat styles can't leak in.
 * The per-message 🔖 button lives in the page DOM to inherit hover behavior.
 */
(() => {
  'use strict';

  const LCBM = (window.LCBM = window.LCBM || {});
  const { adapter, storage, navigate } = LCBM;

  const BTN_CLASS = 'lcbm-add';
  let shadow = null;
  let modalEl = null;
  let toastEl = null;
  let toastTimer = null;

  /** Message-tree cache so reopening the modal doesn't refetch 3.5k messages. */
  let treeCache = { convoId: null, at: 0, msgs: null, index: null, orderIdx: null };
  const TREE_TTL_MS = 45_000;

  async function getTree(convoId) {
    const now = Date.now();
    if (treeCache.convoId === convoId && now - treeCache.at < TREE_TTL_MS) return treeCache;
    const msgs = await LCBM.api.fetchMessages(convoId);
    const index = LCBM.api.buildIndex(msgs);
    const orderIdx = new Map(msgs.map((m, i) => [m.messageId, i]));
    treeCache = { convoId, at: now, msgs, index, orderIdx };
    return treeCache;
  }

  // ---------------------------------------------------------------- shadow UI

  function ensureShadowUI() {
    if (shadow) return;
    const host = document.createElement('div');
    host.id = 'lcbm-host';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; font-family: system-ui, sans-serif; }
      .fab {
        position: fixed; right: 18px; bottom: 76px; z-index: 2147483000;
        width: 40px; height: 40px; border-radius: 50%;
        background: #4b3a7a; color: #fff; border: none; cursor: pointer;
        font-size: 18px; line-height: 40px; text-align: center;
        box-shadow: 0 2px 10px rgba(0,0,0,.4); opacity: .85;
      }
      .fab:hover { opacity: 1; }
      .fab .badge {
        position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px;
        border-radius: 9px; background: #c9a227; color: #1a1a1a;
        font-size: 11px; font-weight: 700; line-height: 18px; padding: 0 4px;
      }
      .overlay {
        position: fixed; inset: 0; z-index: 2147483001; display: none;
        background: rgba(0,0,0,.45);
      }
      .overlay.open { display: block; }
      .modal {
        position: fixed; left: 50%; top: 50%; transform: translate(-50%,-50%);
        width: min(880px, 94vw); max-height: 84vh;
        display: flex; flex-direction: column;
        background: #26262e; color: #e8e8ee; border: 1px solid #3a3a46;
        border-radius: 14px; box-shadow: 0 10px 40px rgba(0,0,0,.6);
        overflow: hidden;
      }
      .modal h1 {
        margin: 0; padding: 20px 26px 12px; font-size: 22px; font-weight: 600;
      }
      .gotos { display: flex; gap: 14px; padding: 4px 26px 14px; }
      .gotos button {
        flex: 1; padding: 10px 0; font-size: 14px; border-radius: 8px; cursor: pointer;
        border: 1px solid #4a4a58; background: transparent; color: #dcdce6;
      }
      .gotos button:hover { background: #32323e; }
      .opt {
        display: flex; align-items: center; gap: 9px; padding: 0 26px 12px;
        font-size: 12.5px; color: #bfbfcc; cursor: pointer; user-select: none;
      }
      .opt input { width: 15px; height: 15px; accent-color: #6b5aa0; cursor: pointer; }
      .filter { padding: 0 26px 10px; }
      .filter input {
        width: 100%; padding: 7px 10px; border-radius: 8px; border: 1px solid #3f3f4c;
        background: #1d1d24; color: #e8e8ee; font-size: 13px; outline: none;
      }
      .tree {
        overflow: auto; flex: 1; padding: 4px 26px 18px; min-height: 120px;
      }
      .node { position: relative; margin: 10px 0; white-space: nowrap; }
      .children {
        margin-left: 30px; padding-left: 26px; border-left: 2px solid #4a4a55;
      }
      .chip {
        display: inline-flex; align-items: center; gap: 9px; max-width: 100%;
        background: #34343f; border: 1px solid #414150; border-radius: 9px;
        padding: 8px 12px; cursor: pointer; position: relative;
      }
      .children .chip::before {
        content: ''; position: absolute; left: -28px; top: 50%; width: 26px;
        border-top: 2px solid #4a4a55;
      }
      .chip:hover { background: #3d3d4a; }
      .chip .pin { font-size: 14px; flex: none; }
      .chip .label {
        font-size: 14px; overflow: hidden; text-overflow: ellipsis; max-width: 46ch;
      }
      .chip .x {
        border: none; background: none; color: #9a9aa8; cursor: pointer;
        font-size: 13px; padding: 1px 4px; border-radius: 4px; flex: none;
      }
      .chip .x:hover { color: #ff8484; background: rgba(255,80,80,.12); }
      .chip.dim { opacity: .45; }
      .chip.stale { opacity: .5; border-style: dashed; cursor: not-allowed; }
      .empty { padding: 26px; font-size: 13px; opacity: .55; text-align: center; }
      .modal footer {
        display: flex; gap: 10px; padding: 12px 26px 16px; border-top: 1px solid #3a3a46;
        align-items: center;
      }
      .modal footer .spacer { flex: 1; }
      .modal footer button {
        padding: 8px 22px; font-size: 13.5px; border-radius: 8px; cursor: pointer;
        border: 1px solid #4a4a58; background: #2c2c37; color: #cfcfda;
      }
      .modal footer button:hover { background: #383846; }
      .modal footer .close { background: #3a3a48; font-weight: 600; }
      .toast {
        position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
        z-index: 2147483003; max-width: 60vw; padding: 8px 14px; border-radius: 8px;
        background: #1b1b22; color: #e8e8ee; border: 1px solid #4a4a58;
        font-size: 12.5px; box-shadow: 0 4px 16px rgba(0,0,0,.5); display: none;
      }
      .toast.error { border-color: #a05050; color: #f0c0c0; }
      .toast.show { display: block; }
      .popover {
        position: fixed; z-index: 2147483002; width: 300px; padding: 10px;
        background: #23232b; color: #e8e8ee; border: 1px solid #4a4a58;
        border-radius: 8px; box-shadow: 0 6px 24px rgba(0,0,0,.5);
      }
      .popover input {
        width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid #4a4a58;
        background: #1b1b22; color: #e8e8ee; font-size: 12.5px; outline: none;
      }
      .popover .actions { display: flex; gap: 6px; margin-top: 8px; }
      .popover .actions button {
        flex: 1; padding: 5px 0; font-size: 12px; border-radius: 6px; cursor: pointer;
        border: 1px solid #4a4a58; background: #2c2c37; color: #cfcfda;
      }
      .popover .actions .save { background: #4b3a7a; color: #fff; border-color: #5b4a8a; }
      .popover .actions .remove { color: #e88; }
    `;
    shadow.appendChild(style);

    const fab = document.createElement('button');
    fab.className = 'fab';
    fab.title = 'Bookmarks (Alt+B)';
    fab.innerHTML = '&#128278;<span class="badge" style="display:none">0</span>';
    fab.addEventListener('click', toggleModal);
    shadow.appendChild(fab);

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-label="Bookmark navigation">
        <h1>Navigation</h1>
        <div class="gotos">
          <button class="latest">Go to Latest</button>
          <button class="longest">Go to Longest</button>
          <button class="branch-tree" title="Every branch of this chat as a tree (Alt+T)">Branch tree</button>
        </div>
        <label class="opt">
          <input type="checkbox" class="autojump">
          Jump to the newest message when opening a chat
        </label>
        <div class="filter"><input type="text" placeholder="Filter bookmarks…"></div>
        <div class="tree"></div>
        <footer>
          <button class="exp">Export all</button>
          <button class="imp">Import</button>
          <span class="spacer"></span>
          <button class="close">Close</button>
        </footer>
      </div>`;
    shadow.appendChild(overlay);
    modalEl = overlay;

    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) closeModal();
    });
    overlay.querySelector('.close').addEventListener('click', closeModal);
    overlay.querySelector('.exp').addEventListener('click', doExport);
    overlay.querySelector('.imp').addEventListener('click', doImport);
    overlay.querySelector('.filter input').addEventListener('input', () => renderList());
    overlay.querySelector('.latest').addEventListener('click', () => gotoSpecial('latest'));
    overlay.querySelector('.longest').addEventListener('click', () => gotoSpecial('longest'));
    overlay.querySelector('.branch-tree').addEventListener('click', () => {
      closeModal();
      LCBM.treeView.open();
    });

    const autojumpBox = overlay.querySelector('.autojump');
    storage.getOption('autoJumpLatest', true).then((v) => {
      autojumpBox.checked = !!v;
    });
    autojumpBox.addEventListener('change', () => {
      storage.setOption('autoJumpLatest', autojumpBox.checked);
    });

    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    shadow.appendChild(toastEl);

    document.addEventListener('keydown', (e) => {
      if (e.altKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyB') {
        e.preventDefault();
        toggleModal();
      } else if (e.key === 'Escape' && modalEl.classList.contains('open')) {
        closeModal();
      }
    });
  }

  function toggleModal() {
    ensureShadowUI();
    modalEl.classList.toggle('open');
    if (modalEl.classList.contains('open')) renderList();
  }
  function closeModal() {
    modalEl && modalEl.classList.remove('open');
  }

  function toast(msg, { error = false, sticky = false } = {}) {
    ensureShadowUI();
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.className = `toast show${error ? ' error' : ''}`;
    if (!sticky) toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    toastEl && toastEl.classList.remove('show');
  }

  async function updateBadge() {
    ensureShadowUI();
    const badge = shadow.querySelector('.fab .badge');
    const convoId = adapter.getConversationId();
    const n = convoId ? (await storage.list(convoId)).length : 0;
    badge.textContent = String(n);
    badge.style.display = n > 0 ? '' : 'none';
  }

  // ------------------------------------------------------------ bookmark tree

  /**
   * Condense the message tree to a bookmark tree: each bookmark's parent is
   * the DEEPEST other bookmark whose message strictly precedes it on its path.
   * Bookmarks whose message no longer exists come back in `stale`.
   */
  function buildBookmarkTree(bookmarks, index, orderIdx) {
    const valid = [];
    const stale = [];
    for (const b of bookmarks) (index.byId.has(b.messageId) ? valid : stale).push(b);

    const bmByMsg = new Map();
    for (const b of valid) if (!bmByMsg.has(b.messageId)) bmByMsg.set(b.messageId, b);

    const nodes = new Map(valid.map((b) => [b.id, { bm: b, children: [] }]));
    const roots = [];
    for (const b of valid) {
      const path = LCBM.api.computePath(index.parentKeyOf, b.messageId);
      let parent = null;
      for (let i = path.length - 2; i >= 0; i--) {
        const cand = bmByMsg.get(path[i]);
        if (cand && cand.id !== b.id) {
          parent = cand;
          break;
        }
      }
      if (parent) nodes.get(parent.id).children.push(nodes.get(b.id));
      else roots.push(nodes.get(b.id));
    }
    const byOrder = (a, z) =>
      (orderIdx.get(a.bm.messageId) ?? 0) - (orderIdx.get(z.bm.messageId) ?? 0);
    const sortRec = (arr) => {
      arr.sort(byOrder);
      for (const n of arr) sortRec(n.children);
    };
    sortRec(roots);
    return { roots, stale };
  }

  /** Deepest leaf of the whole conversation (tie -> newest). */
  function longestLeafId(index, orderIdx) {
    let best = null;
    let bestD = -1;
    const stack = (index.childrenOf.get(adapter.NO_PARENT) || []).map((id) => [id, 0]);
    while (stack.length) {
      const [id, d] = stack.pop();
      const kids = index.childrenOf.get(id) || [];
      if (!kids.length) {
        if (d > bestD || (d === bestD && (orderIdx.get(id) ?? 0) > (orderIdx.get(best) ?? 0))) {
          best = id;
          bestD = d;
        }
      } else {
        for (const k of kids) stack.push([k, d + 1]);
      }
    }
    return best;
  }

  async function gotoSpecial(kind) {
    const convoId = adapter.getConversationId();
    if (!convoId) return;
    try {
      const { msgs, index, orderIdx } = await getTree(convoId);
      const targetId =
        kind === 'latest' ? msgs[msgs.length - 1].messageId : longestLeafId(index, orderIdx);
      if (!targetId) return;
      closeModal();
      await navigate.jumpToMessage(convoId, targetId, (s) =>
        s ? toast(s, { sticky: true }) : hideToast(),
      );
      hideToast();
    } catch (err) {
      toast(err.message, { error: true });
    }
  }

  /**
   * Auto-jump to the globally newest message when a conversation opens.
   *
   * Why this exists: LibreChat's default view walks the NEWEST CHILD from the
   * newest root, which is not the same as the newest message by date. A chat
   * whose newest root is a short dead-end branch opens showing that branch,
   * hiding the real conversation behind sibling arrows.
   *
   * Guards: runs once per conversation, only after messages render, bails if
   * the user navigated away meanwhile, and no-ops when the newest message is
   * already on screen (so normal chats never see a jump).
   */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let lastAutoJumpConvo = null;

  async function maybeAutoJump(convoId) {
    if (!convoId || lastAutoJumpConvo === convoId) return;
    lastAutoJumpConvo = convoId;

    if (!(await storage.getOption('autoJumpLatest', true))) return;

    /** Wait for the message list to render (up to ~10s). */
    const t0 = performance.now();
    while (performance.now() - t0 < 10000) {
      if (adapter.getDisplayedMessages().length) break;
      await sleep(200);
    }
    if (!adapter.getDisplayedMessages().length) return;
    if (adapter.getConversationId() !== convoId) return;

    try {
      const { msgs } = await getTree(convoId);
      if (!msgs.length) return;
      const targetId = msgs[msgs.length - 1].messageId;
      /** Already displayed — nothing to do. */
      if (document.getElementById(targetId)) return;
      if (adapter.getConversationId() !== convoId) return;
      await navigate.jumpToMessage(convoId, targetId, (s) =>
        s ? toast(s, { sticky: true }) : hideToast(),
      );
      hideToast();
    } catch {
      /** Auto behavior stays silent on failure — the manual button reports errors. */
      hideToast();
    }
  }

  /**
   * Deep link (deeplink.js): open the chat at the linked message instead of
   * the newest one. Claims this conversation's auto-jump first — the two
   * running together would fight over the same forks.
   */
  async function jumpFromLink(convoId, messageId) {
    lastAutoJumpConvo = convoId;
    try {
      await navigate.jumpToMessage(convoId, messageId, (s) =>
        s ? toast(s, { sticky: true }) : hideToast(),
      );
      hideToast();
      /** LibreChat scrolls a freshly opened chat to the bottom, sometimes
       *  after the jump lands. reveal() is a no-op unless that (or a centered
       *  tall message) left the target's first line off-screen. */
      await sleep(1200);
      const el = document.getElementById(messageId);
      if (el && adapter.getConversationId() === convoId) LCBM.branchKeys.reveal(el);
    } catch (err) {
      toast(err.message, { error: true });
    }
  }

  async function renderList() {
    ensureShadowUI();
    const treeEl = modalEl.querySelector('.tree');
    const q = modalEl.querySelector('.filter input').value.trim().toLowerCase();
    const convoId = adapter.getConversationId();
    if (!convoId) {
      treeEl.innerHTML = '<div class="empty">Open a conversation to see its bookmarks.</div>';
      return;
    }
    const bookmarks = await storage.list(convoId);
    if (!bookmarks.length) {
      treeEl.innerHTML =
        '<div class="empty">No bookmarks yet.<br>Hover a message and click the &#128278; button.</div>';
      return;
    }

    treeEl.innerHTML = '<div class="empty">Loading tree…</div>';
    let tree;
    let orderIdx;
    try {
      const cached = await getTree(convoId);
      orderIdx = cached.orderIdx;
      tree = buildBookmarkTree(bookmarks, cached.index, orderIdx);
    } catch (err) {
      treeEl.innerHTML = `<div class="empty">Could not load the conversation tree:<br>${err.message}</div>`;
      return;
    }

    treeEl.innerHTML = '';

    // Root chip
    const rootNode = document.createElement('div');
    rootNode.className = 'node';
    const rootChip = document.createElement('span');
    rootChip.className = 'chip';
    rootChip.innerHTML = '<span class="pin">&#127795;</span><span class="label">Root</span>';
    rootChip.title = 'Jump to the start of the conversation';
    rootChip.addEventListener('click', async () => {
      const { msgs } = await getTree(convoId);
      closeModal();
      navigate
        .jumpToMessage(convoId, msgs[0].messageId, (s) => (s ? toast(s, { sticky: true }) : hideToast()))
        .then(hideToast)
        .catch((e) => toast(e.message, { error: true }));
    });
    rootNode.appendChild(rootChip);
    treeEl.appendChild(rootNode);

    const matches = (b) =>
      !q || b.name.toLowerCase().includes(q) || (b.snippet || '').toLowerCase().includes(q);

    /** Render node; returns true if it or any descendant matches the filter. */
    const renderNode = (node, parentEl) => {
      const el = document.createElement('div');
      el.className = 'node';
      const chip = document.createElement('span');
      chip.className = 'chip';
      const selfMatch = matches(node.bm);

      const pin = document.createElement('span');
      pin.className = 'pin';
      pin.textContent = '📍';
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = node.bm.name;
      chip.title = node.bm.snippet || node.bm.name;
      const x = document.createElement('button');
      x.className = 'x';
      x.textContent = '✕';
      x.title = 'Remove bookmark';
      x.addEventListener('click', async (e) => {
        e.stopPropagation();
        await storage.remove(convoId, node.bm.id);
        updateBadge();
        refreshButtonStates();
        renderList();
      });
      chip.append(pin, label, x);
      chip.addEventListener('click', () => {
        closeModal();
        navigate
          .jumpToMessage(convoId, node.bm.messageId, (s) =>
            s ? toast(s, { sticky: true }) : hideToast(),
          )
          .then(hideToast)
          .catch((e) => toast(e.message, { error: true }));
      });
      el.appendChild(chip);

      let childMatch = false;
      if (node.children.length) {
        const kids = document.createElement('div');
        kids.className = 'children';
        for (const c of node.children) childMatch = renderNode(c, kids) || childMatch;
        el.appendChild(kids);
      }
      const anyMatch = selfMatch || childMatch;
      if (!anyMatch) return false;
      if (!selfMatch) chip.classList.add('dim');
      parentEl.appendChild(el);
      return true;
    };

    const kidsWrap = document.createElement('div');
    kidsWrap.className = 'children';
    let any = false;
    for (const n of tree.roots) any = renderNode(n, kidsWrap) || any;
    if (kidsWrap.childElementCount) rootNode.appendChild(kidsWrap);
    if (!any && q) treeEl.appendChild(Object.assign(document.createElement('div'), {
      className: 'empty', textContent: 'No bookmarks match the filter.',
    }));

    // Stale bookmarks (message no longer in the conversation)
    for (const b of tree.stale) {
      if (!matches(b)) continue;
      const el = document.createElement('div');
      el.className = 'node';
      const chip = document.createElement('span');
      chip.className = 'chip stale';
      chip.title = 'The bookmarked message no longer exists in this conversation.';
      chip.innerHTML = `<span class="pin">⚠️</span><span class="label">${b.name.replace(/</g, '&lt;')}</span>`;
      const x = document.createElement('button');
      x.className = 'x';
      x.textContent = '✕';
      x.addEventListener('click', async (e) => {
        e.stopPropagation();
        await storage.remove(convoId, b.id);
        updateBadge();
        renderList();
      });
      chip.appendChild(x);
      el.appendChild(chip);
      treeEl.appendChild(el);
    }
  }

  // ------------------------------------------------------------ export/import

  async function doExport() {
    const payload = await storage.exportAll();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `librechat-bookmarks-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function doImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const added = await storage.importAll(JSON.parse(await file.text()));
        toast(`Imported ${added} bookmark${added === 1 ? '' : 's'}.`);
        renderList();
        updateBadge();
        refreshButtonStates();
      } catch (err) {
        toast(err.message, { error: true });
      }
    });
    input.click();
  }

  // ------------------------------------------------------- name popover (page)

  function namePopover(anchorEl, { defaultName, existing }) {
    return new Promise((resolve) => {
      ensureShadowUI();
      const pop = document.createElement('div');
      pop.className = 'popover';
      pop.innerHTML = `
        <input type="text">
        <div class="actions">
          <button class="save">${existing ? 'Rename' : 'Save'}</button>
          ${existing ? '<button class="remove">Remove</button>' : ''}
          <button class="cancel">Cancel</button>
        </div>`;
      shadow.appendChild(pop);
      const rect = anchorEl.getBoundingClientRect();
      pop.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - 316))}px`;
      pop.style.top = `${Math.min(rect.bottom + 6, innerHeight - 120)}px`;

      const input = pop.querySelector('input');
      input.value = defaultName;
      input.focus();
      // Rename: select the old name so typing replaces it. New: caret after
      // the pre-filled date so typing adds the note.
      if (existing) input.select();
      else input.setSelectionRange(defaultName.length, defaultName.length);

      const close = (result) => {
        pop.remove();
        document.removeEventListener('mousedown', onOutside, true);
        resolve(result);
      };
      const onOutside = (e) => {
        if (!pop.contains(e.target)) close(null);
      };
      document.addEventListener('mousedown', onOutside, true);

      pop.querySelector('.save').addEventListener('click', () => {
        const name = input.value.trim();
        if (name) close({ action: 'save', name });
      });
      const rm = pop.querySelector('.remove');
      if (rm) rm.addEventListener('click', () => close({ action: 'remove' }));
      pop.querySelector('.cancel').addEventListener('click', () => close(null));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const name = input.value.trim();
          if (name) close({ action: 'save', name });
        } else if (e.key === 'Escape') {
          close(null);
        }
      });
    });
  }

  // -------------------------------------------------- per-message add buttons

  /** Today's date as DD.MM.YYYY, the start of every new bookmark's name. */
  function todayStamp() {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}.${now.getFullYear()}`;
  }

  async function onAddClick(messageEl, btn) {
    const convoId = adapter.getConversationId();
    if (!convoId) return;
    const existing = await storage.findByMessageId(convoId, messageEl.id);
    const snippet = adapter.getMessageText(messageEl);
    // The message text is still saved as `snippet` (chip tooltip, filter).
    const result = await namePopover(btn, {
      defaultName: existing ? existing.name : todayStamp() + ' ',
      existing: !!existing,
    });
    if (!result) return;
    if (result.action === 'remove' && existing) {
      await storage.remove(convoId, existing.id);
      toast('Bookmark removed.');
    } else if (result.action === 'save') {
      if (existing) {
        await storage.rename(convoId, existing.id, result.name);
        toast('Bookmark renamed.');
      } else {
        await storage.add(convoId, {
          name: result.name,
          messageId: messageEl.id,
          snippet,
          isUser: !!messageEl.querySelector('.user-turn'),
        });
        toast('Bookmark added.');
      }
    }
    updateBadge();
    refreshButtonStates();
    if (modalEl && modalEl.classList.contains('open')) renderList();
  }

  function makeButton(messageEl) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.title = 'Bookmark this message';
    btn.textContent = '\u{1F516}';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onAddClick(messageEl, btn);
    });
    return btn;
  }

  function injectButtons() {
    for (const { el } of adapter.getDisplayedMessages()) {
      /** One per row of buttons: the bottom row and, on AI replies, its copy at the top. */
      for (const bar of adapter.getActionBars(el)) {
        if (!bar.querySelector(`.${BTN_CLASS}`)) bar.appendChild(makeButton(el));
      }
    }
    refreshButtonStates();
  }

  async function refreshButtonStates() {
    const convoId = adapter.getConversationId();
    if (!convoId) return;
    const items = await storage.list(convoId);
    const marked = new Set(items.map((b) => b.messageId));
    for (const { id, el } of adapter.getDisplayedMessages()) {
      const bm = items.find((b) => b.messageId === id);
      for (const btn of el.querySelectorAll(`.${BTN_CLASS}`)) {
        btn.classList.toggle('lcbm-marked', marked.has(id));
        btn.title = bm ? `Bookmarked: ${bm.name}` : 'Bookmark this message';
      }
    }
  }

  LCBM.ui = {
    ensureShadowUI,
    injectButtons,
    refreshButtonStates,
    updateBadge,
    renderList,
    toast,
    maybeAutoJump,
    jumpFromLink,
  };
})();

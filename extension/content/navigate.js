/**
 * NAVIGATE — jump to any bookmarked message, switching branches as needed.
 *
 * The core problem: LibreChat renders only the CURRENT branch path. A bookmark
 * may live on a sibling branch behind any number of "< n/m >" switchers.
 *
 * Algorithm (self-healing loop, no precomputed click plan):
 *   1. Fetch the full message tree from the API; compute root->target path.
 *   2. Read the displayed path from the DOM (.message-render order).
 *   3. Find the first depth where displayed diverges from the target path.
 *   4. That displayed message and the wanted message are siblings; both appear
 *      in the same children array (API order == UI order), so compare indices
 *      and click the switcher once in the right direction.
 *   5. Wait for the DOM to re-render, then repeat from step 2.
 *
 * Re-reading the DOM every iteration matters: LibreChat remembers a sibling
 * choice PER FORK (MultiMessage.tsx), so after one switch the deeper subtree
 * can display any previously-viewed branch. A precomputed click sequence would
 * desync; re-reading converges regardless.
 */
(() => {
  'use strict';

  const LCBM = (window.LCBM = window.LCBM || {});
  const { adapter, api } = LCBM;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Wait until the message displayed at `depth` is no longer `oldId`. */
  async function waitForDepthChange(depth, oldId, timeoutMs) {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      const disp = adapter.getDisplayedMessages();
      if (disp[depth] && disp[depth].id !== oldId) return true;
      await sleep(60);
    }
    return false;
  }

  function flash(el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('lcbm-flash');
    setTimeout(() => el.classList.remove('lcbm-flash'), 2600);
  }

  /**
   * NATIVE BRIDGE — a LibreChat build with the author's chat-search patch
   * (not in stock LibreChat; without it 'absent' is returned) switches branches INSTANTLY by
   * writing the app's sibling-selection state directly, instead of clicking
   * "< n/m >" arrows one step at a time. The patched app advertises this with
   * `<html data-lc-native-jump="1">` (armed only once the conversation's
   * message cache is loaded) and accepts a cancelable CustomEvent; calling
   * preventDefault (dispatchEvent returns false) is its synchronous "handled"
   * ack, and the app then scrolls to the message and flashes its own ring.
   *
   * Returns: 'accepted'    — the app took the jump; nothing left to do.
   *          'rejected'    — bridge armed (cache loaded) but the id is not in
   *                          this conversation: the bookmark is stale.
   *          'unavailable' — no bridge (stock build); use the legacy walker.
   */
  const NATIVE_JUMP_EVENT = 'librechat:jump-to-message';
  async function tryNativeJump(messageId) {
    /** The flag can lag the first paint (React effect + cache load), so give
     *  it a short grace period after messages render before giving up. */
    const deadline = performance.now() + 8000;
    let renderedAt = 0;
    while (performance.now() < deadline) {
      if (document.documentElement.dataset.lcNativeJump === '1') {
        const ev = new CustomEvent(NATIVE_JUMP_EVENT, {
          detail: { messageId },
          cancelable: true,
        });
        return window.dispatchEvent(ev) ? 'rejected' : 'accepted';
      }
      if (!renderedAt && adapter.getDisplayedMessages().length) {
        renderedAt = performance.now();
      }
      if (renderedAt && performance.now() - renderedAt > 1200) {
        return 'unavailable';
      }
      await sleep(120);
    }
    return 'unavailable';
  }

  /**
   * Jump to a message in the current conversation.
   * onStatus(text) is called with human-readable progress.
   */
  async function jumpToMessage(conversationId, messageId, onStatus = () => {}) {
    // Fast path: already on the displayed branch.
    const direct = document.getElementById(messageId);
    if (direct && direct.classList.contains('message-render')) {
      flash(direct);
      return;
    }

    const native = await tryNativeJump(messageId);
    if (native === 'accepted') {
      onStatus('');
      return;
    }
    if (native === 'rejected') {
      throw new Error('Message not found in this conversation — the bookmark may be stale.');
    }

    onStatus('Loading conversation tree…');
    const messages = await api.fetchMessages(conversationId);
    const { byId, childrenOf, parentKeyOf } = api.buildIndex(messages);

    if (!byId.has(messageId)) {
      throw new Error('Message not found in this conversation — the bookmark may be stale.');
    }
    const path = api.computePath(parentKeyOf, messageId);

    const GUARD_MAX = 2000; // total sibling steps across all fork points
    for (let guard = 0; guard < GUARD_MAX; guard++) {
      const displayed = adapter.getDisplayedMessages();
      if (!displayed.length) {
        await sleep(150);
        continue;
      }

      // First depth where the displayed path diverges from the target path.
      let d = 0;
      while (d < path.length && d < displayed.length && displayed[d].id === path[d]) d++;

      if (d >= path.length) {
        // Whole target path is displayed.
        const el = document.getElementById(messageId);
        if (el) {
          flash(el);
          onStatus('');
          return;
        }
        await sleep(100);
        continue;
      }

      if (d >= displayed.length) {
        // Displayed chain is a strict prefix of the path — should not happen
        // (LibreChat always renders to a leaf); give the render a moment.
        await sleep(150);
        continue;
      }

      const parentKey = d === 0 ? adapter.NO_PARENT : path[d - 1];
      const siblings = childrenOf.get(parentKey) || [];
      const curIdx = siblings.indexOf(displayed[d].id);
      const wantIdx = siblings.indexOf(path[d]);
      if (curIdx === -1 || wantIdx === -1) {
        throw new Error('Tree mismatch between API and UI — refresh the page and retry.');
      }

      const stepsLeft = Math.abs(wantIdx - curIdx);
      onStatus(`Switching branch at depth ${d + 1} — ${stepsLeft} step${stepsLeft > 1 ? 's' : ''} left…`);

      const dir = wantIdx > curIdx ? 'next' : 'prev';
      if (!adapter.clickSibling(displayed[d].el, dir)) {
        throw new Error('Sibling switcher not found or disabled — LibreChat UI may have changed (fix content/adapter.js).');
      }
      await waitForDepthChange(d, displayed[d].id, 2500);
    }
    throw new Error('Navigation did not converge — aborted (see GUARD_MAX in navigate.js).');
  }

  LCBM.navigate = { jumpToMessage, flash, waitForDepthChange };
})();

/**
 * BRANCH-KEYS — mark one turn, then flip through its branches with ← / →.
 *
 * Problem this solves: comparing regenerations means hunting for the small
 * "< n/m >" switcher at the BOTTOM of a long message, clicking it, scrolling
 * back up to read, scrolling down again for the next one.
 *
 * With this: click ⇆ on a message (yours or the AI's) to mark that turn. While
 * a turn is marked, ArrowLeft / ArrowRight drive ITS switcher — one step per
 * press, same as clicking the arrows — and the view is pulled back to the top
 * of the newly shown branch. Click ⇆ again (or ✕ on the pill) to unmark.
 *
 * The mark follows the FORK, not the message: what is stored is the parent's
 * messageId, because switching siblings replaces the marked message itself
 * (new id) while the parent stays put. "The marked message" is therefore
 * always "whatever is displayed right after the parent" — so regenerating or
 * edit-resubmitting the marked turn keeps the mark on the new branch too. The
 * parent is read from the DOM (document order of .message-render = branch
 * path), so no API round-trip is involved.
 *
 * Shift+↑ / Shift+↓ move the mark to the message above / below on the
 * displayed branch, so the next turn to compare is one key away instead of a
 * hover + click. (Bare ↑ / ↓ scroll the transcript, and in the empty composer
 * LibreChat turns ↑ into "edit the last message"; Ctrl+Shift+↑ / ↓ are its
 * scroll-to-top / -bottom.)
 *
 * Alt+M marks the turn you are looking at (the one a third of the way down the
 * visible transcript), no hover needed. Esc unmarks, unless something else on
 * the page is the thing Esc should close. (Alt+Shift+M is LibreChat's own
 * "focus the message rail".)
 *
 * If an ANCESTOR's branch is switched so the fork is no longer on screen, the
 * mark goes dormant (pill says "off-branch") and wakes up when you come back.
 *
 * One mark per conversation, persisted ("bk:<conversationId>").
 */
(() => {
  'use strict';

  const LCBM = (window.LCBM = window.LCBM || {});
  const { adapter, storage, navigate } = LCBM;

  const BTN_CLASS = 'lcbm-mark';
  const BTN_ON_CLASS = 'lcbm-mark-on';
  const MSG_CLASS = 'lcbm-branch-marked';
  const SWITCH_WAIT_MS = 2500;
  /** Breathing room between the floating header and a revealed message. */
  const REVEAL_GAP_PX = 8;
  /** A message whose top is this close to the bottom edge counts as off-screen. */
  const REVEAL_BOTTOM_SLACK_PX = 120;
  /** Alt+M reads "the turn you are looking at" off a line this far down the
   *  visible transcript: a reply that fills the screen wins outright, and
   *  among short ones it is the one in the upper middle. */
  const LOOK_LINE = 1 / 3;

  const toast = (msg, opts) => LCBM.ui && LCBM.ui.toast && LCBM.ui.toast(msg, opts);

  /** Mark of the conversation on screen, kept in memory because the keydown
   *  handler must decide synchronously whether to claim the key. */
  let state = { convoId: null, mark: null };
  let busy = false;

  let shadow = null;
  let pillEl = null;

  // ------------------------------------------------------------ marked turn

  /** The displayed message of the marked turn: {idx, id, el}, or null when
   *  nothing is marked or the fork is not on the displayed branch. */
  function findMarked() {
    if (!state.mark || state.convoId !== adapter.getConversationId()) return null;
    const displayed = adapter.getDisplayedMessages();
    let idx = 0;
    if (state.mark.parentId !== adapter.NO_PARENT) {
      const parentIdx = displayed.findIndex((m) => m.id === state.mark.parentId);
      if (parentIdx === -1) return null;
      idx = parentIdx + 1;
    }
    return displayed[idx] ? { idx, ...displayed[idx] } : null;
  }

  async function setMark(mark) {
    const convoId = adapter.getConversationId();
    if (!convoId) return;
    state = { convoId, mark };
    refresh();
    await storage.setBranchMark(convoId, mark);
  }

  /** The mark that points at displayed[idx]: its parent's id. */
  function markAt(displayed, idx) {
    const parentId = idx === 0 ? adapter.NO_PARENT : displayed[idx - 1].id;
    return { parentId, markedAt: new Date().toISOString() };
  }

  async function toggleMark(messageEl) {
    const displayed = adapter.getDisplayedMessages();
    const idx = displayed.findIndex((m) => m.el === messageEl);
    if (idx === -1) return;

    const current = findMarked();
    if (current && current.el === messageEl) {
      await unmark();
      return;
    }
    await setMark(markAt(displayed, idx));
    announceMarked(messageEl);
  }

  async function unmark() {
    await setMark(null);
    toast('Unmarked — the arrow keys are back to normal.');
  }

  function announceMarked(messageEl) {
    const c = adapter.getSiblingCounter(messageEl);
    toast(
      c
        ? `Marked — ← / → flip this turn's branches (${c.n} / ${c.m}), Shift+↑ / ↓ move the mark, Esc unmarks.`
        : 'Marked — this turn has one branch so far. Shift+↑ / ↓ move the mark, Esc unmarks.',
    );
  }

  /** Index of the displayed message you are looking at: the one crossing the
   *  LOOK_LINE, or the nearest one when the line falls between two. -1 when
   *  nothing is displayed. */
  function indexInView(displayed) {
    if (!displayed.length) return -1;
    const scroller = adapter.getScroller(displayed[0].el);
    const box = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    const top = box.top + (scroller ? adapter.HEADER_OVERLAY_PX : 0);
    const y = top + (box.bottom - top) * LOOK_LINE;
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < displayed.length; i++) {
      const r = displayed[i].el.getBoundingClientRect();
      const dist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (dist < bestDist) {
        best = i;
        bestDist = dist;
      }
      /** Document order is top-to-bottom: everything after this is farther. */
      if (r.top > y) break;
    }
    return best;
  }

  /** Replay the jump-landing flash in place, without the scroll navigate.flash does. */
  function pulse(el) {
    el.classList.remove('lcbm-flash');
    void el.offsetWidth;
    el.classList.add('lcbm-flash');
    setTimeout(() => el.classList.remove('lcbm-flash'), 2600);
  }

  /** Alt+M: mark the turn you are looking at. Pressing it on the turn that is
   *  already marked keeps the mark (Esc is the way out). */
  function markInView() {
    if (busy) return;
    const displayed = adapter.getDisplayedMessages();
    const idx = indexInView(displayed);
    if (idx === -1) {
      toast('No message on screen to mark.');
      return;
    }
    const { el } = displayed[idx];
    const current = findMarked();
    if (!current || current.el !== el) setMark(markAt(displayed, idx));
    pulse(el);
    announceMarked(el);
  }

  /** Shift+↑ / ↓: put the mark on the message above / below on the displayed
   *  branch. No toast on success — the gold bar and the pill already move. */
  function moveMark(dir) {
    /** Mid-switch the DOM can still hold the old branch; a mark taken from
     *  it would point at a parent that is about to disappear. */
    if (busy) return;
    const target = findMarked();
    if (!target) {
      toast('The marked turn is not on the branch you are viewing.');
      return;
    }
    const displayed = adapter.getDisplayedMessages();
    const idx = target.idx + (dir === 'down' ? 1 : -1);
    if (!displayed[idx]) {
      toast(dir === 'down' ? 'Already on the last message.' : 'Already on the first message.');
      return;
    }
    setMark(markAt(displayed, idx));
    reveal(displayed[idx].el);
  }

  // --------------------------------------------------------------- switching

  /** Bring the top of the message into view, but only when it is not already:
   *  flipping between branches that all start on screen should not jitter. */
  function reveal(el) {
    const scroller = adapter.getScroller(el);
    if (!scroller) {
      el.scrollIntoView({ block: 'start' });
      return;
    }
    const box = scroller.getBoundingClientRect();
    const top = el.getBoundingClientRect().top;
    const wantTop = box.top + adapter.HEADER_OVERLAY_PX + REVEAL_GAP_PX;
    if (top >= wantTop - 1 && top <= box.bottom - REVEAL_BOTTOM_SLACK_PX) return;
    scroller.scrollTop += top - wantTop;
  }

  async function step(dir) {
    if (busy) return;
    const target = findMarked();
    if (!target) {
      toast('The marked turn is not on the branch you are viewing.');
      return;
    }
    const c = adapter.getSiblingCounter(target.el);
    if (!c) {
      toast('The marked turn has only one branch.');
      return;
    }
    if (!adapter.clickSibling(target.el, dir)) {
      toast(
        dir === 'next'
          ? `Already on the last branch (${c.m} / ${c.m}).`
          : `Already on the first branch (1 / ${c.m}).`,
      );
      return;
    }
    busy = true;
    try {
      await navigate.waitForDepthChange(target.idx, target.id, SWITCH_WAIT_MS);
    } finally {
      busy = false;
    }
    refresh();
    const now = findMarked();
    if (now) reveal(now.el);
  }

  // ---------------------------------------------------------------- keyboard

  const EDITABLE = 'input, textarea, select';
  /** ARIA widgets that use the arrow keys themselves. */
  const ARROW_WIDGETS = [
    'menu', 'menubar', 'listbox', 'combobox', 'dialog', 'alertdialog',
    'tablist', 'radiogroup', 'slider', 'tree', 'grid',
  ].map((r) => `[role="${r}"]`).join(', ');

  /** document.activeElement stops at shadow hosts; our own modals live in some. */
  function deepActiveElement() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }

  function ownOverlayOpen() {
    return ['lcbm-host', 'lcbm-st-host'].some((id) => {
      const host = document.getElementById(id);
      return !!(host && host.shadowRoot && host.shadowRoot.querySelector('.overlay.open'));
    });
  }

  /**
   * Never steal an arrow key that is doing something: typing, a menu, a
   * dialog. The one deliberate exception is the main composer while it is
   * EMPTY — LibreChat focuses it on its own all the time, and ← / → in an
   * empty box do nothing, so making the user click away first would be the
   * whole annoyance back again.
   *
   * kind 'move' = Shift+↑ / ↓, which have two more jobs to leave alone:
   * Chrome grows a text selection with them even in non-editable text
   * (selecting part of a reply to quote it), and the ask_user_question
   * popover steers its options with ↑ / ↓ from the empty composer, modifiers
   * ignored (useAskAnswerMode.ts).
   *
   * kind 'unmark' = Esc, which closes whatever is open first: any composer
   * popover (@, /, $, ask-a-question), wherever the focus is. Same blind spot
   * as the arrows: with the ask-a-question popover COLLAPSED, Esc in the
   * empty composer also leaves LibreChat's answer mode (the question card in
   * the chat still takes an answer).
   */
  function keysAllowedHere(kind) {
    if (adapter.isDialogOpen() || ownOverlayOpen()) return false;
    if (kind === 'unmark' && adapter.isComposerPopoverOpen()) return false;
    if (kind === 'move') {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed) return false;
    }
    const el = deepActiveElement();
    if (!el || el === document.body || el === document.documentElement) return true;
    if (el === adapter.getComposer()) {
      // The Styles extension's Prefill advertises its untouched text as
      // data-lc-prefill; a box holding only that counts as empty here.
      const empty = el.value === '' || (el.dataset.lcPrefill != null && el.value === el.dataset.lcPrefill);
      return empty && !(kind === 'move' && adapter.isComposerPopoverOpen());
    }
    if (el.isContentEditable || el.matches(EDITABLE)) return false;
    return !el.closest(ARROW_WIDGETS);
  }

  /** Codes of the keydowns claimed below. Their keyup is swallowed as well:
   *  the composer's onKeyUp turns ANY ArrowUp release in an empty box into
   *  "edit the last message" (useHandleKeyUp.ts), Shift held or not. */
  const claimed = new Set();

  function claim(e) {
    e.preventDefault();
    claimed.add(e.code);
  }

  /** Alt+M. By code, not key, like the panel's Alt+B. Ctrl excluded so AltGr+M
   *  (µ on a German layout) still types; Shift excluded for LibreChat's rail. */
  function isMarkInViewKey(e) {
    return e.code === 'KeyM' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
  }

  function onKeyDown(e) {
    if (e.defaultPrevented || e.isComposing) return;
    if (isMarkInViewKey(e)) {
      /** Works from anywhere, mid-typing included: Alt+M types nothing. */
      if (!adapter.isChatPage() || adapter.isDialogOpen() || ownOverlayOpen()) return;
      claim(e);
      markInView();
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    let kind = null;
    if (!e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) kind = 'flip';
    else if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) kind = 'move';
    /** Shift+Esc is LibreChat's "focus the composer". */
    else if (!e.shiftKey && e.key === 'Escape') kind = 'unmark';
    if (!kind) return;
    if (!state.mark || state.convoId !== adapter.getConversationId()) return;
    if (!keysAllowedHere(kind)) return;
    claim(e);
    if (kind === 'flip') step(e.key === 'ArrowRight' ? 'next' : 'prev');
    else if (kind === 'move') moveMark(e.key === 'ArrowDown' ? 'down' : 'up');
    else unmark();
  }

  function onKeyUp(e) {
    if (!claimed.delete(e.code)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  // -------------------------------------------------------------------- pill

  function ensurePill() {
    if (shadow) return;
    const host = document.createElement('div');
    host.id = 'lcbm-bk-host';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; font-family: system-ui, sans-serif; }
      .pill {
        position: fixed; right: 68px; bottom: 80px; z-index: 2147483000;
        display: none; align-items: center; height: 32px; border-radius: 16px;
        background: #1b1b22; border: 1px solid #c9a227; color: #e8e8ee;
        box-shadow: 0 2px 10px rgba(0,0,0,.4); opacity: .9; overflow: hidden;
      }
      .pill.show { display: inline-flex; }
      .pill:hover { opacity: 1; }
      .pill.off { border-color: #4a4a58; color: #9a9aa8; }
      .pill button {
        height: 100%; border: none; background: none; color: inherit;
        cursor: pointer; font-size: 12.5px; font-variant-numeric: tabular-nums;
      }
      .pill button:hover { background: rgba(255,255,255,.08); }
      .pill .go { padding: 0 6px 0 12px; }
      .pill .go b { color: #c9a227; font-weight: 600; margin-right: 6px; }
      .pill.off .go b { color: inherit; }
      .pill .x { padding: 0 10px 0 6px; color: #9a9aa8; }
      .pill .x:hover { color: #ff8484; }
    `;
    shadow.appendChild(style);

    pillEl = document.createElement('div');
    pillEl.className = 'pill';
    pillEl.innerHTML =
      '<button class="go"><b>&#8646;</b><span class="n"></span></button>' +
      '<button class="x" title="Unmark (Esc)">&#10005;</button>';
    shadow.appendChild(pillEl);

    pillEl.querySelector('.go').addEventListener('click', (e) => {
      e.currentTarget.blur();
      const target = findMarked();
      if (target) navigate.flash(target.el);
      else toast('The marked turn is not on the branch you are viewing.');
    });
    pillEl.querySelector('.x').addEventListener('click', unmark);
  }

  function updatePill(target) {
    ensurePill();
    const active = !!state.mark && state.convoId === adapter.getConversationId();
    pillEl.classList.toggle('show', active);
    if (!active) return;
    pillEl.classList.toggle('off', !target);
    const c = target && adapter.getSiblingCounter(target.el);
    pillEl.querySelector('.n').textContent = !target ? 'off-branch' : c ? `${c.n} / ${c.m}` : '1 / 1';
    pillEl.querySelector('.go').title = target
      ? 'Marked turn — ← / → flip its branches, Shift+↑ / ↓ move the mark, Esc unmarks. Click to scroll to it.'
      : 'The marked turn is not on the branch you are viewing.';
  }

  // ------------------------------------------------------ per-message buttons

  function makeButton(messageEl) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.textContent = '⇆';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      /** Drop focus so LibreChat's focus-within styling doesn't pin the row open. */
      btn.blur();
      toggleMark(messageEl);
    });
    return btn;
  }

  /** Re-assert highlight + button states. React re-creates message elements
   *  on every branch switch, so this runs on each DOM change. */
  function refresh() {
    const target = findMarked();
    for (const { el } of adapter.getDisplayedMessages()) {
      const on = !!target && el === target.el;
      el.classList.toggle(MSG_CLASS, on);
      for (const btn of el.querySelectorAll(`.${BTN_CLASS}`)) {
        btn.classList.toggle(BTN_ON_CLASS, on);
        btn.setAttribute('aria-pressed', String(on));
        btn.title = on
          ? 'Unmark (Esc) — stop flipping this turn with ← / →'
          : 'Mark this turn — then ← / → flip through its branches (Alt+M marks the turn you are looking at)';
      }
    }
    updatePill(target);
  }

  function inject() {
    for (const { el } of adapter.getDisplayedMessages()) {
      for (const bar of adapter.getActionBars(el)) {
        if (!bar.querySelector(`.${BTN_CLASS}`)) bar.appendChild(makeButton(el));
      }
    }
    refresh();
  }

  async function onRoute() {
    const convoId = adapter.getConversationId();
    state = { convoId, mark: null };
    refresh();
    if (!convoId) return;
    const mark = await storage.getBranchMark(convoId);
    /** Navigated away, or marked something, while storage was answering. */
    if (adapter.getConversationId() !== convoId || state.convoId !== convoId || state.mark) return;
    state = { convoId, mark };
    refresh();
  }

  document.addEventListener('keydown', onKeyDown, true);
  /** window capture runs before React's listeners on the app root. */
  window.addEventListener('keyup', onKeyUp, true);
  /** A key released while the tab was in the background never sends its keyup. */
  window.addEventListener('blur', () => claimed.clear());

  LCBM.branchKeys = { inject, onRoute, refresh, reveal };
})();

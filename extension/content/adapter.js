/**
 * ADAPTER — every LibreChat selector and DOM accessor lives HERE and only here.
 * If a LibreChat update breaks the extension, this is the only file to fix.
 *
 * Grounded in LibreChat v0.8.7 source (verified 2026-08):
 *  - MessageRender.tsx / ContentRender.tsx render each displayed message as
 *      <div id={messageId} class="... message-render ...">
 *    and child messages are DOM SIBLINGS, not nested (MultiMessage.tsx renders
 *    <>{row}<MultiMessage children/></>). So document order of .message-render
 *    elements IS the currently displayed root->leaf branch path.
 *  - SiblingSwitch.tsx renders, inside each message container:
 *      <nav aria-label="Sibling message navigation">
 *        <button aria-label="Previous sibling message">
 *        <span role="status">{idx+1} / {count}</span>
 *        <button aria-label="Next sibling message">
 *    "Next" moves to the LATER-created sibling. The displayed index matches
 *    children order from GET /api/messages (sorted createdAt asc), because
 *    buildTree() pushes children in array order.
 *  - Action buttons (copy/edit/fork...) are <button class="hover-button"> in a
 *    SubRow div that also contains the sibling nav.
 */
(() => {
  'use strict';

  const LCBM = (window.LCBM = window.LCBM || {});

  const SEL = {
    message: '.message-render[id]',
    siblingNav: 'nav[aria-label="Sibling message navigation"]',
    prevBtn: 'button[aria-label="Previous sibling message"]',
    nextBtn: 'button[aria-label="Next sibling message"]',
    counter: 'span[role="status"]',
    hoverButton: 'button.hover-button',
    /** The mirrored row at the top of an AI reply (mirror-message-buttons patch). */
    topActions: '[data-lc-top-actions]',
    editor: 'textarea[data-testid="message-text-editor"]',
    scroller: '.scrollbar-gutter-stable',
    /** Radix dialogs carry data-state; Ariakit keeps CLOSED popovers mounted as
     *  role="dialog" with no data-state, so the attribute is what means "open". */
    openDialog: '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
    /** Mention.tsx, PromptsCommand.tsx, SkillsCommand.tsx and
     *  AskUserQuestionPopover.tsx each render a `div.popover` only while open. */
    composerPopover: 'div.popover',
  };

  /** common/types.ts: `export const mainTextareaId = 'prompt-textarea'` */
  const COMPOSER_ID = 'prompt-textarea';

  /** LibreChat's Constants.NO_PARENT */
  const NO_PARENT = '00000000-0000-0000-0000-000000000000';

  /** /c/<uuid> -> conversationId; null on /c/new or non-chat pages */
  function getConversationId() {
    const m = location.pathname.match(/^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    return m ? m[1] : null;
  }

  function isChatPage() {
    return getConversationId() !== null;
  }

  /** Displayed branch path, root->leaf: [{id, el}] */
  function getDisplayedMessages() {
    return [...document.querySelectorAll(SEL.message)].map((el) => ({ id: el.id, el }));
  }

  /**
   * Click the sibling switcher on a message container.
   * dir: 'next' | 'prev'. Returns false if the nav/button is missing or disabled.
   * NOTE: nav lookup is safe unscoped-within-container because children are DOM
   * siblings — a container only ever holds its OWN nav.
   */
  function clickSibling(messageEl, dir) {
    const nav = messageEl.querySelector(SEL.siblingNav);
    if (!nav) return false;
    const btn = nav.querySelector(dir === 'next' ? SEL.nextBtn : SEL.prevBtn);
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  }

  /** Parse "3 / 7" from the sibling counter. Returns {n, m} or null. */
  function getSiblingCounter(messageEl) {
    const span = messageEl.querySelector(`${SEL.siblingNav} ${SEL.counter}`);
    if (!span) return null;
    const m = span.textContent.match(/(\d+)\s*\/\s*(\d+)/);
    return m ? { n: +m[1], m: +m[2] } : null;
  }

  /**
   * Container to inject our bookmark button into: the parent of the existing
   * hover buttons (falls back to the sibling-nav's parent SubRow).
   */
  function getActionBar(messageEl) {
    const bars = getActionBars(messageEl);
    return bars.length ? bars[bars.length - 1] : null;
  }

  /**
   * Every row of a message's own buttons, top row first. With LibreChat's
   * mirror-message-buttons patch an AI reply has two: a copy at the top,
   * inside [data-lc-top-actions], and the usual one at the bottom. Each row
   * is the parent of its first hover button (the same rule as before, once
   * per region). Without that patch this is the one bottom row.
   */
  function getActionBars(messageEl) {
    const bars = [];
    let top = null;
    let bottom = null;
    for (const hb of messageEl.querySelectorAll(SEL.hoverButton)) {
      if (hb.closest(SEL.topActions)) top = top || hb.parentElement;
      else bottom = bottom || hb.parentElement;
      if (top && bottom) break;
    }
    if (top) bars.push(top);
    if (bottom) bars.push(bottom);
    if (!bars.length) {
      const nav = messageEl.querySelector(SEL.siblingNav);
      if (nav && nav.parentElement) bars.push(nav.parentElement);
    }
    return bars;
  }

  /** Short text snippet of a message, for bookmark names/previews. */
  function getMessageText(messageEl) {
    const text = (messageEl.innerText || '').replace(/\s+/g, ' ').trim();
    return text.slice(0, 120);
  }

  /**
   * The message's Edit button. HoverButtons.tsx gives it a stable id:
   *   id={`edit-${message.messageId}`}
   * Falls back to a title/aria lookup inside the message if that ever changes.
   */
  function getEditButton(messageEl) {
    const byId = document.getElementById(`edit-${messageEl.id}`);
    if (byId) return byId;
    return (
      messageEl.querySelector('button[id^="edit-"]') ||
      messageEl.querySelector('button[title*="Edit" i], button[aria-label*="Edit" i]')
    );
  }

  /**
   * Open editors for a message. EditTextPart.tsx renders one
   * <TextareaAutosize data-testid="message-text-editor"> per content part
   * (a THINK part and a text part both get their own).
   */
  function getEditors(messageEl) {
    const inside = [...messageEl.querySelectorAll(SEL.editor)];
    if (inside.length) return inside;
    /** Some render paths mount the editor as a sibling of the message row. */
    const parent = messageEl.parentElement;
    return parent ? [...parent.querySelectorAll(SEL.editor)] : [];
  }

  /** True when this message is currently in edit mode. */
  function isEditing(messageEl) {
    return getEditors(messageEl).length > 0;
  }

  /** The main chat composer textarea, or null. */
  function getComposer() {
    return document.getElementById(COMPOSER_ID);
  }

  /**
   * The chat transcript's scroll container (MessagesView.tsx). Its content has
   * `pt-14` because the chat header floats over the top 56px of it.
   */
  function getScroller(messageEl) {
    return messageEl.closest(SEL.scroller);
  }
  const HEADER_OVERLAY_PX = 56;

  /** True while one of LibreChat's own modal dialogs is open. */
  function isDialogOpen() {
    return document.querySelector(SEL.openDialog) !== null;
  }

  /** True while one of the composer's popovers (@, /, $, ask-a-question) is open. */
  function isComposerPopoverOpen() {
    return document.querySelector(SEL.composerPopover) !== null;
  }

  LCBM.adapter = {
    SEL,
    NO_PARENT,
    HEADER_OVERLAY_PX,
    getComposer,
    getScroller,
    isDialogOpen,
    isComposerPopoverOpen,
    getConversationId,
    isChatPage,
    getDisplayedMessages,
    clickSibling,
    getSiblingCounter,
    getActionBar,
    getActionBars,
    getMessageText,
    getEditButton,
    getEditors,
    isEditing,
  };
})();

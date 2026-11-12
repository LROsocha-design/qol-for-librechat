/**
 * DEEPLINK — open a conversation straight at one message, on any branch:
 *
 *   http://localhost:3080/c/<conversationId>#lcjump=<messageId>
 *
 * LibreChat has no per-message URLs, and a message on another branch is not
 * even in the DOM, so a plain #<messageId> anchor cannot work. This only parses
 * the link; ui.jumpFromLink does the jump with the same machinery as bookmarks.
 *
 * Loaded at document_start (its own manifest entry), unlike every other
 * module: the hash is captured before the app boots, so the link survives
 * even if a router redirect rewrites the URL before document_idle. Both
 * entries share one isolated world, so main.js sees LCBM.deeplink.
 */
(() => {
  'use strict';

  const LCBM = (window.LCBM = window.LCBM || {});

  const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  /** Tolerates other hash params around it: #a=b&lcjump=<id>&c=d */
  const RE = new RegExp(`(^#|&)lcjump=(${UUID})(?=&|$)`, 'i');

  function parse(hash) {
    const m = RE.exec(hash || '');
    return m ? m[2].toLowerCase() : null;
  }

  /** Remembered with its path, so it is never applied to a different chat. */
  const initialId = parse(location.hash);
  let pending = initialId ? { path: location.pathname, messageId: initialId } : null;

  /**
   * Strip the param once consumed. Without this, clicking the SAME link again
   * is a same-URL navigation — no hashchange, no jump — so you could not
   * re-jump after scrolling away. history.state is passed through untouched
   * because react-router keeps its location key and index in it.
   */
  function strip() {
    const rest = location.hash
      .replace(RE, '$1')
      .replace(/&&/, '&')
      .replace(/^#&/, '#')
      .replace(/&$/, '');
    const hash = rest === '#' ? '' : rest;
    history.replaceState(history.state, '', location.pathname + location.search + hash);
  }

  /**
   * The message id this URL asks for, or null. Consumes it: a second call
   * returns null until another lcjump link is opened.
   */
  function take() {
    const fromHash = parse(location.hash);
    if (fromHash) {
      strip();
      pending = null;
      return fromHash;
    }
    if (!pending) return null;
    const { path, messageId } = pending;
    /** Use it or lose it on the first chat page; a /login detour keeps it. */
    if (/^\/c\//.test(location.pathname)) pending = null;
    return path === location.pathname ? messageId : null;
  }

  LCBM.deeplink = { parse, take };
})();

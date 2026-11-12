/**
 * API — talks to LibreChat's own backend, same-origin, using the session the
 * user already has.
 *
 * Auth model (verified against api/server/controllers/AuthController.js):
 *   POST /api/auth/refresh  (httpOnly refreshToken cookie goes along
 *   automatically)  ->  { token, user }
 * The access token is held in memory here and refreshed on 401.
 * The extension NEVER sees or stores credentials.
 *
 * Messages (api/server/routes/messages.js):
 *   GET /api/messages/:conversationId  ->  TMessage[] sorted createdAt ASC.
 * That sort order is what the UI's buildTree() uses for sibling order, so
 * children arrays built here line up with the on-screen "n / m" counters.
 */
(() => {
  'use strict';

  const LCBM = (window.LCBM = window.LCBM || {});
  const { NO_PARENT } = LCBM.adapter;

  let _token = null;

  /**
   * LibreChat gives the session a NEW refresh cookie on every refresh
   * (AuthService.setAuthTokens -> generateRefreshToken). Two refreshes sent at
   * the same moment therefore race: the one that arrives second still carries
   * the old cookie and gets 401 "Refresh token expired or not found". The app,
   * LibreChat QoL and Skill Styles all refresh when a page loads. So:
   *   - callers in this script share one refresh in flight;
   *   - a Web Lock (shared by every script on this origin) lets the
   *     extensions' refreshes run one at a time;
   *   - a 401 is tried again a moment later, when the winner's new cookie is
   *     in the browser (this also covers a race with the app's own refresh).
   */
  const REFRESH_LOCK = 'librechat-ext-auth-refresh';
  let _refreshing = null;

  async function requestRefresh() {
    let res = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 250 + Math.random() * 350));
      res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.status !== 401) break;
    }
    return res;
  }

  function refreshToken() {
    if (!_refreshing) {
      _refreshing = doRefresh().finally(() => {
        _refreshing = null;
      });
    }
    return _refreshing;
  }

  async function doRefresh() {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : null;
    const res = locks ? await locks.request(REFRESH_LOCK, requestRefresh) : await requestRefresh();
    if (!res.ok) throw new Error(`Auth refresh failed (HTTP ${res.status}). Are you logged in?`);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // Backend answers 200 with a plain-text message when the cookie is absent.
      throw new Error(`Not logged in (server said: "${text.slice(0, 80)}").`);
    }
    if (!data.token) throw new Error('Auth refresh returned no token.');
    _token = data.token;
    return _token;
  }

  async function authedFetch(url) {
    if (!_token) await refreshToken();
    let res = await fetch(url, { headers: { Authorization: `Bearer ${_token}` } });
    if (res.status === 401) {
      await refreshToken();
      res = await fetch(url, { headers: { Authorization: `Bearer ${_token}` } });
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res.json();
  }

  /** Full flat message list for a conversation, createdAt ascending. */
  function fetchMessages(conversationId) {
    return authedFetch(`/api/messages/${encodeURIComponent(conversationId)}`);
  }

  /**
   * Index a flat message list into:
   *   byId       Map(messageId -> message)
   *   childrenOf Map(parentKey -> [messageId...] in array order)
   * Parent keys are normalized exactly like the client's buildTree():
   * self-parented or unknown-parent messages count as roots (NO_PARENT).
   */
  function buildIndex(messages) {
    const byId = new Map();
    for (const m of messages) byId.set(m.messageId, m);

    const childrenOf = new Map();
    const parentKeyOf = new Map();
    for (const m of messages) {
      let p = m.parentMessageId;
      if (!p || p === m.messageId || p === NO_PARENT || !byId.has(p)) p = NO_PARENT;
      parentKeyOf.set(m.messageId, p);
      if (!childrenOf.has(p)) childrenOf.set(p, []);
      childrenOf.get(p).push(m.messageId);
    }
    return { byId, childrenOf, parentKeyOf };
  }

  /** Root->target path of messageIds. */
  function computePath(parentKeyOf, targetId) {
    const path = [];
    const seen = new Set();
    let cur = targetId;
    while (cur && cur !== NO_PARENT && !seen.has(cur)) {
      seen.add(cur);
      path.unshift(cur);
      cur = parentKeyOf.get(cur);
    }
    return path;
  }

  LCBM.api = { refreshToken, fetchMessages, buildIndex, computePath };
})();

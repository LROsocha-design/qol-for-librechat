/**
 * API — the handful of LibreChat endpoints this extension needs.
 *
 * Auth (api/server/controllers/AuthController.js): POST /api/auth/refresh
 * sends the httpOnly refreshToken cookie along automatically and answers
 * { token, user }. The access token is held in memory and refreshed on 401.
 *
 * Skills (api/server/routes/skills.js + packages/api/src/skills/handlers.ts):
 *   GET   /api/skills?limit=100&cursor=…   → { skills: summary[], has_more, after }
 *   GET   /api/skills/:id                   → full skill incl. body + version
 *   PATCH /api/skills/:id { expectedVersion, body } → updated skill,
 *         409 { error:'skill_version_conflict', current } on a stale version.
 *   The server derives the indexed `alwaysApply` column from the
 *   `always-apply:` line inside the saved body, so patching the body is the
 *   one write that keeps the SKILL.md text and the runtime flag in sync.
 *
 * Per-user skill toggles (api/server/routes/settings.js):
 *   GET  /api/user/settings/skills/active                → { [skillId]: boolean }
 *   POST /api/user/settings/skills/active { skillStates } → same record
 *   A skill toggled off here is skipped by always-apply priming, so
 *   activating a skill through the picker also clears an explicit `false`.
 */
(() => {
  const LCSS = (window.LCSS = window.LCSS || {});

  let _token = null;

  /**
   * The token comes from the bookmarks side's api.js (LCBM.api), which shares
   * one refresh between all callers: LibreChat gives the session a new refresh
   * cookie on every refresh, so two refreshes at the same moment would race.
   */
  async function refreshToken() {
    _token = await window.LCBM.api.refreshToken();
    return _token;
  }

  async function readJson(res) {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  async function authedFetch(url, init = {}, retry = true) {
    if (!_token) await refreshToken();
    const headers = Object.assign({}, init.headers || {}, { Authorization: `Bearer ${_token}` });
    if (init.body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, Object.assign({}, init, { headers, credentials: 'include' }));
    if (res.status === 401 && retry) {
      await refreshToken();
      return authedFetch(url, init, false);
    }
    return res;
  }

  function errorMessage(data, fallback) {
    if (data && typeof data === 'object') {
      if (typeof data.error === 'string') return data.error;
      if (typeof data.message === 'string') return data.message;
    }
    return fallback;
  }

  /** Every skill summary the current user can see (paginates the catalog). */
  async function listSkills() {
    const all = [];
    let cursor = null;
    let guard = 0;
    do {
      const url = `/api/skills?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await authedFetch(url);
      const data = await readJson(res);
      if (!res.ok) throw new Error(errorMessage(data, `Skill list failed (HTTP ${res.status})`));
      all.push(...((data && data.skills) || []));
      cursor = data && data.has_more ? data.after : null;
    } while (cursor && ++guard < 50);
    return all;
  }

  async function getSkill(id) {
    const res = await authedFetch(`/api/skills/${encodeURIComponent(id)}`);
    const data = await readJson(res);
    if (!res.ok) throw new Error(errorMessage(data, `Skill load failed (HTTP ${res.status})`));
    return data;
  }

  async function patchSkill(id, expectedVersion, payload) {
    const res = await authedFetch(`/api/skills/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(Object.assign({ expectedVersion }, payload)),
    });
    const data = await readJson(res);
    if (res.status === 409) return { conflict: true, current: data && data.current };
    if (!res.ok) throw new Error(errorMessage(data, `Skill update failed (HTTP ${res.status})`));
    return { conflict: false, skill: data };
  }

  /**
   * Rewrite the `always-apply:` line in the skill's SKILL.md and save it.
   * Retries once on a version conflict. Verifies the server derived the
   * same value we wrote, so text and runtime flag can never drift apart.
   */
  async function setAlwaysApply(id, value) {
    let skill = await getSkill(id);
    for (let attempt = 0; attempt < 2; attempt++) {
      const body = LCSS.frontmatter.setAlwaysApply(skill.body || '', value);
      const result = await patchSkill(skill._id, skill.version, { body });
      if (result.conflict) {
        skill = result.current || (await getSkill(id));
        continue;
      }
      const saved = result.skill || {};
      if (saved.alwaysApply !== value) {
        throw new Error(
          `Saved, but the server reports always-apply = ${saved.alwaysApply}. Check the SKILL.md frontmatter.`,
        );
      }
      return saved;
    }
    throw new Error('The skill changed underneath us twice. Reload and retry.');
  }

  async function getSkillStates() {
    const res = await authedFetch('/api/user/settings/skills/active');
    const data = await readJson(res);
    if (!res.ok) throw new Error(errorMessage(data, `Skill states failed (HTTP ${res.status})`));
    return data && typeof data === 'object' && !data.raw ? data : {};
  }

  async function setSkillStates(skillStates) {
    const res = await authedFetch('/api/user/settings/skills/active', {
      method: 'POST',
      body: JSON.stringify({ skillStates }),
    });
    const data = await readJson(res);
    if (!res.ok) throw new Error(errorMessage(data, `Saving skill states failed (HTTP ${res.status})`));
    return data || {};
  }

  /** Current user (for the "your own skills default to on" rule). */
  async function getMe() {
    const res = await authedFetch('/api/user');
    const data = await readJson(res);
    if (!res.ok) throw new Error(errorMessage(data, `User lookup failed (HTTP ${res.status})`));
    return data;
  }

  /** Public startup config; carries interface.skills.defaultActiveOnShare. */
  async function getConfig() {
    const res = await fetch('/api/config', { credentials: 'include' });
    const data = await readJson(res);
    if (!res.ok) throw new Error(`Config failed (HTTP ${res.status})`);
    return data;
  }

  LCSS.api = {
    refreshToken,
    authedFetch,
    readJson,
    getMe,
    getConfig,
    listSkills,
    getSkill,
    patchSkill,
    setAlwaysApply,
    getSkillStates,
    setSkillStates,
  };
})();

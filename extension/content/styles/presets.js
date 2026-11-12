/**
 * PRESETS — named sets of styles, switched in one click from the Styles popover.
 *
 * A preset is the list of skills that should be ticked. Applying one ticks
 * those (always-apply on + switch on) and unticks every other ticked skill
 * (always-apply off + switch off): the same two moves a row's tick and untick
 * make. Skills that are neither in the preset nor ticked are left alone.
 *
 * Stored per browser profile: in chrome.storage.local when the script runs as
 * the extension (it survives clearing LibreChat's site data), mirrored to
 * localStorage, which is also the only store when the scripts are injected
 * into the page for a test.
 *
 * Each entry keeps the skill's id and its name: the id survives a rename, the
 * name finds a skill that was deleted and imported again under a new id.
 */
(() => {
  const LCSS = (window.LCSS = window.LCSS || {});
  const KEY = 'lcss.presets';

  let list = [];

  function extStore() {
    try {
      return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local ? chrome.storage.local : null;
    } catch {
      return null; // extension reloaded underneath this copy of the script
    }
  }

  function newId() {
    return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  function sanitize(raw) {
    const arr = raw && Array.isArray(raw.presets) ? raw.presets : [];
    return arr
      .filter((p) => p && typeof p.name === 'string' && Array.isArray(p.skills))
      .map((p) => ({
        id: String(p.id || newId()),
        name: p.name,
        skills: p.skills
          .filter((e) => e && (e.id || e.name))
          .map((e) => ({ id: e.id ? String(e.id) : '', name: e.name ? String(e.name) : '' })),
      }));
  }

  function readLocal() {
    try {
      const text = localStorage.getItem(KEY);
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  /** Re-read from storage (another tab may have changed it). */
  async function load() {
    let data = null;
    const store = extStore();
    if (store) {
      try {
        data = (await store.get(KEY))[KEY] || null;
      } catch {
        data = null;
      }
    }
    if (!data) data = readLocal();
    list = sanitize(data);
    return list;
  }

  async function save() {
    const data = { v: 1, presets: list };
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* private mode etc. */
    }
    const store = extStore();
    if (store) {
      try {
        await store.set({ [KEY]: data });
      } catch {
        /* the localStorage copy still holds it */
      }
    }
  }

  function all() {
    return list;
  }

  function entriesOf(skills) {
    return skills.map((s) => ({ id: String(s._id), name: s.name || '' }));
  }

  function findByName(name) {
    const key = name.trim().toLowerCase();
    return list.find((p) => p.name.trim().toLowerCase() === key) || null;
  }

  /** New preset, or an update of the one already holding that name. */
  async function saveAs(name, skills) {
    const existing = findByName(name);
    if (existing) {
      existing.skills = entriesOf(skills);
      await save();
      return { preset: existing, replaced: true };
    }
    const preset = { id: newId(), name: name.trim(), skills: entriesOf(skills) };
    list.push(preset);
    await save();
    return { preset, replaced: false };
  }

  async function setSkills(id, skills) {
    const p = list.find((x) => x.id === id);
    if (!p) return null;
    p.skills = entriesOf(skills);
    await save();
    return p;
  }

  async function rename(id, name) {
    const p = list.find((x) => x.id === id);
    if (!p || !name.trim()) return null;
    p.name = name.trim();
    await save();
    return p;
  }

  async function remove(id) {
    list = list.filter((x) => x.id !== id);
    await save();
  }

  /** The preset's skills as they exist now. */
  function resolve(preset, skills) {
    const byId = new Map(skills.map((s) => [String(s._id), s]));
    const found = [];
    const missing = [];
    const seen = new Set();
    for (const e of preset.skills) {
      let s = e.id ? byId.get(e.id) : undefined;
      if (!s && e.name) s = skills.find((x) => x.name === e.name);
      if (!s) missing.push(e);
      else if (!seen.has(s._id)) {
        seen.add(s._id);
        found.push(s);
      }
    }
    return { found, missing };
  }

  /** What switching to `preset` has to change. */
  function plan(preset, skills, isEnabled) {
    const { found, missing } = resolve(preset, skills);
    const want = new Set(found.map((s) => s._id));
    return {
      found,
      missing,
      turnOff: skills.filter((s) => s.alwaysApply === true && !want.has(s._id)),
      turnOn: found.filter((s) => s.alwaysApply !== true),
      enable: found.filter((s) => !isEnabled(s)),
    };
  }

  /** True when exactly this preset's skills are ticked. */
  function matches(preset, skills) {
    const p = plan(preset, skills, () => true);
    return p.turnOff.length === 0 && p.turnOn.length === 0;
  }

  LCSS.presets = { load, all, saveAs, setSkills, rename, remove, resolve, plan, matches };
})();

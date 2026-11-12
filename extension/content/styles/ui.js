/**
 * UI — the popover (in a shadow root, so LibreChat's Tailwind can't touch it)
 * and the pill's count badge. The pill itself is created by main.js because
 * its placement depends on LibreChat's composer DOM.
 *
 * One row = one "style" switch:
 *   tick    → `always-apply: true`  AND the skill's own Skills-panel switch on
 *   untick  → `always-apply: false` AND that switch off
 *   the small enabled/disabled button flips only the switch, for skills you
 *   want to keep reachable through the `$` menu without auto-applying them.
 *
 * Presets (presets.js) sit above the list: one click on a chip ticks exactly
 * that preset's skills and unticks the rest.
 *
 * The switch matters because LibreChat skips always-apply priming, hides the
 * skill from the `$` menu and drops it from the model's catalog whenever the
 * per-user switch is off (packages/api/src/agents/skills.ts → resolveSkillActive).
 */
(() => {
  const LCSS = (window.LCSS = window.LCSS || {});
  const { api } = LCSS;

  const SOLO_KEY = 'lcss.solo';
  const POP_WIDTH = 340;

  const STYLE = `
    :host { position: fixed; inset: 0; z-index: 10000; pointer-events: none; }
    * { box-sizing: border-box; }
    .pop {
      position: absolute; pointer-events: auto;
      width: ${POP_WIDTH}px; max-height: 70vh; display: flex; flex-direction: column;
      background: var(--surface-primary, #fff); color: var(--text-primary, #111);
      border: 1px solid var(--border-medium, #ccc); border-radius: 14px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
    }
    /* The rule above beats the browser's own [hidden] { display: none },
       so restate it: close(), Escape and click-outside all set the attribute. */
    .pop[hidden] { display: none; }
    .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px 6px; }
    .title { font-weight: 600; font-size: 14px; }
    .sub { color: var(--text-tertiary, #777); font-size: 12px; flex: 1; }
    .iconbtn {
      border: 0; background: transparent; color: var(--text-secondary, #555);
      cursor: pointer; border-radius: 8px; padding: 2px 7px; font-size: 15px; line-height: 1.2;
    }
    .iconbtn:hover { background: var(--surface-hover, #eee); }
    .hint { padding: 0 12px 8px; color: var(--text-tertiary, #777); font-size: 11.5px; }
    .list {
      overflow: auto; min-height: 0; padding: 4px 6px;
      border-top: 1px solid var(--border-light, #eee); border-bottom: 1px solid var(--border-light, #eee);
    }
    .row {
      display: flex; align-items: center; gap: 10px; padding: 6px 8px;
      border-radius: 8px; cursor: pointer; user-select: none;
    }
    .row:hover { background: var(--surface-hover, #eee); }
    .row.busy { opacity: 0.55; pointer-events: none; }
    .row input { width: 16px; height: 16px; margin: 0; accent-color: var(--brand-purple, #ab68ff); cursor: pointer; flex: none; }
    .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .state {
      flex: none; border: 0; cursor: pointer; font: inherit; font-size: 10.5px; line-height: 1.5;
      border-radius: 6px; padding: 1px 7px;
    }
    .state.on { color: #15803d; background: rgba(34, 197, 94, 0.16); }
    .state.off { color: #b45309; background: rgba(245, 158, 11, 0.16); }
    .state:hover { filter: brightness(1.15); outline: 1px solid currentColor; }
    .edit {
      flex: none; border: 0; background: transparent; color: var(--text-secondary, #555);
      cursor: pointer; border-radius: 6px; padding: 0 5px; font-size: 14px; line-height: 1.4;
    }
    .edit:hover { background: var(--surface-active, #ddd); color: var(--text-primary, #111); }
    .foot { display: flex; align-items: center; gap: 10px; padding: 8px 12px; }
    .foot label {
      display: flex; align-items: center; gap: 6px; flex: 1;
      color: var(--text-secondary, #555); font-size: 12px; cursor: pointer;
    }
    .foot label input { margin: 0; accent-color: var(--brand-purple, #ab68ff); }
    .btn {
      border: 1px solid var(--border-medium, #ccc); background: var(--surface-secondary, #f7f7f7);
      color: var(--text-primary, #111); border-radius: 999px; padding: 4px 10px; font-size: 12px; cursor: pointer;
    }
    .btn:hover { background: var(--surface-hover, #eee); }
    .btn:disabled { opacity: 0.5; cursor: default; }
    .status { padding: 0 12px 8px; font-size: 11.5px; color: var(--text-tertiary, #777); min-height: 20px; }
    .status.err { color: #dc2626; }
    .empty { padding: 14px 12px; color: var(--text-tertiary, #777); }
    .presets { padding: 0 12px 8px; }
    .phead { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
    .ptitle { font-weight: 600; font-size: 12.5px; flex: 1; }
    .mini {
      border: 1px solid var(--border-light, #ddd); background: transparent; color: var(--text-secondary, #555);
      border-radius: 999px; padding: 1px 8px; font: inherit; font-size: 11.5px; line-height: 1.5; cursor: pointer; flex: none;
    }
    .mini:hover { background: var(--surface-hover, #eee); color: var(--text-primary, #111); }
    .mini:disabled { opacity: 0.5; cursor: default; }
    .mini.danger { color: #dc2626; border-color: currentColor; }
    .pbody { max-height: 30vh; overflow: auto; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip {
      display: inline-flex; align-items: center; gap: 6px; max-width: 100%;
      border: 1px solid var(--border-medium, #ccc); background: var(--surface-secondary, #f7f7f7);
      color: var(--text-primary, #111); border-radius: 999px; padding: 3px 10px;
      font: inherit; font-size: 12.5px; cursor: pointer;
    }
    .chip:hover { background: var(--surface-hover, #eee); }
    .chip .cn { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chip .n { flex: none; font-size: 10.5px; color: var(--text-tertiary, #777); }
    .chip.on { border-color: var(--brand-purple, #ab68ff); background: rgba(171, 104, 255, 0.18); }
    .chip.on .n { color: inherit; }
    .chip.warn .n { color: #b45309; }
    .pnone { color: var(--text-tertiary, #777); font-size: 11.5px; }
    .prow, .pnew { display: flex; align-items: center; gap: 6px; }
    .prow + .prow { margin-top: 4px; }
    .pnew { margin-top: 6px; }
    .pnew[hidden] { display: none; }
    .txt {
      flex: 1; min-width: 0; border: 1px solid var(--border-medium, #ccc); border-radius: 8px; padding: 3px 8px;
      background: var(--surface-secondary, #f7f7f7); color: var(--text-primary, #111); font: inherit; font-size: 12.5px;
    }
    .txt:focus { outline: 2px solid var(--brand-purple, #ab68ff); outline-offset: -1px; }
    .pop.busy .presets, .pop.busy .list, .pop.busy .foot { pointer-events: none; opacity: 0.6; }
  `;

  let host = null;
  let shadow = null;
  let pop = null;
  let listEl = null;
  let statusEl = null;
  let soloEl = null;
  let clearBtn = null;
  let pillEl = null;
  let pbodyEl = null;
  let pnewEl = null;
  let pnameEl = null;
  let psaveBtn = null;
  let peditBtn = null;
  let editingPresets = false;
  let busy = false; // a preset switch is running

  /** In-memory model. */
  let skills = []; // summaries from GET /api/skills
  let states = {}; // per-user switch overrides: { [skillId]: boolean }
  let me = null; // current user id, for the "owned skills default to on" rule
  let defaultActiveOnShare = false; // admin default for skills shared with you
  let loading = false;

  function isSolo() {
    try {
      return localStorage.getItem(SOLO_KEY) === '1';
    } catch {
      return false;
    }
  }
  function setSolo(v) {
    try {
      localStorage.setItem(SOLO_KEY, v ? '1' : '0');
    } catch {
      /* private mode etc. */
    }
  }

  function labelOf(s) {
    return (s.displayTitle && s.displayTitle.trim()) || s.name;
  }

  function activeSkills() {
    return skills.filter((s) => s.alwaysApply === true);
  }

  /** Mirrors the server's resolveSkillActive precedence. */
  function isEnabled(s) {
    const override = states[s._id];
    if (override !== undefined) return override === true;
    if (s.deployment === true) return true;
    if (me && s.author && String(s.author) === String(me)) return true;
    return defaultActiveOnShare;
  }

  function summary() {
    const active = activeSkills();
    if (active.length === 0) return 'No skills always-applied.';
    const off = active.filter((s) => !isEnabled(s));
    let text = `Always-applied: ${active.map(labelOf).join(', ')}`;
    if (off.length > 0) text += ` (${off.map(labelOf).join(', ')} disabled, so not primed)`;
    return text;
  }

  function setStatus(msg, isErr) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('err', !!isErr);
  }

  /** Update the count badge and active look on the pill. */
  function updatePill() {
    if (!pillEl) return;
    const n = activeSkills().length;
    const count = pillEl.querySelector('.lcss-count');
    if (count) {
      count.textContent = String(n);
      count.hidden = n === 0;
    }
    pillEl.classList.toggle('bg-surface-active', n > 0);
    pillEl.classList.toggle('shadow-md', n > 0);
    pillEl.classList.toggle('bg-surface-chat', n === 0);
    pillEl.classList.toggle('shadow-sm', n === 0);
    const preset = currentPreset();
    const head = preset ? `Styles (preset: ${preset.name})` : 'Styles';
    pillEl.title = n === 0 ? `${head}: no always-applied skills` : `${head}: ${activeSkills().map(labelOf).join(', ')}`;
  }

  /** The first preset whose skills are exactly the ticked ones. */
  function currentPreset() {
    if (skills.length === 0) return null;
    return LCSS.presets.all().find((p) => LCSS.presets.matches(p, skills)) || null;
  }

  function ensureHost() {
    if (host && document.contains(host)) return;
    host = document.createElement('div');
    host.id = 'lcss-host';
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    shadow.appendChild(style);

    pop = document.createElement('div');
    pop.className = 'pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Always-applied skills');
    pop.hidden = true;
    pop.innerHTML = `
      <div class="head">
        <span class="title">Styles</span>
        <span class="sub">always-applied skills</span>
        <button type="button" class="iconbtn refresh" title="Reload list">&#x21bb;</button>
        <button type="button" class="iconbtn close" title="Close">&#x2715;</button>
      </div>
      <div class="hint">Tick = <code>always-apply: true</code> and the skill switched on; untick = both off. Ticked skills are primed into every turn while the chat's Skills badge (or the agent's skills) is on. The small enabled/disabled button flips only the switch.</div>
      <div class="presets">
        <div class="phead">
          <span class="ptitle">Presets</span>
          <button type="button" class="mini psave" title="Save the ticked skills as a preset">+ Save ticked</button>
          <button type="button" class="mini pedit" title="Rename, refill or delete presets">Edit</button>
        </div>
        <div class="pbody"></div>
        <div class="pnew" hidden>
          <input type="text" class="txt pname" maxlength="60" placeholder="Preset name" aria-label="Preset name">
          <button type="button" class="mini pok">Save</button>
          <button type="button" class="mini pcancel">Cancel</button>
        </div>
      </div>
      <div class="list"></div>
      <div class="foot">
        <label><input type="checkbox" class="solo"> One at a time</label>
        <button type="button" class="btn clear">Clear all</button>
      </div>
      <div class="status"></div>
    `;
    shadow.appendChild(pop);

    listEl = pop.querySelector('.list');
    statusEl = pop.querySelector('.status');
    soloEl = pop.querySelector('.solo');
    clearBtn = pop.querySelector('.clear');

    soloEl.checked = isSolo();
    soloEl.addEventListener('change', () => setSolo(soloEl.checked));
    pop.querySelector('.refresh').addEventListener('click', () => load(true));
    pop.querySelector('.close').addEventListener('click', close);
    clearBtn.addEventListener('click', clearAll);

    pbodyEl = pop.querySelector('.pbody');
    pnewEl = pop.querySelector('.pnew');
    pnameEl = pop.querySelector('.pname');
    psaveBtn = pop.querySelector('.psave');
    peditBtn = pop.querySelector('.pedit');
    psaveBtn.addEventListener('click', showNewPreset);
    peditBtn.addEventListener('click', () => {
      editingPresets = !editingPresets;
      renderPresets();
    });
    pop.querySelector('.pok').addEventListener('click', saveNewPreset);
    pop.querySelector('.pcancel').addEventListener('click', hideNewPreset);
    pnameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveNewPreset();
      }
    });
    // Keys typed in the name boxes must not reach LibreChat's window shortcuts
    // (or the QoL extension's arrow keys): from outside the shadow root the
    // target looks like a plain <div>.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      pop.addEventListener(type, (e) => {
        if (e.key !== 'Escape') e.stopPropagation();
      });
    }

    document.body.appendChild(host);
    document.addEventListener('pointerdown', onDocPointerDown, true);
    document.addEventListener('keydown', onDocKeyDown, true);
  }

  function onDocPointerDown(e) {
    if (!pop || pop.hidden) return;
    const path = e.composedPath();
    if (path.includes(pop) || (pillEl && path.includes(pillEl))) return;
    close();
  }
  function onDocKeyDown(e) {
    if (e.key !== 'Escape' || !pop || pop.hidden) return;
    e.stopPropagation();
    // Escape in the new-preset name box cancels the naming, not the popover.
    if (pnewEl && !pnewEl.hidden && e.composedPath()[0] === pnameEl) hideNewPreset();
    else close();
  }

  function position() {
    if (!pillEl || !pop) return;
    const r = pillEl.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - POP_WIDTH - 8));
    pop.style.left = `${left}px`;
    // Cap the popover to the room actually available on the chosen side so
    // the header never leaves the viewport; the list scrolls instead.
    if (r.top > window.innerHeight * 0.45) {
      pop.style.top = '';
      pop.style.bottom = `${window.innerHeight - r.top + 8}px`;
      pop.style.maxHeight = `${Math.max(160, r.top - 16)}px`;
    } else {
      pop.style.bottom = '';
      pop.style.top = `${r.bottom + 8}px`;
      pop.style.maxHeight = `${Math.max(160, window.innerHeight - r.bottom - 16)}px`;
    }
  }

  function render() {
    if (!listEl) return;
    renderPresets();
    listEl.textContent = '';
    if (loading && skills.length === 0) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = 'Loading…';
      listEl.appendChild(d);
      return;
    }
    if (skills.length === 0) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = 'No skills found for this account.';
      listEl.appendChild(d);
      return;
    }
    const sorted = [...skills].sort((a, b) => labelOf(a).localeCompare(labelOf(b), undefined, { sensitivity: 'base' }));
    for (const s of sorted) {
      const row = document.createElement('label');
      row.className = 'row';
      row.dataset.id = s._id;
      row.title = `${s.name}${s.description ? `\n${s.description}` : ''}`;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = s.alwaysApply === true;
      cb.addEventListener('change', () => onToggle(s, cb, row));

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = labelOf(s);

      const on = isEnabled(s);
      const st = document.createElement('button');
      st.type = 'button';
      st.className = `state ${on ? 'on' : 'off'}`;
      st.textContent = on ? 'enabled' : 'disabled';
      st.title = on
        ? 'Skills-panel switch is on. Click to turn only the switch off (always-apply stays as it is).'
        : 'Skills-panel switch is off: not primed and hidden from the $ menu. Click to turn only the switch on.';
      st.addEventListener('click', (e) => {
        // A button inside a <label> must not toggle the checkbox.
        e.preventDefault();
        e.stopPropagation();
        onFlipEnabled(s, row);
      });

      const ed = document.createElement('button');
      ed.type = 'button';
      ed.className = 'edit';
      ed.textContent = '✎';
      ed.title = 'Edit this skill (opens over the chat)';
      ed.setAttribute('aria-label', `Edit ${labelOf(s)}`);
      ed.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        editSkill(s);
      });

      const dl = document.createElement('button');
      dl.type = 'button';
      dl.className = 'edit';
      dl.textContent = '⤓';
      dl.title = 'Download as a zip for claude.ai (Settings → Skills → Upload skill)';
      dl.setAttribute('aria-label', `Download ${labelOf(s)} for claude.ai`);
      dl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        exportSkill(s, row);
      });

      row.appendChild(cb);
      row.appendChild(name);
      row.appendChild(st);
      row.appendChild(dl);
      row.appendChild(ed);
      listEl.appendChild(row);
    }
    clearBtn.disabled = activeSkills().length === 0;
  }

  async function load(showStatus) {
    loading = true;
    if (showStatus) setStatus('Loading…');
    render();
    try {
      const [list, st, user, config] = await Promise.all([
        api.listSkills(),
        api.getSkillStates().catch(() => ({})),
        api.getMe().catch(() => null),
        api.getConfig().catch(() => null),
      ]);
      skills = list;
      states = st || {};
      me = user ? user.id || user._id || null : null;
      const cfgSkills = config && config.interface ? config.interface.skills : undefined;
      defaultActiveOnShare = !!(cfgSkills && typeof cfgSkills === 'object' && cfgSkills.defaultActiveOnShare === true);
      if (showStatus) setStatus(summary());
    } catch (err) {
      setStatus(err.message || String(err), true);
    } finally {
      loading = false;
      render();
      updatePill();
    }
  }

  async function setAlways(skill, value) {
    const saved = await api.setAlwaysApply(skill._id, value);
    skill.alwaysApply = saved.alwaysApply;
    skill.version = saved.version;
  }

  /** Flip the per-user switch, merging into a fresh copy so a toggle made in the Skills panel meanwhile is kept. */
  async function setEnabled(skill, value) {
    const fresh = await api.getSkillStates().catch(() => states);
    const next = Object.assign({}, fresh, { [skill._id]: value });
    states = await api.setSkillStates(next);
  }

  /** One "style" switch: always-apply and the skill's own switch move together. */
  async function setSkillOn(skill, value) {
    await setAlways(skill, value);
    await setEnabled(skill, value);
  }

  async function onToggle(skill, cb, row) {
    const value = cb.checked;
    row.classList.add('busy');
    setStatus(`${value ? 'Turning on' : 'Turning off'} ${labelOf(skill)}…`);
    try {
      await setSkillOn(skill, value);
      if (value && isSolo()) {
        for (const other of activeSkills()) {
          if (other._id === skill._id) continue;
          setStatus(`Turning off ${labelOf(other)}…`);
          await setSkillOn(other, false);
        }
      }
      setStatus(summary());
    } catch (err) {
      cb.checked = !value;
      setStatus(err.message || String(err), true);
    } finally {
      row.classList.remove('busy');
      render();
      updatePill();
    }
  }

  async function onFlipEnabled(skill, row) {
    const value = !isEnabled(skill);
    row.classList.add('busy');
    setStatus(`${value ? 'Enabling' : 'Disabling'} ${labelOf(skill)}…`);
    try {
      await setEnabled(skill, value);
      setStatus(
        value
          ? `${labelOf(skill)} enabled: back in the $ menu${skill.alwaysApply ? ' and primed every turn' : ''}.`
          : `${labelOf(skill)} disabled: not primed and hidden from the $ menu.`,
      );
    } catch (err) {
      setStatus(err.message || String(err), true);
    } finally {
      row.classList.remove('busy');
      render();
      updatePill();
    }
  }

  async function clearAll() {
    const active = activeSkills();
    if (active.length === 0) return;
    clearBtn.disabled = true;
    try {
      for (const s of active) {
        setStatus(`Turning off ${labelOf(s)}…`);
        await setSkillOn(s, false);
      }
      setStatus(summary());
    } catch (err) {
      setStatus(err.message || String(err), true);
    } finally {
      render();
      updatePill();
    }
  }

  /* ---------- presets ---------- */

  function presetTitle(preset) {
    if (skills.length === 0) return preset.skills.map((e) => e.name || e.id).join(', ');
    const { found, missing } = LCSS.presets.resolve(preset, skills);
    let t = found.length ? found.map(labelOf).join(', ') : 'No skills: switching here turns every style off';
    if (missing.length) t += `\nNo longer exists: ${missing.map((e) => e.name || e.id).join(', ')}`;
    return t;
  }

  function renderPresets() {
    if (!pbodyEl) return;
    const all = LCSS.presets.all();
    pbodyEl.textContent = '';
    peditBtn.textContent = editingPresets ? 'Done' : 'Edit';
    peditBtn.hidden = all.length === 0 && !editingPresets;
    if (all.length === 0) {
      editingPresets = false;
      const d = document.createElement('div');
      d.className = 'pnone';
      d.textContent = 'None yet. Tick the styles you want together, then + Save ticked.';
      pbodyEl.appendChild(d);
      return;
    }
    if (editingPresets) {
      for (const p of all) pbodyEl.appendChild(presetEditRow(p));
      return;
    }
    const chips = document.createElement('div');
    chips.className = 'chips';
    const cur = currentPreset();
    for (const p of all) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      const missing = skills.length ? LCSS.presets.resolve(p, skills).missing.length : 0;
      const n = p.skills.length - missing;
      b.classList.toggle('on', cur === p);
      b.classList.toggle('warn', missing > 0);
      b.title = `${cur === p ? 'Current preset' : 'Switch to this preset'}:\n${presetTitle(p)}`;
      const name = document.createElement('span');
      name.className = 'cn';
      name.textContent = p.name;
      const count = document.createElement('span');
      count.className = 'n';
      count.textContent = missing ? `${n} ⚠` : String(n);
      b.appendChild(name);
      b.appendChild(count);
      b.addEventListener('click', () => applyPreset(p));
      chips.appendChild(b);
    }
    pbodyEl.appendChild(chips);
  }

  function presetEditRow(p) {
    const row = document.createElement('div');
    row.className = 'prow';
    row.title = presetTitle(p);

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'txt';
    name.maxLength = 60;
    name.value = p.name;
    name.setAttribute('aria-label', `Rename ${p.name}`);
    const commit = async () => {
      const v = name.value.trim();
      if (!v || v === p.name) {
        name.value = p.name;
        return;
      }
      await LCSS.presets.rename(p.id, v);
      setStatus(`Renamed to "${v}".`);
      updatePill();
    };
    name.addEventListener('change', commit);
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        name.blur();
      }
    });

    const refill = document.createElement('button');
    refill.type = 'button';
    refill.className = 'mini';
    refill.textContent = 'Use ticked';
    refill.title = "Replace this preset's skills with the ones ticked below";
    refill.addEventListener('click', async () => {
      const active = activeSkills();
      await LCSS.presets.setSkills(p.id, active);
      setStatus(`"${p.name}" now holds: ${active.length ? active.map(labelOf).join(', ') : 'nothing (all styles off)'}.`);
      renderPresets();
      updatePill();
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'mini';
    del.textContent = 'Delete';
    let armed = 0;
    del.addEventListener('click', async () => {
      if (!armed) {
        del.textContent = 'Sure?';
        del.classList.add('danger');
        armed = setTimeout(() => {
          armed = 0;
          del.textContent = 'Delete';
          del.classList.remove('danger');
        }, 3000);
        return;
      }
      clearTimeout(armed);
      await LCSS.presets.remove(p.id);
      setStatus(`Deleted "${p.name}". The skills themselves are untouched.`);
      renderPresets();
      updatePill();
    });

    row.appendChild(name);
    row.appendChild(refill);
    row.appendChild(del);
    return row;
  }

  function showNewPreset() {
    pnewEl.hidden = false;
    const cur = currentPreset();
    pnameEl.value = cur ? cur.name : '';
    pnameEl.focus();
    pnameEl.select();
    const active = activeSkills();
    setStatus(active.length ? `Will hold: ${active.map(labelOf).join(', ')}.` : 'Nothing is ticked: this preset will turn every style off.');
  }

  function hideNewPreset() {
    pnewEl.hidden = true;
    setStatus(summary());
  }

  async function saveNewPreset() {
    const name = pnameEl.value.trim() || `Preset ${LCSS.presets.all().length + 1}`;
    const active = activeSkills();
    const { replaced } = await LCSS.presets.saveAs(name, active);
    pnewEl.hidden = true;
    setStatus(
      `${replaced ? 'Updated' : 'Saved'} "${name}": ${active.length ? active.map(labelOf).join(', ') : 'no skills (all styles off)'}.`,
    );
    renderPresets();
    updatePill();
  }

  /**
   * Switch to a preset: untick everything ticked that is not in it (first, so
   * LibreChat's cap of 20 always-apply skills is never hit midway), tick what
   * is missing, then write every switch change in one go.
   */
  async function applyPreset(preset) {
    if (busy) return;
    busy = true;
    pop.classList.add('busy');
    const plan = LCSS.presets.plan(preset, skills, isEnabled);
    const total = plan.turnOff.length + plan.turnOn.length;
    const errors = [];
    let done = 0;
    const step = async (s, value) => {
      setStatus(`Switching to "${preset.name}"… ${done + 1}/${total}: ${value ? 'on' : 'off'} ${labelOf(s)}`);
      try {
        await setAlways(s, value);
      } catch (err) {
        errors.push(`${labelOf(s)}: ${err.message || err}`);
      }
      done++;
    };
    try {
      for (const s of plan.turnOff) await step(s, false);
      for (const s of plan.turnOn) await step(s, true);

      const flips = {};
      for (const s of plan.turnOff) if (s.alwaysApply !== true) flips[s._id] = false;
      for (const s of plan.found) if (s.alwaysApply === true && !isEnabled(s)) flips[s._id] = true;
      if (Object.keys(flips).length) {
        const fresh = await api.getSkillStates().catch(() => states);
        states = await api.setSkillStates(Object.assign({}, fresh, flips));
      }

      let msg = errors.length ? `Switched to "${preset.name}" with errors. ` : `Switched to "${preset.name}". `;
      const sum = summary();
      msg += sum.endsWith('.') ? sum : `${sum}.`;
      if (plan.missing.length) msg += ` Not found: ${plan.missing.map((e) => e.name || e.id).join(', ')}.`;
      if (errors.length) msg += ` Failed: ${errors.join('; ')}`;
      setStatus(msg, errors.length > 0);
    } catch (err) {
      setStatus(err.message || String(err), true);
    } finally {
      busy = false;
      pop.classList.remove('busy');
      render();
      updatePill();
    }
  }

  function open() {
    ensureHost();
    pop.hidden = false;
    pnewEl.hidden = true;
    editingPresets = false;
    position();
    LCSS.presets.load().then(() => {
      renderPresets();
      updatePill();
    });
    load(true);
  }
  function close() {
    if (pop) pop.hidden = true;
  }
  function toggle() {
    if (!pop || pop.hidden) open();
    else close();
  }

  /**
   * ✎ — opens the skill in LibreChat's in-chat editor overlay where the
   * app has one (the author's skill-editor-overlay patch), which answers a cancelable
   * `librechat:edit-skill` event and flags itself with
   * <html data-lc-skill-editor="1">. A stock build has no overlay, so fall
   * back to the Skills page in a new tab rather than navigating the chat away.
   */
  function editSkill(skill) {
    if (document.documentElement.dataset.lcSkillEditor === '1') {
      const ev = new CustomEvent('librechat:edit-skill', {
        detail: { skillId: skill._id },
        cancelable: true,
      });
      if (!window.dispatchEvent(ev)) {
        close();
        return;
      }
    }
    window.open(`/skills/${skill._id}/edit`, '_blank', 'noopener');
  }

  /** ⤓ — read-only: zips the skill for claude.ai and hands it to the browser's downloads. */
  async function exportSkill(skill, row) {
    row.classList.add('busy');
    setStatus(`Packing ${labelOf(skill)}…`);
    try {
      const z = await LCSS.exporter.downloadSkill(skill._id);
      const extra = z.fileCount ? ` + ${z.fileCount} file${z.fileCount === 1 ? '' : 's'}` : '';
      const warn = z.warnings.length ? ` Check first: ${z.warnings.join('; ')}.` : '';
      setStatus(`Saved ${z.filename} (SKILL.md${extra}). Upload it on claude.ai under Settings → Skills.${warn}`, z.warnings.length > 0);
    } catch (err) {
      setStatus(err.message || String(err), true);
    } finally {
      row.classList.remove('busy');
    }
  }

  /** An edit in the overlay can flip `always-apply:`, so re-read the count when it closes. */
  window.addEventListener('librechat:skill-editor-closed', () => {
    if (pop && !pop.hidden) load(false);
    else primeCount();
  });

  /** main.js hands over the pill once it exists in the composer. */
  function attachPill(el) {
    pillEl = el;
    updatePill();
  }

  /** Silent initial fetch so the pill shows the right count on page load. */
  async function primeCount() {
    try {
      await LCSS.presets.load();
      skills = await api.listSkills();
      updatePill();
    } catch {
      /* not logged in yet, or offline: the popover will show the error on open */
    }
  }

  LCSS.ui = { open, close, toggle, attachPill, position, primeCount, refresh: () => load(false) };
})();

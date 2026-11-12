/**
 * PILLS — boot, SPA route watching, DOM observation and placement of the
 * composer pills (Styles, Prefill, Prompts, and any other pill module that is
 * part of the build).
 *
 * LibreChat is a react-router SPA: URL changes never reload the page, and
 * the composer re-renders freely. So we (re)insert the pills whenever the
 * DOM changes, idempotently, and keep the same nodes so their listeners live.
 *
 * Placement (client/src/components/Chat/Input/BadgeRow.tsx): the composer
 * form contains a badge row `div.relative.flex.flex-wrap.items-center.gap-2`
 * whose badges sit in `.badge-icon` wrappers. The Styles pill is appended
 * there, before the drag "ghost" placeholder when present, and every other
 * pill sits right after the one before it in EXTRA. When there is no badge
 * row (a layout change) the pills float bottom-right.
 */
(() => {
  const LCSS = window.LCSS;
  const PILL_ID = 'lcss-pill';

  const PIN_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';

  /** The Styles pill, then the others in order; a module that is not in this build is skipped. */
  const styles = { pill: null, wrap: 'lcss-wrap', floating: 'lcss-floating' };
  const EXTRA = [
    { mod: LCSS.prefill, pill: null, wrap: 'lcpf-wrap', floating: 'lcpf-floating' },
    { mod: LCSS.prompts, pill: null, wrap: 'lcpr-wrap', floating: 'lcpr-floating' },
  ].filter((item) => item.mod);
  const MODULES = [LCSS.ui, ...EXTRA.map((item) => item.mod)];

  let lastHref = location.href;
  let scheduled = false;

  function buildPill() {
    const b = document.createElement('button');
    b.id = PILL_ID;
    b.type = 'button';
    b.setAttribute('aria-label', 'Styles: choose always-applied skills');
    b.setAttribute('aria-haspopup', 'dialog');
    // LibreChat's Badge utility classes for colours/border/shadow so it matches
    // the theme natively; the box layout itself comes from page-styles.css
    // (the Badge's own `px-4` + `size-9` combination leaves a 2px content box
    // in icon-only mode, which squashes a flex-shrinkable svg to nothing).
    b.className =
      'relative rounded-full border border-border-medium text-sm font-medium transition-shadow bg-surface-chat shadow-sm hover:bg-surface-hover hover:shadow-md active:scale-95';
    b.innerHTML = PIN_SVG + '<span class="lcss-label">Styles</span>' + '<span class="lcss-count" hidden>0</span>';
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      LCSS.ui.toggle();
    });
    return b;
  }

  function findBadgeRow() {
    const ta = document.querySelector('textarea[data-testid="text-input"]');
    const form = ta && ta.closest('form');
    if (!form) return null;
    const anyBadge = form.querySelector('.badge-icon');
    if (anyBadge && anyBadge.parentElement) return anyBadge.parentElement;
    return form.querySelector('div.flex.flex-wrap.items-center.gap-2');
  }

  const wrapOf = (item) =>
    item.pill.parentElement && item.pill.parentElement.classList.contains(item.wrap) ? item.pill.parentElement : null;

  function ensurePill() {
    if (!styles.pill) {
      styles.pill = buildPill();
      LCSS.ui.attachPill(styles.pill);
    }
    const pill = styles.pill;
    const row = findBadgeRow();
    if (row) {
      const wrap = wrapOf(styles);
      if (wrap && wrap.parentElement === row) return; // already in place
      const w = wrap || document.createElement('div');
      w.className = 'badge-icon h-full lcss-wrap';
      w.appendChild(pill);
      pill.classList.remove(styles.floating);
      const ghost = row.querySelector('.ghost-badge');
      if (ghost) row.insertBefore(w, ghost);
      else row.appendChild(w);
    } else {
      if (pill.classList.contains(styles.floating) && document.body.contains(pill)) return;
      if (wrapOf(styles)) pill.parentElement.remove();
      pill.classList.add(styles.floating);
      document.body.appendChild(pill);
    }
    let prev = styles;
    for (const item of EXTRA) {
      ensureAfter(item, prev, row);
      prev = item;
    }
    MODULES.forEach((mod) => mod.position());
  }

  /** Puts `item`'s pill right after `prev`'s in the badge row, or floats it when there is no row. */
  function ensureAfter(item, prev, row) {
    if (!item.pill) item.pill = item.mod.buildPill();
    const pill = item.pill;
    const prevWrap = wrapOf(prev);
    if (row && prevWrap) {
      const wrap = wrapOf(item);
      if (wrap && wrap.parentElement === row && wrap.previousElementSibling === prevWrap) return;
      const w = wrap || document.createElement('div');
      w.className = `badge-icon h-full ${item.wrap}`;
      w.appendChild(pill);
      pill.classList.remove(item.floating);
      prevWrap.after(w);
    } else {
      if (pill.classList.contains(item.floating) && document.body.contains(pill)) return;
      if (wrapOf(item)) pill.parentElement.remove();
      pill.classList.add(item.floating);
      document.body.appendChild(pill);
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      ensurePill();
    });
  }

  function onRouteMaybeChanged() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    MODULES.forEach((mod) => mod.close());
    schedule();
  }

  function boot() {
    // Reloading the extension from chrome://extensions leaves the previous
    // copy's pills and popovers behind in tabs that stayed open (so does the
    // old, separate Skill Styles extension). Sweep them so the composer never
    // shows a pill twice.
    document
      .querySelectorAll(
        '#lcss-pill, #lcss-host, .lcss-wrap, #lcpf-pill, #lcpf-host, .lcpf-wrap, #lcpr-pill, #lcpr-host, .lcpr-wrap',
      )
      .forEach((el) => el.remove());
    ensurePill();
    LCSS.ui.primeCount();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    setInterval(onRouteMaybeChanged, 500);
    window.addEventListener('resize', () => MODULES.forEach((mod) => mod.position()));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

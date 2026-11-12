/**
 * MAIN — boot, SPA route watching, DOM observation.
 *
 * LibreChat is a react-router SPA: URL changes never reload the page. A 500ms
 * href poll is the sturdiest cross-realm way to notice navigation from an
 * isolated content-script world (patching history.pushState only patches this
 * realm's binding, not the page's).
 */
(() => {
  'use strict';

  const LCBM = window.LCBM;
  const { adapter, ui, branchKeys, deeplink, promptLink, treeView, hotkeys, skillCalls, theme } = LCBM;

  let lastHref = '';
  let debounceTimer = null;

  function injectAll() {
    ui.injectButtons();
    branchKeys.inject();
    /** not part of every build */
    if (promptLink) promptLink.inject();
  }

  function onDomChanged() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (adapter.isChatPage()) {
        injectAll();
        skillCalls.onDomChanged();
      }
    }, 250);
  }

  function onRouteMaybeChanged() {
    if (location.href === lastHref) return;
    /** take() strips #lcjump from the URL; read href after it so that strip
     *  is not mistaken for a second route change. */
    const linkedId = deeplink.take();
    lastHref = location.href;
    ui.updateBadge();
    /** Also off chat pages: it is what hides the pill when you leave one. */
    branchKeys.onRoute();
    treeView.onRoute();
    /** Also off chat pages: it hides the counter button there. */
    skillCalls.onRoute();
    if (adapter.isChatPage()) {
      injectAll();
      ui.renderList();
      /** Fire-and-forget: it waits for render and no-ops when already newest. */
      if (linkedId) ui.jumpFromLink(adapter.getConversationId(), linkedId);
      else ui.maybeAutoJump(adapter.getConversationId());
    }
  }

  function boot() {
    ui.ensureShadowUI();
    treeView.init();
    hotkeys.init();
    skillCalls.init();
    theme.boot();
    ui.updateBadge();

    const observer = new MutationObserver(onDomChanged);
    observer.observe(document.body, { childList: true, subtree: true });

    setInterval(onRouteMaybeChanged, 500);
    onRouteMaybeChanged();
    if (adapter.isChatPage()) injectAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

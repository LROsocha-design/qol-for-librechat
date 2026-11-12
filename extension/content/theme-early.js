/**
 * THEME-EARLY — runs at document_start and puts the saved theme's CSS on the
 * page before LibreChat paints, so the stock colors never flash. theme.js
 * (document_idle) writes that CSS to localStorage on every change and takes
 * the <style> element over once it has loaded.
 */
(() => {
  'use strict';
  try {
    const css = localStorage.getItem('lcbm.theme.css');
    if (!css) return;
    const style = document.createElement('style');
    style.id = 'lcbm-theme-style';
    style.textContent = css;
    document.documentElement.appendChild(style);
  } catch {
    /* no storage access: theme.js applies the theme a moment later */
  }
})();

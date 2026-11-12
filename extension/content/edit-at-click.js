/**
 * EDIT-AT-CLICK — Alt+Click a word (or a selection) in a message to edit
 * exactly there.
 *
 * Problem this solves: LibreChat's edit button sits at the BOTTOM of a message,
 * and its editor slams the caret to the end of the text on open
 * (EditTextPart.tsx: `textArea.setSelectionRange(length, length)`), the same
 * behavior SillyTavern has. Editing one line of a long post means: hunt for the
 * line, scroll down to the button, scroll back up, hunt again.
 *
 * With this: select some text (or don't) and Alt+Click it -> edit mode opens ->
 * the same text is selected in the editor and sits at the same height on
 * screen it had before, so neither the view nor your place jumps.
 *
 * The tricky part is that the text you click is RENDERED markdown while the
 * editor holds RAW markdown ("*sighs*" renders as "sighs"), and a reply with
 * thinking opens several editors (one per thinking/text part). Both sides are
 * reduced to letters and digits (lowercased) with an index map back to raw
 * offsets; every occurrence in every editor is then scored by how much of the
 * surrounding rendered text matches around it, and the best one wins.
 */
(() => {
  'use strict';

  const LCBM = (window.LCBM = window.LCBM || {});
  const { adapter } = LCBM;

  const EDITOR_WAIT_MS = 4000;
  /** Longest wait for LibreChat's mount effect (focus + caret to the end),
   *  which must run before we select, or it overwrites the selection. */
  const MOUNT_FOCUS_WAIT_MS = 300;
  /** Normalized characters compared on each side when scoring a match. */
  const CONTEXT_CHARS = 200;
  /** A match with less surrounding agreement than this is a guess; refuse it
   *  (unless the target only occurs once anywhere). */
  const MIN_CONTEXT = 6;
  /** A selection that doesn't match whole is matched by its two ends. */
  const ANCHOR_CHARS = 32;
  /** Click tolerance around a selection's rectangles. */
  const HIT_SLOP_PX = 6;
  /** Later re-placements, for late autosize/font reflow. */
  const SETTLE_DELAYS_MS = [50, 200, 500];

  /** Rendered content parts: a thinking block or a text part. In edit mode
   *  ContentParts.tsx gives each of them its own editor, in the same order. */
  const PART_SEL = '.group\\/reasoning, .message-content';
  /** Markdown syntax allowed between a match and its edge punctuation. */
  const MD_SYNTAX = /[*_`~]/;
  const KEEP = /[\p{L}\p{N}]/u;

  const MIRROR_PROPS = [
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontStretch',
    'letterSpacing', 'wordSpacing', 'lineHeight', 'textTransform', 'textIndent',
    'tabSize', 'wordBreak', 'overflowWrap', 'direction',
  ];

  const toast = (msg, opts) => LCBM.ui && LCBM.ui.toast && LCBM.ui.toast(msg, opts);
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  // ---------------------------------------------------------------------------
  // Text matching (pure; exported for tests)
  // ---------------------------------------------------------------------------

  /**
   * Letters and digits only, lowercased, plus a map from each normalized
   * character back to its index in the source string. Everything else
   * (markdown syntax, list markers, punctuation, whitespace, paragraph breaks
   * that rendered text doesn't have) drops out on both sides.
   */
  function normalizeWithMap(source) {
    let text = '';
    const map = [];
    for (let i = 0; i < source.length; ) {
      const ch = String.fromCodePoint(source.codePointAt(i));
      if (KEEP.test(ch)) {
        const lower = ch.toLowerCase();
        text += lower;
        for (let k = 0; k < lower.length; k++) map.push(i);
      }
      i += ch.length;
    }
    return { text, map };
  }

  const normalize = (s) => normalizeWithMap(s).text;

  /**
   * Word boundaries around `offset` in `text`. Null if not on a word.
   *
   * Letters/digits/apostrophes/hyphens only — deliberately excludes trailing
   * punctuation so clicking "sighed." selects `sighed`, not `sighed.` (which
   * in raw markdown could drag in an adjacent `*` and look like a mis-hit).
   */
  function wordAt(text, offset) {
    const isWord = (ch) => ch != null && /[\p{L}\p{N}'’\-]/u.test(ch);
    if (!isWord(text[offset]) && !isWord(text[offset - 1])) return null;
    let start = offset;
    let end = offset;
    while (start > 0 && isWord(text[start - 1])) start--;
    while (end < text.length && isWord(text[end])) end++;
    if (end <= start) return null;
    return { start, end, word: text.slice(start, end) };
  }

  /** Length of the common run ending at a[aEnd) and b[bEnd), up to `cap`. */
  function commonSuffix(a, aEnd, b, bEnd, cap) {
    let k = 0;
    while (k < cap && aEnd - k > 0 && bEnd - k > 0 && a[aEnd - 1 - k] === b[bEnd - 1 - k]) k++;
    return k;
  }

  /** Length of the common run starting at a[aStart] and b[bStart], up to `cap`. */
  function commonPrefix(a, aStart, b, bStart, cap) {
    let k = 0;
    while (k < cap && aStart + k < a.length && bStart + k < b.length && a[aStart + k] === b[bStart + k]) k++;
    return k;
  }

  /**
   * Find the target in the editors' normalized texts.
   * probe: { seg, before, after } — normalized target and the normalized
   * rendered text of its part on either side.
   * hint: index of the editor that should hold it (breaks ties), or -1.
   * Returns { editor, start, end } in normalized coordinates, or null.
   */
  function locate(texts, probe, hint = -1) {
    const { seg, before, after } = probe;
    if (!seg) return null;

    const better = (cand, best) =>
      !best || cand.score > best.score || (cand.score === best.score && cand.editor === hint && best.editor !== hint);

    /** 1. The whole target, scored by the context on both sides. */
    let best = null;
    let count = 0;
    texts.forEach((T, editor) => {
      for (let at = T.indexOf(seg); at !== -1; at = T.indexOf(seg, at + 1)) {
        count++;
        const end = at + seg.length;
        const score =
          commonSuffix(before, before.length, T, at, CONTEXT_CHARS) + commonPrefix(after, 0, T, end, CONTEXT_CHARS);
        const cand = { editor, start: at, end, score };
        if (better(cand, best)) best = cand;
      }
    });
    if (best) {
      const needed = Math.min(MIN_CONTEXT, before.length + after.length);
      return best.score >= needed || count === 1 ? { editor: best.editor, start: best.start, end: best.end } : null;
    }

    /** 2. Not found whole (a link URL, list numbers, a footnote inside it):
     *  find its head by the context before it, then its tail after that. */
    const n = Math.min(ANCHOR_CHARS, Math.floor(seg.length / 2));
    if (n < 4) return null;
    const head = seg.slice(0, n);
    let bestHead = null;
    texts.forEach((T, editor) => {
      for (let at = T.indexOf(head); at !== -1; at = T.indexOf(head, at + 1)) {
        const score =
          commonSuffix(before, before.length, T, at, CONTEXT_CHARS) + commonPrefix(seg, 0, T, at, seg.length);
        const cand = { editor, start: at, score };
        if (better(cand, bestHead)) bestHead = cand;
      }
    });
    if (!bestHead) return null;

    const T = texts[bestHead.editor];
    const h = bestHead.start;
    const reach = h + Math.ceil(seg.length * 1.5) + 200;
    for (let len = n; len >= 3; len = len > 3 ? Math.max(3, Math.ceil(len / 2)) : 0) {
      const tail = seg.slice(-len);
      let bestTail = null;
      for (let at = T.indexOf(tail, h + n); at !== -1 && at <= reach; at = T.indexOf(tail, at + 1)) {
        const end = at + len;
        const score =
          commonPrefix(after, 0, T, end, CONTEXT_CHARS) + commonSuffix(seg, seg.length, T, end, seg.length);
        if (!bestTail || score > bestTail.score) bestTail = { end, score };
      }
      if (bestTail) return { editor: bestHead.editor, start: h, end: bestTail.end };
      if (len === 3) break;
    }
    /** No tail (e.g. the selection ran into the next part): as far as it matches. */
    return { editor: bestHead.editor, start: h, end: h + Math.max(n, commonPrefix(seg, 0, T, h, seg.length)) };
  }

  /**
   * Which editor holds the clicked part. Chain replies in compare mode carry
   * two near-identical versions of a scene (draft + corrected copy), so a
   * click where both read the same for a long stretch ties on context; the
   * part's whole text decides then. If several editors look equally like it
   * (identical versions), the Nth such part maps to the Nth such editor.
   */
  function pickHint(texts, probe) {
    if (!probe.partText) return texts.length === probe.partCount ? probe.partIndex : -1;
    const P = probe.partText;
    const scores = texts.map((T) =>
      T === P
        ? Infinity
        : commonPrefix(P, 0, T, 0, P.length) + commonSuffix(P, P.length, T, T.length, P.length) - Math.abs(T.length - P.length),
    );
    const top = Math.max(...scores);
    const tied = scores.map((s, i) => (s === top ? i : -1)).filter((i) => i !== -1);
    return tied[Math.min(probe.partRank || 0, tied.length - 1)];
  }

  /** Raw index just past the character that starts at `i`. */
  function rawEndAt(raw, i) {
    return i + (raw.codePointAt(i) > 0xffff ? 2 : 1);
  }

  /**
   * Grow a raw [start, end) over the punctuation the rendered selection had at
   * its edges (`said, “go.”` keeps its `.”`), stepping over markdown syntax in
   * between, but never ending on a stray `*` it didn't need.
   */
  function extendEdges(raw, start, end, segText) {
    const lead = ((segText.match(/^[^\p{L}\p{N}]+/u) || [''])[0]).replace(/\s+/g, '');
    const trail = ((segText.match(/[^\p{L}\p{N}]+$/u) || [''])[0]).replace(/\s+/g, '');

    let e = end;
    for (let i = end, k = 0; k < trail.length && i < raw.length; ) {
      if (raw[i] === trail[k]) {
        i++;
        k++;
        e = i;
      } else if (MD_SYNTAX.test(raw[i])) i++;
      else break;
    }

    let s = start;
    for (let i = start, k = lead.length - 1; k >= 0 && i > 0; ) {
      if (raw[i - 1] === lead[k]) {
        i--;
        k--;
        s = i;
      } else if (MD_SYNTAX.test(raw[i - 1])) i--;
      else break;
    }
    return { start: s, end: e };
  }

  // ---------------------------------------------------------------------------
  // Rendered side: what was clicked or selected
  // ---------------------------------------------------------------------------

  /** Text node + offset under a point, or null. */
  function caretAt(x, y) {
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      return r ? { node: r.startContainer, offset: r.startOffset } : null;
    }
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      return p ? { node: p.offsetNode, offset: p.offset } : null;
    }
    return null;
  }

  /** Range over the word under the point, or null. */
  function wordRangeAt(messageEl, x, y) {
    const caret = caretAt(x, y);
    if (!caret || caret.node.nodeType !== Node.TEXT_NODE || !messageEl.contains(caret.node)) return null;
    const hit = wordAt(caret.node.data, caret.offset);
    if (!hit) return null;
    const range = document.createRange();
    range.setStart(caret.node, hit.start);
    range.setEnd(caret.node, hit.end);
    return range;
  }

  /** The page selection, if it lies inside this message and holds any text. */
  function selectionIn(messageEl) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    if (!messageEl.contains(range.startContainer) || !messageEl.contains(range.endContainer)) return null;
    if (!normalize(range.toString())) return null;
    return range.cloneRange();
  }

  function pointInRange(range, x, y) {
    for (const r of range.getClientRects()) {
      if (!r.width && !r.height) continue;
      if (
        x >= r.left - HIT_SLOP_PX &&
        x <= r.right + HIT_SLOP_PX &&
        y >= r.top - HIT_SLOP_PX &&
        y <= r.bottom + HIT_SLOP_PX
      ) {
        return true;
      }
    }
    return false;
  }

  /** Screen y of the first line of a range (skips the empty rect a selection
   *  gets at the end of the line before it). */
  function rangeTop(range) {
    for (const r of range.getClientRects()) {
      if (r.width > 0 && r.height > 0) return r.top;
    }
    const b = range.getBoundingClientRect();
    return b.height ? b.top : null;
  }

  /** Outermost thinking/text part holding `node`, else the whole message. */
  function partOf(node, messageEl) {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    const part = el && el.closest(PART_SEL);
    if (!part || !messageEl.contains(part)) return messageEl;
    const outer = part.parentElement && part.parentElement.closest(PART_SEL);
    return outer && messageEl.contains(outer) ? outer : part;
  }

  /**
   * Everything needed to find the target again once the rendered DOM is gone
   * (it's replaced by textareas the moment edit mode opens). Range text uses
   * DOM text throughout, so offsets never mix with innerText's.
   */
  function buildProbe(messageEl, range) {
    const startPart = partOf(range.startContainer, messageEl);
    const endPart = partOf(range.endContainer, messageEl);
    const beforeRange = document.createRange();
    beforeRange.selectNodeContents(startPart);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const afterRange = document.createRange();
    afterRange.selectNodeContents(endPart);
    afterRange.setStart(range.endContainer, range.endOffset);

    const parts = [...messageEl.querySelectorAll(PART_SEL)].filter(
      (p) => !(p.parentElement && p.parentElement.closest(PART_SEL)),
    );
    const segText = range.toString();
    const partIndex = parts.indexOf(startPart);
    const partText = partIndex === -1 ? '' : normalize(startPart.textContent || '');
    return {
      segText,
      seg: normalize(segText),
      before: normalize(beforeRange.toString()).slice(-CONTEXT_CHARS),
      after: normalize(afterRange.toString()).slice(0, CONTEXT_CHARS),
      partText,
      /** How many earlier parts read exactly the same (identical versions). */
      partRank: partText
        ? parts.slice(0, partIndex).filter((p) => normalize(p.textContent || '') === partText).length
        : 0,
      partIndex,
      partCount: parts.length,
      top: rangeTop(range),
    };
  }

  // ---------------------------------------------------------------------------
  // Editor side: select, then put the selection back where it was on screen
  // ---------------------------------------------------------------------------

  /** Nearest ancestor that actually scrolls vertically — LibreChat's message
   *  list is an overflow-y-auto div, not the window. */
  function getScrollParent(el) {
    for (let node = el.parentElement; node; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight + 1) {
        const { overflowY } = getComputedStyle(node);
        if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
          return node;
        }
      }
    }
    return document.scrollingElement || document.documentElement;
  }

  function chatScroller(textarea) {
    return (adapter.getScroller && adapter.getScroller(textarea)) || getScrollParent(textarea);
  }

  /** The part of the screen the chat shows text in: the scroller minus the
   *  header that floats over its top. */
  function viewBand(scroller) {
    if (scroller === document.scrollingElement || scroller === document.documentElement) {
      return { top: 0, bottom: window.innerHeight };
    }
    const r = scroller.getBoundingClientRect();
    const header = adapter.SEL && scroller.matches(adapter.SEL.scroller) ? adapter.HEADER_OVERLAY_PX || 0 : 0;
    return { top: Math.max(r.top, 0) + header, bottom: Math.min(r.bottom, window.innerHeight) };
  }

  /**
   * Pixel offset of the text at `index` from the top of the textarea's
   * scrollable content, measured with an off-screen copy of the textarea
   * (same width, font and wrapping). Textareas don't expose this, and the
   * scrollHeight trick reports the box height for anything near the top.
   */
  function contentYAt(textarea, index) {
    const cs = getComputedStyle(textarea);
    const mirror = document.createElement('div');
    for (const p of MIRROR_PROPS) mirror.style[p] = cs[p];
    Object.assign(mirror.style, {
      position: 'absolute',
      visibility: 'hidden',
      top: '0',
      left: '-99999px',
      boxSizing: 'border-box',
      width: `${textarea.clientWidth}px`,
      border: '0',
      whiteSpace: 'pre-wrap',
    });
    const value = textarea.value;
    const lineEnd = value.indexOf('\n', index);
    mirror.textContent = value.slice(0, index);
    const marker = document.createElement('span');
    /** The rest of the line, so wrapping before the marker matches. */
    marker.textContent = value.slice(index, lineEnd === -1 ? undefined : lineEnd) || '​';
    mirror.appendChild(marker);
    document.body.appendChild(mirror);
    const y = marker.offsetTop;
    mirror.remove();
    return y;
  }

  function lineHeightOf(textarea) {
    return parseFloat(getComputedStyle(textarea).lineHeight) || 24;
  }

  /**
   * Scroll the textarea and the chat so the text at `index` sits at screen
   * height `anchorY` (where it was before edit mode opened), or mid-view when
   * that's unknown or off-screen.
   */
  function placeAt(textarea, index, anchorY) {
    const scroller = chatScroller(textarea);
    const band = viewBand(scroller);
    const line = lineHeightOf(textarea);
    const lo = band.top + line;
    const hi = Math.max(lo, band.bottom - 3 * line);
    const target = clamp(anchorY == null ? (band.top + band.bottom) / 2 : anchorY, lo, hi);

    const contentY = contentYAt(textarea, index);
    const innerMax = textarea.scrollHeight - textarea.clientHeight;
    const screenY = () => textarea.getBoundingClientRect().top + textarea.clientTop + contentY - textarea.scrollTop;

    /** 1. Inside the editor (capped at 65-75vh, so it scrolls): put the text
     *  as far down the box as the target is down the view, so the whole box
     *  fits on screen around it. */
    if (innerMax > 0) {
      const frac = (target - band.top) / Math.max(1, band.bottom - band.top);
      textarea.scrollTop = clamp(contentY - frac * textarea.clientHeight, 0, innerMax);
    }

    /** 2. The chat: bring that line to the target height. */
    scroller.scrollTop += screenY() - target;

    /** 3. The chat hit its top or bottom: make up the rest inside the editor,
     *  without scrolling the text out of the box. */
    const miss = screenY() - target;
    if (innerMax > 0 && Math.abs(miss) > 1) {
      const keepLo = Math.max(0, contentY - textarea.clientHeight + 2 * line);
      const keepHi = Math.min(innerMax, contentY);
      if (keepLo <= keepHi) {
        textarea.scrollTop = clamp(textarea.scrollTop + miss, keepLo, keepHi);
      }
    }
  }

  function selectIn(textarea, start, end) {
    /** preventScroll: we do all the scrolling ourselves in placeAt. */
    try {
      textarea.focus({ preventScroll: true });
    } catch {
      textarea.focus();
    }
    textarea.setSelectionRange(start, end);
  }

  /**
   * Select, place, then re-place a few times while the editor settles (late
   * autosize/font reflow, or LibreChat's caret-to-end landing after us), but
   * stop as soon as you scroll, type, click, or move the selection.
   */
  function reveal(textarea, start, end, anchorY) {
    selectIn(textarea, start, end);
    placeAt(textarea, start, anchorY);

    let interacted = false;
    const stop = () => {
      interacted = true;
    };
    const kinds = ['wheel', 'keydown', 'mousedown', 'touchstart'];
    kinds.forEach((k) => window.addEventListener(k, stop, { capture: true, passive: true }));
    const last = SETTLE_DELAYS_MS[SETTLE_DELAYS_MS.length - 1];
    for (const ms of SETTLE_DELAYS_MS) {
      setTimeout(() => {
        if (!interacted && textarea.isConnected) {
          const len = textarea.value.length;
          if (textarea.selectionStart === len && textarea.selectionEnd === len && start !== len) {
            selectIn(textarea, start, end);
          }
          if (textarea.selectionStart === start && textarea.selectionEnd === end) {
            placeAt(textarea, start, anchorY);
          }
        }
        if (ms === last) kinds.forEach((k) => window.removeEventListener(k, stop, { capture: true }));
      }, ms);
    }
  }

  /** Wait for edit-mode textareas to appear on a message. */
  function waitForEditors(messageEl, timeoutMs) {
    return new Promise((resolve) => {
      const existing = adapter.getEditors(messageEl);
      if (existing.length) return resolve(existing);
      const t0 = performance.now();
      const tick = () => {
        const editors = adapter.getEditors(messageEl);
        if (editors.length) return resolve(editors);
        if (performance.now() - t0 > timeoutMs) return resolve([]);
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  /**
   * Resolve once LibreChat's mount effect has focused an editor (it then puts
   * the caret at the end). All editors' effects run in one go, so a microtask
   * after the first focus lands after the last. Landing right then, before the
   * browser paints, means the view never visibly jumps.
   */
  function waitForMountFocus(editors) {
    return new Promise((resolve) => {
      if (editors.includes(document.activeElement)) return resolve();
      let timer = 0;
      const finish = () => {
        document.removeEventListener('focusin', onFocus, true);
        clearTimeout(timer);
        resolve();
      };
      const onFocus = (e) => {
        if (editors.includes(e.target)) queueMicrotask(finish);
      };
      document.addEventListener('focusin', onFocus, true);
      timer = setTimeout(finish, MOUNT_FOCUS_WAIT_MS);
    });
  }

  function centerBox(textarea) {
    const scroller = chatScroller(textarea);
    const band = viewBand(scroller);
    const r = textarea.getBoundingClientRect();
    scroller.scrollTop += r.top + Math.min(r.height, band.bottom - band.top) / 2 - (band.top + band.bottom) / 2;
  }

  async function editAt(messageEl, range) {
    /** Build the probe BEFORE entering edit mode — the rendered DOM is
     *  replaced by textareas the moment the edit button is clicked. */
    const probe = buildProbe(messageEl, range);

    let opened = false;
    if (!adapter.isEditing(messageEl)) {
      const btn = adapter.getEditButton(messageEl);
      if (!btn) {
        toast('No edit button on this message (LibreChat UI may have changed).', { error: true });
        return;
      }
      if (btn.disabled) {
        toast('This message cannot be edited right now.', { error: true });
        return;
      }
      btn.click();
      opened = true;
    }

    const editors = await waitForEditors(messageEl, EDITOR_WAIT_MS);
    if (!editors.length) {
      toast('Editor did not open.', { error: true });
      return;
    }
    if (opened) await waitForMountFocus(editors);

    const raws = editors.map((ed) => ed.value || '');
    const norms = raws.map(normalizeWithMap);
    const texts = norms.map((n) => n.text);
    const hit = locate(texts, probe, pickHint(texts, probe));
    if (hit) {
      const raw = raws[hit.editor];
      const { map } = norms[hit.editor];
      const { start, end } = extendEdges(raw, map[hit.start], rawEndAt(raw, map[hit.end - 1]), probe.segText);
      reveal(editors[hit.editor], start, end, probe.top);
      return;
    }

    /** Found the editor but not the text — leave focus somewhere useful. */
    const biggest = editors.reduce((a, b) => ((b.value || '').length > (a.value || '').length ? b : a));
    try {
      biggest.focus({ preventScroll: true });
    } catch {
      biggest.focus();
    }
    centerBox(biggest);
    toast('Opened the editor, but could not pinpoint that text.', { error: true });
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  /** The message an Alt+press/click is aimed at, or null when it isn't ours. */
  function altTarget(e) {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.button !== 0) return null;
    if (!adapter.isChatPage()) return null;
    const target = e.target;
    if (!(target instanceof Element)) return null;
    /** Ignore clicks on controls (our bookmark button, hover actions, links). */
    if (target.closest('button, a, textarea, input, [role="button"]')) return null;
    return target.closest(adapter.SEL.message);
  }

  /** The selection as it was at the Alt+press. */
  let pressed = null;

  function onMouseDown(e) {
    const messageEl = altTarget(e);
    if (!messageEl) {
      pressed = null;
      return;
    }
    pressed = { messageEl, range: selectionIn(messageEl) };
    /** Without this the press collapses the selection before `click` fires.
     *  With nothing selected the press is left alone (Alt+drag still selects). */
    if (pressed.range) e.preventDefault();
  }

  function onClick(e) {
    const messageEl = altTarget(e);
    if (!messageEl) return;
    e.preventDefault();
    e.stopPropagation();

    const selected = pressed && pressed.messageEl === messageEl ? pressed.range : selectionIn(messageEl);
    pressed = null;
    const word = wordRangeAt(messageEl, e.clientX, e.clientY);
    /** Clicking ON the selection edits the selection; clicking a word
     *  elsewhere means that word (the selection is probably stale). */
    const range = selected && (!word || pointInRange(selected, e.clientX, e.clientY)) ? selected : word;
    if (!range) {
      toast('Alt+Click directly on a word, or on selected text, to edit there.', { error: true });
      return;
    }
    editAt(messageEl, range);
  }

  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('click', onClick, true);

  LCBM.editAtClick = { editAt, normalizeWithMap, locate, pickHint, extendEdges, wordAt, contentYAt, placeAt };
})();

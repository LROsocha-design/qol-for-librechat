/**
 * TREE LAYOUT — the pure half of the branch tree (tree-view.js draws it).
 * No DOM here, so `node test/tree-layout.test.cjs` can check it.
 *
 * Three steps:
 *   buildData(messages)    GET /api/messages/:id (createdAt asc) -> a slim
 *                          tree: id, parent, kids, role, 2-line preview. The
 *                          big message objects are dropped right after.
 *   buildVisual(data, o)   what is on screen: folded branches end at their
 *                          node, and dead-end versions at a fork (childless
 *                          siblings, off your branch) fold into one "stack".
 *   layoutVisual(vroot)    x column and row for every visual node.
 *
 * Layout: rows are depths. At each fork the child with the deepest subtree
 * (the "trunk") sits straight under its parent, so the longest line of the
 * chat runs down as one straight spine. The other versions keep LibreChat's
 * "n / m" order: lower versions to the left of the trunk, higher ones to the
 * right. Each sibling subtree is pushed sideways only as far as its own
 * outline (per-row leftmost/rightmost column) needs, so a short dead end at
 * row 5 does not reserve a column all the way down to row 70. Merges always
 * fold the shallower outline into the trunk's, so the whole pass is ~O(n).
 */
(() => {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const LCBM = (root.LCBM = root.LCBM || {});

  /** LibreChat's Constants.NO_PARENT */
  const NO_PARENT = '00000000-0000-0000-0000-000000000000';
  const PREVIEW_CHARS = 420;

  /** Visible text of a message, Markdown marks and thinking left out. */
  function previewOf(m) {
    let t = '';
    const parts = Array.isArray(m.content) ? m.content : [];
    for (const p of parts) {
      if (!p || p.type !== 'text') continue;
      const s = typeof p.text === 'string' ? p.text : (p.text && p.text.value) || '';
      if (s) t += (t ? ' ' : '') + s;
    }
    if (!t && typeof m.text === 'string') t = m.text;
    t = t.slice(0, PREVIEW_CHARS * 3)
      .replace(/<[^>]{1,80}>/g, ' ')
      .replace(/[*_`#>~|]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (t) return t.slice(0, PREVIEW_CHARS);
    if (parts.some((p) => p && p.type === 'think')) return '(thinking only)';
    if (parts.some((p) => p && p.type === 'tool_call')) return '(tool call)';
    if (Array.isArray(m.files) && m.files.length) return '(attachment)';
    return m.error ? '(error)' : '(empty)';
  }

  function slimNode(m) {
    return {
      id: m.messageId,
      parent: NO_PARENT,
      kids: [],
      user: !!m.isCreatedByUser,
      sender: m.sender || '',
      preview: previewOf(m),
      created: m.createdAt || '',
      error: !!m.error,
      unfinished: !!m.unfinished,
      idx: 1,
      sibs: 1,
      size: 1,
      height: 0,
      ends: 1,
    };
  }

  /**
   * Slim tree. Parent rules match LibreChat's buildTree (and api.buildIndex):
   * self-parented or unknown-parent messages are roots, children keep the
   * array order, which is what the on-screen "n / m" counters count in.
   */
  function buildData(messages) {
    const nodes = new Map();
    const order = [];
    for (const m of messages) {
      if (!m || !m.messageId || nodes.has(m.messageId)) continue;
      nodes.set(m.messageId, slimNode(m));
      order.push(m);
    }
    const roots = [];
    for (const m of order) {
      let p = m.parentMessageId;
      if (!p || p === m.messageId || p === NO_PARENT || !nodes.has(p)) p = NO_PARENT;
      const n = nodes.get(m.messageId);
      n.parent = p;
      (p === NO_PARENT ? roots : nodes.get(p).kids).push(n.id);
    }
    const data = { nodes, roots, total: order.length };
    computeStats(data);
    return data;
  }

  /** Sibling index/count, subtree size, height and branch-end count. */
  function computeStats(data) {
    const { nodes, roots } = data;
    const setSibs = (ids) =>
      ids.forEach((id, i) => {
        const n = nodes.get(id);
        n.idx = i + 1;
        n.sibs = ids.length;
      });
    setSibs(roots);
    const order = [];
    const seen = new Set();
    const stack = [...roots];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      order.push(id);
      const n = nodes.get(id);
      setSibs(n.kids);
      for (const k of n.kids) stack.push(k);
    }
    let forks = roots.length > 1 ? 1 : 0;
    let ends = 0;
    for (let i = order.length - 1; i >= 0; i--) {
      const n = nodes.get(order[i]);
      n.size = 1;
      n.height = 0;
      n.ends = n.kids.length ? 0 : 1;
      for (const k of n.kids) {
        const c = nodes.get(k);
        n.size += c.size;
        if (c.height + 1 > n.height) n.height = c.height + 1;
        n.ends += c.ends;
      }
      if (n.kids.length > 1) forks++;
      if (!n.kids.length) ends++;
    }
    data.reachable = order.length;
    data.forks = forks;
    data.ends = ends;
    return data;
  }

  /**
   * Add messages LibreChat shows that the fetched tree does not know yet
   * (sent since). `displayed` is the on-screen branch, root to leaf:
   * [{id, user, preview}]. A new message's parent is the one above it.
   * Returns how many were added.
   *
   * The branch must start at a known first message (unless the tree is still
   * empty): right after a chat switch the page briefly still shows the chat
   * you left, and that must not be grafted on as "new" messages.
   */
  function spliceDisplayed(data, displayed) {
    if (!displayed.length || (data.total && !data.nodes.has(displayed[0].id))) return 0;
    let added = 0;
    for (let i = 0; i < displayed.length; i++) {
      const d = displayed[i];
      if (data.nodes.has(d.id)) continue;
      const parent = i === 0 ? NO_PARENT : displayed[i - 1].id;
      if (parent !== NO_PARENT && !data.nodes.has(parent)) break;
      const n = slimNode({ messageId: d.id, isCreatedByUser: d.user, sender: d.sender || '' });
      n.preview = d.preview || '(new message)';
      n.created = new Date().toISOString();
      n.provisional = true;
      n.parent = parent;
      data.nodes.set(n.id, n);
      (parent === NO_PARENT ? data.roots : data.nodes.get(parent).kids).push(n.id);
      data.total++;
      added++;
    }
    if (added) computeStats(data);
    return added;
  }

  function vnode(kind, extra) {
    return { kind, kids: [], row: 0, x: 0, off: 0, h: 0, size: 1, parentV: null, ...extra };
  }

  /**
   * What is drawn. opts:
   *   collapsed  Set of message ids whose branch is folded away
   *   openStacks Set of fork ids (parent message id, or NO_PARENT) whose
   *              dead ends are spread out
   *   stack      fold dead ends at all
   *   path       Set of message ids on the branch LibreChat shows; these are
   *              never folded into a stack
   *   keep       ids that never fold into a stack either (bookmarks); a Set
   *              or a Map keyed by id
   * Returns { root, list } with list in pre-order (parents first).
   */
  function buildVisual(data, opts) {
    const { nodes, roots } = data;
    const collapsed = opts.collapsed || new Set();
    const openStacks = opts.openStacks || new Set();
    const path = opts.path || new Set();
    const keep = opts.keep || new Set();

    /** The stack stands where its first version would, so it opens in place. */
    const expand = (forkId, kidIds) => {
      let dead = null;
      if (opts.stack && kidIds.length >= 2 && !openStacks.has(forkId)) {
        dead = kidIds.filter((id) => !nodes.get(id).kids.length && !path.has(id) && !keep.has(id));
        if (dead.length < 2) dead = null;
      }
      if (!dead) return kidIds.map((id) => vnode('msg', { id, n: nodes.get(id) }));
      const deadSet = new Set(dead);
      const out = [];
      for (const id of kidIds) {
        if (!deadSet.has(id)) out.push(vnode('msg', { id, n: nodes.get(id) }));
        else if (id === dead[0]) out.push(vnode('stack', { id: `stack:${forkId}`, fork: forkId, ids: dead }));
      }
      return out;
    };

    const vroot = vnode('root', { id: NO_PARENT });
    vroot.kids = expand(NO_PARENT, roots);
    const list = [];
    const todo = [vroot];
    while (todo.length) {
      const v = todo.pop();
      list.push(v);
      if (v.kind === 'msg' && v.n.kids.length && !collapsed.has(v.id)) v.kids = expand(v.id, v.n.kids);
      for (let i = v.kids.length - 1; i >= 0; i--) {
        const c = v.kids[i];
        c.parentV = v;
        c.row = v.row + 1;
        todo.push(c);
      }
    }
    return { root: vroot, list };
  }

  /**
   * Columns for a visual tree (pre-order list from buildVisual). Sets v.x
   * (integer column, may be negative) on every node; returns the bounds.
   */
  function layoutVisual(list) {
    for (let i = list.length - 1; i >= 0; i--) {
      const v = list[i];
      v.h = 0;
      v.size = 1;
      for (const c of v.kids) {
        if (c.h + 1 > v.h) v.h = c.h + 1;
        v.size += c.size;
      }
      if (v.kind === 'stack') v.size = v.ids.length;

      if (!v.kids.length) {
        v.L = [];
        v.R = [];
        v.L[v.row] = 0;
        v.R[v.row] = 0;
        v.hi = v.row;
        continue;
      }

      /** Trunk: deepest subtree; ties go to the bigger, then the newer one. */
      let t = 0;
      for (let j = 1; j < v.kids.length; j++) {
        const a = v.kids[j];
        const b = v.kids[t];
        if (a.h > b.h || (a.h === b.h && a.size >= b.size)) t = j;
      }
      const trunk = v.kids[t];
      trunk.off = 0;
      const L = trunk.L;
      const R = trunk.R;
      let hi = trunk.hi;
      const top = v.row + 1;

      /** Higher versions to the right, each just clear of what is placed. */
      for (let j = t + 1; j < v.kids.length; j++) {
        const c = v.kids[j];
        let o = -Infinity;
        const shared = Math.min(c.hi, hi);
        for (let r = top; r <= shared; r++) {
          const need = R[r] - c.L[r] + 1;
          if (need > o) o = need;
        }
        c.off = o;
        for (let r = top; r <= c.hi; r++) {
          const l = c.L[r] + o;
          const rr = c.R[r] + o;
          if (r > hi) {
            L[r] = l;
            R[r] = rr;
          } else {
            if (l < L[r]) L[r] = l;
            if (rr > R[r]) R[r] = rr;
          }
        }
        if (c.hi > hi) hi = c.hi;
        c.L = c.R = null;
      }
      /** Lower versions to the left, mirrored. */
      for (let j = t - 1; j >= 0; j--) {
        const c = v.kids[j];
        let o = Infinity;
        const shared = Math.min(c.hi, hi);
        for (let r = top; r <= shared; r++) {
          const need = L[r] - c.R[r] - 1;
          if (need < o) o = need;
        }
        c.off = o;
        for (let r = top; r <= c.hi; r++) {
          const l = c.L[r] + o;
          const rr = c.R[r] + o;
          if (r > hi) {
            L[r] = l;
            R[r] = rr;
          } else {
            if (l < L[r]) L[r] = l;
            if (rr > R[r]) R[r] = rr;
          }
        }
        if (c.hi > hi) hi = c.hi;
        c.L = c.R = null;
      }
      L[v.row] = 0;
      R[v.row] = 0;
      v.L = L;
      v.R = R;
      v.hi = hi;
      trunk.L = trunk.R = null;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let maxRow = 0;
    for (const v of list) {
      v.x = v.parentV ? v.parentV.x + v.off : 0;
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.row > maxRow) maxRow = v.row;
    }
    const rootV = list[0];
    if (rootV) rootV.L = rootV.R = null;
    return { minX, maxX, maxRow };
  }

  LCBM.treeLayout = { NO_PARENT, previewOf, buildData, computeStats, spliceDisplayed, buildVisual, layoutVisual };
  if (typeof module !== 'undefined' && module.exports) module.exports = LCBM.treeLayout;
})();

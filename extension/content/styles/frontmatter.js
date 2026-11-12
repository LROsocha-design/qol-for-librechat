/**
 * FRONTMATTER — pure text surgery on a SKILL.md body. No DOM, no network.
 *
 * Mirrors the server's own extractor
 * (packages/data-schemas/src/methods/skill.ts → extractAlwaysApplyFromBody):
 *   - the block must start at the top of the trimmed body with `---`
 *   - it ends at the first "\n---" after the opening fence
 *   - the flag line is `always-apply: true|false` (alias `alwaysApply`),
 *     key case-insensitive, quotes and a trailing `# comment` tolerated
 *   - if the key is absent the server treats the skill as NOT always-apply
 *     (and a body save without the key flips the DB column to false)
 *
 * Everything outside the one flag line is preserved byte for byte
 * (BOM, CRLF vs LF, indentation, other keys, the markdown body).
 */
(() => {
  const LCSS = (window.LCSS = window.LCSS || {});

  const KEY_RE = /^(\s*)(always-apply|alwaysApply)(\s*):(.*)$/i;

  /**
   * Split a body into its parts. Returns null when the server would not
   * recognise a frontmatter block (no opening fence, or no closing fence).
   */
  function split(body) {
    const bom = body.charCodeAt(0) === 0xfeff ? body[0] : '';
    const text = bom ? body.slice(1) : body;
    const lead = (text.match(/^\s*/) || [''])[0];
    const afterLead = text.slice(lead.length);
    if (!afterLead.startsWith('---')) return null;
    const afterOpen = afterLead.slice(3);
    const closeIdx = afterOpen.indexOf('\n---');
    if (closeIdx === -1) return null;
    return {
      bom,
      lead,
      block: afterOpen.slice(0, closeIdx), // text between the fences (may start with "\r")
      tail: afterOpen.slice(closeIdx), // "\n---" and everything after it
      crlf: text.includes('\r\n'),
    };
  }

  function parseBool(rawValue) {
    let v = rawValue;
    const hash = v.indexOf('#');
    if (hash !== -1) v = v.slice(0, hash);
    v = v.trim();
    if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) {
      v = v.slice(1, -1).trim();
    }
    if (v === '') return { status: 'absent' };
    const lower = v.toLowerCase();
    if (lower === 'true') return { status: 'valid', value: true };
    if (lower === 'false') return { status: 'valid', value: false };
    return { status: 'invalid' };
  }

  /**
   * What the server will derive from this body: true / false / null
   * (null = absent or invalid → column becomes/stays false on save).
   */
  function readAlwaysApply(body) {
    const parts = split(typeof body === 'string' ? body : '');
    if (!parts) return null;
    let alias = null;
    for (const rawLine of parts.block.split('\n')) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      const m = line.match(KEY_RE);
      if (!m) continue;
      const parsed = parseBool(m[4]);
      const value = parsed.status === 'valid' ? parsed.value : null;
      if (m[2].toLowerCase() === 'always-apply') return value; // canonical: first wins
      alias = value; // alias: last wins
    }
    return alias;
  }

  /**
   * Return a new body with `always-apply` set to `value`. Every existing
   * flag line (either spelling) is rewritten so no stale copy can outvote
   * the new one; a missing line is appended inside the block; a body with
   * no frontmatter gets a minimal block prepended.
   */
  function setAlwaysApply(body, value) {
    const src = typeof body === 'string' ? body : '';
    const word = value ? 'true' : 'false';
    const parts = split(src);

    if (!parts) {
      const bom = src.charCodeAt(0) === 0xfeff ? src[0] : '';
      const rest = bom ? src.slice(1) : src;
      const eol = rest.includes('\r\n') ? '\r\n' : '\n';
      return `${bom}---${eol}always-apply: ${word}${eol}---${eol}${rest}`;
    }

    const cr = parts.crlf ? '\r' : '';
    const lines = parts.block.split('\n');
    let found = false;
    const out = lines.map((rawLine) => {
      const hadCr = rawLine.endsWith('\r');
      const line = hadCr ? rawLine.slice(0, -1) : rawLine;
      const m = line.match(KEY_RE);
      if (!m) return rawLine;
      found = true;
      return `${m[1]}${m[2]}${m[3]}: ${word}${hadCr ? '\r' : ''}`;
    });
    if (!found) {
      // The last element is the tail of the final key line (or "" / "\r" for
      // an empty block); appending a new element adds a new line before the
      // closing fence.
      out.push(`always-apply: ${word}${cr}`);
    }
    return `${parts.bom}${parts.lead}---${out.join('\n')}${parts.tail}`;
  }

  // LibreChat keeps name + description in DB columns, so many SKILL.md bodies
  // lack them; always-apply has no claude.ai counterpart.
  const CLAUDE_AI_DROP = new Set(['name', 'description', 'always-apply', 'alwaysapply']);

  /**
   * SKILL.md text for a claude.ai upload: BOM and leading blank lines gone,
   * LF line endings, `name:` and `description:` written first from the
   * skill's own columns, `always-apply` removed, every other key kept as is
   * (multi-line values move with their key).
   */
  function toClaudeAi(body, name, description) {
    let src = (typeof body === 'string' ? body : '').replace(/\r\n?/g, '\n');
    if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
    const parts = split(src);
    const head = [`name: ${name}`, `description: ${JSON.stringify(description || '')}`];
    if (!parts) return `---\n${head.join('\n')}\n---\n\n${src.replace(/^\s+/, '')}`;

    const kept = [];
    let drop = false;
    for (const line of parts.block.split('\n')) {
      const m = line.match(/^([A-Za-z0-9_-]+)\s*:/);
      if (m) drop = CLAUDE_AI_DROP.has(m[1].toLowerCase());
      if (!drop && (m || line.trim() !== '' || kept.length > 0)) kept.push(line);
    }
    while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
    // parts.tail starts with the "\n---" closing fence.
    return `---\n${[...head, ...kept].join('\n')}${parts.tail}`;
  }

  LCSS.frontmatter = { readAlwaysApply, setAlwaysApply, toClaudeAi };
})();

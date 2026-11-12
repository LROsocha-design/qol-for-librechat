/**
 * EXPORT — one LibreChat skill → `<name>.zip` for claude.ai's skill uploader
 * (Settings → Skills → Upload skill). Read-only on the LibreChat side.
 *
 * Zip layout: `<name>/SKILL.md` plus every attached file at
 * `<name>/<relativePath>`, fetched with GET /api/skills/:id/files and
 * GET /api/skills/:id/files/<path>?raw=true (packages/api/src/skills/handlers.ts).
 *
 * claude.ai's limits (Agent Skills spec): name lowercase letters, digits and
 * hyphens, at most 64 chars, without "anthropic" or "claude"; description at
 * most 1024 chars, no angle brackets. A breach only adds a warning: the
 * uploader names the problem itself, and the zip is still useful to edit.
 */
(() => {
  const LCSS = (window.LCSS = window.LCSS || {});
  const { api } = LCSS;

  function warningsFor(name, description) {
    const w = [];
    if (!/^[a-z0-9-]{1,64}$/.test(name)) w.push('name must be lowercase letters, digits and hyphens, max 64');
    if (/anthropic|claude/.test(name)) w.push('claude.ai reserves "anthropic" and "claude" in names');
    const d = description || '';
    if (d.length > 1024) w.push(`description is ${d.length} chars, claude.ai allows 1024`);
    if (/[<>]/.test(d)) w.push('description contains < or >');
    if (d.trim().length < 20) w.push('description is very short, and claude.ai picks skills by description');
    return w;
  }

  async function listFiles(id) {
    const res = await api.authedFetch(`/api/skills/${encodeURIComponent(id)}/files`);
    const data = await api.readJson(res);
    if (!res.ok) throw new Error(`File list failed (HTTP ${res.status})`);
    return (data && data.files) || [];
  }

  async function fetchFile(id, relativePath) {
    const path = relativePath.split('/').map(encodeURIComponent).join('/');
    const res = await api.authedFetch(`/api/skills/${encodeURIComponent(id)}/files/${path}?raw=true`);
    if (!res.ok) throw new Error(`Download of ${relativePath} failed (HTTP ${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Builds the archive; returns { filename, bytes, fileCount, warnings }. */
  async function buildSkillZip(id) {
    const skill = await api.getSkill(id);
    const name = skill.name;
    const entries = [
      { name: `${name}/SKILL.md`, data: LCSS.frontmatter.toClaudeAi(skill.body, name, skill.description) },
    ];
    const files = await listFiles(skill._id);
    for (const f of files) {
      const rel = String(f.relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
      if (!rel || rel === 'SKILL.md' || rel.split('/').includes('..')) continue;
      entries.push({ name: `${name}/${rel}`, data: await fetchFile(skill._id, rel) });
    }
    return {
      filename: `${name}.zip`,
      bytes: LCSS.zip.build(entries),
      fileCount: entries.length - 1,
      warnings: warningsFor(name, skill.description),
    };
  }

  function saveAs(filename, bytes) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function downloadSkill(id) {
    const z = await buildSkillZip(id);
    saveAs(z.filename, z.bytes);
    return z;
  }

  LCSS.exporter = { buildSkillZip, downloadSkill, warningsFor };
})();

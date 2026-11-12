/**
 * ZIP — a minimal zip writer (store method, no compression). No DOM, no network.
 *
 * Entry names always use forward slashes and carry the UTF-8 flag (bit 11):
 * claude.ai's skill uploader rejects backslash paths with "Zip file contains
 * path with invalid characters", which is what Windows' Compress-Archive writes.
 */
(() => {
  const LCSS = (window.LCSS = window.LCSS || {});

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(d) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
  }

  /**
   * entries: [{ name: 'skill/SKILL.md', data: Uint8Array | string }]
   * Returns a Uint8Array holding the whole archive.
   */
  function build(entries, now = new Date()) {
    const enc = new TextEncoder();
    const { time, date } = dosDateTime(now);
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const e of entries) {
      const name = String(e.name).replace(/\\/g, '/');
      const nameBytes = enc.encode(name);
      const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
      const crc = crc32(data);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true); // version needed
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(8, 0, true); // stored
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      locals.push(new Uint8Array(local.buffer), nameBytes, data);

      const central = new DataView(new ArrayBuffer(46));
      central.setUint32(0, 0x02014b50, true);
      central.setUint16(4, 20, true); // version made by
      central.setUint16(6, 20, true);
      central.setUint16(8, 0x0800, true);
      central.setUint16(10, 0, true);
      central.setUint16(12, time, true);
      central.setUint16(14, date, true);
      central.setUint32(16, crc, true);
      central.setUint32(20, data.length, true);
      central.setUint32(24, data.length, true);
      central.setUint16(28, nameBytes.length, true);
      // extra len, comment len, disk no., internal attrs, external attrs: all 0
      central.setUint32(42, offset, true);
      centrals.push(new Uint8Array(central.buffer), nameBytes);

      offset += 30 + nameBytes.length + data.length;
    }

    const centralSize = centrals.reduce((n, b) => n + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
    const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
    let p = 0;
    for (const b of parts) {
      out.set(b, p);
      p += b.length;
    }
    return out;
  }

  LCSS.zip = { build, crc32 };
})();

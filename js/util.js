// Small shared helpers. Pure (no DOM) unless noted.

let lastId = 0;
/** Unique, increasing millisecond-based id (Anki style). */
export function newId() {
  const now = Date.now();
  lastId = now > lastId ? now : lastId + 1;
  return lastId;
}

const GUID_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~';
export function guid() {
  let s = '';
  const buf = new Uint32Array(10);
  globalThis.crypto.getRandomValues(buf);
  for (const n of buf) s += GUID_CHARS[n % GUID_CHARS.length];
  return s;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Strip HTML to plain text (for sort fields, search, previews). */
export function stripHtml(html) {
  return decodeEntities(
    String(html ?? '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>|<\/(div|p|li|tr)>/gi, ' ')
      .replace(/<[^>]*>/g, '')
      .replace(/\[sound:[^\]]*\]/g, '')
  ).replace(/\s+/g, ' ').trim();
}

/** Anki's notion of an empty field: only whitespace, <br> and <div> tags. */
export function fieldIsEmpty(s) {
  return /^(?:[\s​]|&nbsp;|<\/?(?:br|div)\s*\/?>)*$/i.test(s ?? '');
}

export function splitTags(s) {
  return String(s ?? '').split(/[\s　]+/).map((t) => t.trim()).filter(Boolean);
}

export function uniq(arr) {
  return [...new Set(arr)];
}

export function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

export function plural(n, word, pl = word + 's') {
  return `${n} ${n === 1 ? word : pl}`;
}

export function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  bmp: 'image/bmp', avif: 'image/avif', heic: 'image/heic', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav',
  flac: 'audio/flac', webm: 'video/webm', mp4: 'video/mp4', mov: 'video/quicktime', ttf: 'font/ttf', otf: 'font/otf',
  woff: 'font/woff', woff2: 'font/woff2', css: 'text/css',
};
export function mimeFor(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

/** Parse a "1 10 1d" style list of learning steps into minutes. */
export function parseSteps(s) {
  const out = [];
  for (const tok of String(s).split(/[\s,]+/).filter(Boolean)) {
    const m = /^(\d+(?:\.\d+)?)([smhd]?)$/i.exec(tok);
    if (!m) return null;
    const n = parseFloat(m[1]);
    const unit = (m[2] || 'm').toLowerCase();
    const mins = unit === 's' ? n / 60 : unit === 'h' ? n * 60 : unit === 'd' ? n * 1440 : n;
    if (!(mins > 0)) return null;
    out.push(mins);
  }
  return out;
}

export function formatSteps(steps) {
  return steps
    .map((m) => (m >= 1440 && m % 1440 === 0 ? `${m / 1440}d` : m >= 60 && m % 60 === 0 ? `${m / 60}h` : m < 1 ? `${Math.round(m * 60)}s` : `${+m.toFixed(2)}m`))
    .join(' ');
}

export async function sha1Hex(str) {
  const buf = await globalThis.crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Media files (images, audio, fonts) stored as Blobs in IndexedDB.
import * as db from './db.js';
import { mimeFor, sha1Hex } from './util.js';

const urls = new Map();
let names = null;

export async function mediaNames() {
  if (!names) names = new Set(await db.getAllKeys('media'));
  return names;
}

export async function mediaUrl(name) {
  if (urls.has(name)) return urls.get(name);
  const rec = await db.get('media', name);
  const url = rec ? URL.createObjectURL(rec.blob) : null;
  urls.set(name, url);
  return url;
}

export async function getMedia(name) {
  return (await db.get('media', name))?.blob || null;
}

/** files: [{ name, blob }] */
export async function putMedia(files) {
  if (!files.length) return;
  const set = await mediaNames();
  const recs = files.map(({ name, blob }) => {
    set.add(name);
    const old = urls.get(name);
    if (old) URL.revokeObjectURL(old);
    urls.delete(name);
    return { name, blob, size: blob.size };
  });
  await db.commit({ put: { media: recs } });
}

export async function deleteMedia(list) {
  const set = await mediaNames();
  for (const n of list) {
    set.delete(n);
    const u = urls.get(n);
    if (u) URL.revokeObjectURL(u);
    urls.delete(n);
  }
  await db.commit({ del: { media: list } });
}

export function resetMediaCache() {
  for (const u of urls.values()) if (u) URL.revokeObjectURL(u);
  urls.clear();
  names = null;
}

/** Downscale big photos so the local database stays small. */
async function shrinkImage(file, maxDim = 1600) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || file.size < 400_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.type === 'image/jpeg') return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    return blob && blob.size < file.size ? new File([blob], 'image.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}

/** Store a user-picked file and return its media filename. */
export async function addMediaFile(file) {
  const f = await shrinkImage(file);
  const buf = new Uint8Array(await f.arrayBuffer());
  let hex = '';
  try {
    const d = await crypto.subtle.digest('SHA-1', buf);
    hex = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  } catch {
    hex = (await sha1Hex(String(Date.now()))).slice(0, 16);
  }
  const ext = (f.name.match(/\.([a-z0-9]+)$/i)?.[1] || (f.type.split('/')[1] || 'bin')).toLowerCase().replace('jpeg', 'jpg');
  const kind = f.type.startsWith('audio') ? 'audio' : 'paste';
  const name = `${kind}-${hex}.${ext}`;
  await putMedia([{ name, blob: new Blob([buf], { type: f.type || mimeFor(name) }) }]);
  return name;
}

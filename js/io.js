// Import / export glue between file formats and the collection.
import * as db from './db.js';
import { readApkg, referencedMedia, writeApkg } from './apkg.js';
import { col, compareDeckNames, deckSubtree, ensureDeckSync, kvRecords, load, rebuildNoteIndex } from './col.js';
import { getMedia, mediaNames, putMedia, resetMediaCache } from './media.js';
import { dayNumber, dayStart, DEFAULT_CONFIG } from './sched.js';
import { cardOrdinals } from './template.js';
import { parseTextFile, serializeText } from './textio.js';
import { escapeHtml, guid, mimeFor, newId, sha1Hex, splitTags, stripHtml } from './util.js';

const base = new URL('../', import.meta.url);
let libsPromise;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

export function loadLibs() {
  libsPromise ||= (async () => {
    if (!globalThis.initSqlJs) await loadScript(new URL('vendor/sql-wasm.js', base).href);
    const SQL = await globalThis.initSqlJs({ locateFile: (f) => new URL('vendor/' + f, base).href });
    const fflate = await import('../vendor/fflate.js');
    const fzstd = await import('../vendor/fzstd.js');
    return { SQL, unzipSync: fflate.unzipSync, zipSync: fflate.zipSync, strToU8: fflate.strToU8, strFromU8: fflate.strFromU8, zstdDecompress: fzstd.decompress };
  })();
  libsPromise.catch(() => (libsPromise = null));
  return libsPromise;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function sameStructure(a, b) {
  return (
    a.kind === b.kind &&
    a.fields.length === b.fields.length &&
    a.fields.every((f, i) => f.name === b.fields[i].name) &&
    a.templates.length === b.templates.length &&
    a.templates.every((t, i) => t.qfmt === b.templates[i].qfmt && t.afmt === b.templates[i].afmt)
  );
}

// ---------- Anki package import ----------
export async function importApkg(file, { includeScheduling = true, onProgress = () => {} } = {}) {
  onProgress('Loading…');
  const libs = await loadLibs();
  onProgress('Reading package…');
  await tick();
  const data = readApkg(new Uint8Array(await file.arrayBuffer()), libs);
  const conf = col.config;
  const todayNum = dayNumber(Date.now(), conf.rollover);
  const crtDay = dayNumber(data.crt * 1000, conf.rollover);
  const put = { notetypes: [], decks: [], notes: [], cards: [], revlog: [] };
  const stats = { notes: 0, updated: 0, cards: 0, media: 0, skipped: 0 };

  // note types
  const ntMap = new Map();
  for (const nt of data.notetypes) {
    let target = col.notetypes.get(nt.id);
    if (target && target.fields.length === nt.fields.length && target.fields.every((f, i) => f.name === nt.fields[i].name)) {
      ntMap.set(nt.id, target);
      continue;
    }
    target = [...col.notetypes.values()].find((x) => x.name === nt.name && sameStructure(x, nt));
    if (target) {
      ntMap.set(nt.id, target);
      continue;
    }
    let name = nt.name;
    for (let i = 2; [...col.notetypes.values()].some((x) => x.name === name); i++) name = `${nt.name} (${i})`;
    const created = { ...nt, id: col.notetypes.has(nt.id) ? newId() : nt.id, name, mod: Date.now() };
    col.notetypes.set(created.id, created);
    put.notetypes.push(created);
    ntMap.set(nt.id, created);
  }

  // decks (only those that hold cards)
  const deckNames = new Map(data.decks.map((d) => [d.id, d]));
  const deckMap = new Map();
  const mapDeck = (id) => {
    if (deckMap.has(id)) return deckMap.get(id);
    const src = deckNames.get(id);
    const d = ensureDeckSync(src && !src.dyn ? src.name : 'Default', put.decks, id);
    deckMap.set(id, d.id);
    return d.id;
  };

  // notes
  const byGuid = new Map();
  for (const n of col.notes.values()) byGuid.set(n.guid, n);
  const noteMap = new Map(); // src nid -> new nid (only for newly added notes)
  for (const n of data.notes) {
    const nt = ntMap.get(n.mid);
    if (!nt) {
      stats.skipped++;
      continue;
    }
    const fields = nt.fields.map((_f, i) => n.fields[i] ?? '');
    const existing = byGuid.get(n.guid);
    if (existing) {
      if (existing.ntid === nt.id && n.mod * 1000 > existing.mod) {
        existing.fields = fields;
        existing.tags = n.tags;
        existing.mod = n.mod * 1000;
        put.notes.push(existing);
        stats.updated++;
      } else stats.skipped++;
      continue;
    }
    const id = col.notes.has(n.id) ? newId() : n.id;
    const note = { id, guid: n.guid || guid(), ntid: nt.id, fields, tags: n.tags, mod: n.mod * 1000 };
    col.notes.set(id, note);
    byGuid.set(note.guid, note);
    put.notes.push(note);
    noteMap.set(n.id, id);
    stats.notes++;
  }

  // cards
  onProgress('Importing cards…');
  await tick();
  const newCards = data.cards.filter((c) => noteMap.has(c.nid));
  const newPositions = new Map();
  const sortedNew = newCards.filter((c) => !includeScheduling || c.type === 0 || c.queue === 0).sort((a, b) => (a.odid ? a.odue : a.due) - (b.odid ? b.odue : b.due));
  for (const c of sortedNew) {
    const k = c.nid;
    if (!newPositions.has(k)) newPositions.set(k, col.meta.nextPos++);
  }
  const cardMap = new Map();
  const nowTs = Date.now();
  for (const c of newCards) {
    const nid = noteMap.get(c.nid);
    const did = mapDeck(c.odid || c.did);
    const due = c.odid ? c.odue : c.due;
    const id = col.cards.has(c.id) ? newId() : c.id;
    const card = { id, nid, did, ord: c.ord, type: 0, due: 0, ivl: 0, factor: 0, reps: 0, lapses: 0, step: 0, mod: nowTs, suspended: c.queue === -1, buried: 0, flags: c.flags & 7 };
    if (!includeScheduling || c.type === 0 || c.queue === 0) {
      card.due = newPositions.get(c.nid);
      card.suspended = includeScheduling && c.queue === -1;
    } else {
      Object.assign(card, { ivl: c.ivl, factor: c.factor || 2500, reps: c.reps, lapses: c.lapses });
      if (c.type === 2) {
        card.type = 2;
        card.due = crtDay + due;
      } else {
        card.type = c.type === 3 ? 3 : 1;
        const steps = card.type === 3 ? conf.relearnSteps : conf.learnSteps;
        card.step = Math.max(0, steps.length - (c.left % 1000 || steps.length));
        // queue 1: due is a unix timestamp; queue 3 (day learning): due is a day number
        card.due = c.queue === 3 || due < 1e8 ? dayStart(Math.min(todayNum, crtDay + due), conf.rollover) : due * 1000;
        if (card.type === 3 && !card.ivl) card.ivl = 1;
      }
    }
    col.cards.set(id, card);
    put.cards.push(card);
    cardMap.set(c.id, id);
    stats.cards++;
  }
  // notes that ended up with no cards (e.g. cards in a filtered deck only) still need a card
  for (const nid of noteMap.values()) {
    if (put.cards.some((c) => c.nid === nid)) continue;
    const note = col.notes.get(nid);
    const nt = col.notetypes.get(note.ntid);
    const ords = cardOrdinals(nt, note);
    for (const ord of ords.length ? ords : [0]) {
      const card = { id: newId(), nid, did: mapDeck(1), ord, type: 0, due: col.meta.nextPos, ivl: 0, factor: 0, reps: 0, lapses: 0, step: 0, mod: nowTs, suspended: false, buried: 0, flags: 0 };
      col.cards.set(card.id, card);
      put.cards.push(card);
      stats.cards++;
    }
    col.meta.nextPos++;
  }

  if (includeScheduling && data.revlog.length) {
    const existingIds = new Set(await db.getAllKeys('revlog'));
    for (const r of data.revlog) {
      const cid = cardMap.get(r.cid);
      if (!cid || existingIds.has(r.id)) continue;
      put.revlog.push({ id: r.id, cid, ease: r.ease, ivl: r.ivl, lastIvl: r.lastIvl, factor: r.factor, time: r.time, type: r.type });
    }
  }

  onProgress('Saving…');
  await tick();
  put.kv = kvRecords('meta');
  await db.commit({ put });
  rebuildNoteIndex();

  // media, in chunks to keep memory bounded
  const chunk = [];
  for (let i = 0; i < data.media.length; i++) {
    const m = data.media[i];
    chunk.push({ name: m.name, blob: new Blob([m.data()], { type: mimeFor(m.name) }) });
    if (chunk.length >= 50 || i === data.media.length - 1) {
      onProgress(`Saving media ${i + 1}/${data.media.length}…`);
      await putMedia(chunk.splice(0));
      await tick();
    }
  }
  stats.media = data.media.length;
  return stats;
}

// ---------- Anki package export ----------
export async function exportApkg({ did = null, includeScheduling = true, includeMedia = true, onProgress = () => {} } = {}) {
  onProgress('Loading…');
  const libs = await loadLibs();
  const deckIds = did ? deckSubtree(did) : new Set(col.decks.keys());
  const cards = [...col.cards.values()].filter((c) => deckIds.has(c.did));
  const nids = new Set(cards.map((c) => c.nid));
  const notes = [...nids].map((id) => col.notes.get(id)).filter(Boolean);
  const notetypes = [...new Set(notes.map((n) => n.ntid))].map((id) => col.notetypes.get(id));
  const usedDecks = new Set(cards.map((c) => c.did));
  // include ancestors
  for (const d of col.decks.values()) {
    if (!usedDecks.has(d.id) && !deckIds.has(d.id)) continue;
    const parts = d.name.split('::');
    for (let i = 1; i < parts.length; i++) {
      const anc = [...col.decks.values()].find((x) => x.name === parts.slice(0, i).join('::'));
      if (anc) usedDecks.add(anc.id);
    }
    usedDecks.add(d.id);
  }
  const decks = [...usedDecks].map((id) => col.decks.get(id)).filter(Boolean);

  onProgress('Preparing notes…');
  const csums = new Map();
  for (const n of notes) {
    const nt = col.notetypes.get(n.ntid);
    const s = stripHtml(n.fields[nt?.sortf || 0] ?? '');
    if (!csums.has(s)) csums.set(s, parseInt((await sha1Hex(s)).slice(0, 8), 16));
  }
  let revlog = [];
  if (includeScheduling) {
    const cids = new Set(cards.map((c) => c.id));
    revlog = (await db.getAll('revlog')).filter((r) => cids.has(r.cid));
  }
  const media = [];
  if (includeMedia) {
    onProgress('Collecting media…');
    const all = await mediaNames();
    const wanted = new Set(did ? referencedMedia(notes.flatMap((n) => n.fields)) : all);
    for (const nt of notetypes) for (const m of (nt.css || '').matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) wanted.add(m[1]);
    for (const n of all) if (n.startsWith('_')) wanted.add(n);
    for (const name of wanted) {
      if (!all.has(name)) continue;
      const blob = await getMedia(name);
      if (blob) media.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
    }
  }
  onProgress('Writing package…');
  await tick();
  const bytes = writeApkg(
    {
      notetypes, decks, notes, cards, revlog, media, conf: col.config, includeScheduling,
      today: dayNumber(Date.now(), col.config.rollover),
      dayStartMs: (d) => dayStart(d, col.config.rollover),
      csum: (s) => csums.get(s) ?? 0,
    },
    libs
  );
  const name = did ? col.decks.get(did).name.replace(/::/g, ' - ') : 'Collection';
  return { blob: new Blob([bytes], { type: 'application/octet-stream' }), filename: `${safeName(name)}.apkg`, count: cards.length };
}

function safeName(s) {
  return s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'export';
}

// ---------- text ----------
export function previewText(text) {
  return parseTextFile(text);
}

/**
 * opts: { parsed, ntid, did, mapping: [fieldIndex | 'tags' | 'deck' | null per column], skipDuplicates, extraTags, firstRowHeader }
 */
export async function importText(opts) {
  const { parsed, ntid, did, mapping, skipDuplicates = true, extraTags = [] } = opts;
  const nt = col.notetypes.get(ntid);
  const rows = opts.firstRowHeader ? parsed.rows.slice(1) : parsed.rows;
  const existingFirst = new Set();
  const byGuid = new Map();
  for (const n of col.notes.values()) {
    byGuid.set(n.guid, n);
    if (n.ntid === ntid) existingFirst.add(stripHtml(n.fields[0]).toLowerCase());
  }
  const put = { notes: [], cards: [], decks: [] };
  const stats = { notes: 0, cards: 0, skipped: 0, updated: 0, empty: 0 };
  for (const row of rows) {
    const fields = nt.fields.map(() => '');
    let tags = [...extraTags];
    let deckId = did;
    let rowGuid = null;
    row.forEach((val, i) => {
      const m = mapping[i];
      if (m === 'tags') tags.push(...splitTags(val));
      else if (m === 'deck') deckId = val.trim() ? ensureDeckSync(val, put.decks).id : did;
      else if (m === 'guid') rowGuid = val.trim() || null;
      else if (typeof m === 'number' && m < fields.length) {
        let v = parsed.html ? val : escapeHtml(val).replace(/\r?\n/g, '<br>');
        fields[m] = fields[m] ? fields[m] + ' ' + v : v;
      }
    });
    if (rowGuid && byGuid.has(rowGuid)) {
      const n = byGuid.get(rowGuid);
      if (n.ntid === ntid) {
        n.fields = fields;
        n.tags = [...new Set(tags)];
        n.mod = Date.now();
        put.notes.push(n);
        stats.updated++;
      } else stats.skipped++;
      continue;
    }
    const key = stripHtml(fields[0]).toLowerCase();
    if (!key) {
      stats.empty++;
      continue;
    }
    if (skipDuplicates && existingFirst.has(key)) {
      stats.skipped++;
      continue;
    }
    const note = { id: newId(), guid: rowGuid || guid(), ntid, fields, tags: [...new Set(tags)], mod: Date.now() };
    const ords = cardOrdinals(nt, note);
    if (!ords.length) {
      stats.empty++;
      continue;
    }
    existingFirst.add(key);
    const pos = col.meta.nextPos++;
    col.notes.set(note.id, note);
    put.notes.push(note);
    for (const ord of ords) {
      const c = { id: newId(), nid: note.id, did: deckId, ord, type: 0, due: pos, ivl: 0, factor: 0, reps: 0, lapses: 0, step: 0, mod: Date.now(), suspended: false, buried: 0, flags: 0 };
      col.cards.set(c.id, c);
      put.cards.push(c);
      stats.cards++;
    }
    stats.notes++;
  }
  put.kv = kvRecords('meta');
  await db.commit({ put });
  rebuildNoteIndex();
  return stats;
}

export function exportText({ did = null, includeDeck = false, includeNotetype = false, includeGuid = true } = {}) {
  const deckIds = did ? deckSubtree(did) : null;
  const seen = new Set();
  const rows = [];
  const cards = [...col.cards.values()].filter((c) => !deckIds || deckIds.has(c.did)).sort((a, b) => a.nid - b.nid);
  for (const c of cards) {
    if (seen.has(c.nid)) continue;
    seen.add(c.nid);
    const n = col.notes.get(c.nid);
    if (!n) continue;
    rows.push({ fields: n.fields.map((f) => f.replace(/\r?\n/g, '<br>')), tags: n.tags, deck: col.decks.get(c.did)?.name, notetype: col.notetypes.get(n.ntid)?.name, guid: n.guid });
  }
  const text = serializeText(rows, { deckColumn: includeDeck, notetypeColumn: includeNotetype, guidColumn: includeGuid });
  const name = did ? col.decks.get(did).name.replace(/::/g, ' - ') : 'Collection';
  return { blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), filename: `${safeName(name)}.txt`, count: rows.length };
}

// ---------- full backup ----------
export async function exportBackup({ onProgress = () => {} } = {}) {
  const libs = await loadLibs();
  onProgress('Collecting data…');
  const data = {
    app: 'flashcards',
    version: 1,
    created: Date.now(),
    decks: [...col.decks.values()],
    notetypes: [...col.notetypes.values()],
    notes: [...col.notes.values()],
    cards: [...col.cards.values()],
    revlog: await db.getAll('revlog'),
    config: col.config,
    meta: col.meta,
    counts: col.counts,
  };
  const files = { 'collection.json': libs.strToU8(JSON.stringify(data)) };
  const media = await db.getAll('media');
  onProgress('Collecting media…');
  for (const m of media) files['media/' + m.name] = [new Uint8Array(await m.blob.arrayBuffer()), { level: 0 }];
  onProgress('Compressing…');
  await tick();
  const bytes = libs.zipSync(files, { level: 6 });
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { blob: new Blob([bytes], { type: 'application/zip' }), filename: `flashcards-backup-${stamp}.zip` };
}

export async function restoreBackup(file, { onProgress = () => {} } = {}) {
  const libs = await loadLibs();
  onProgress('Reading backup…');
  const files = libs.unzipSync(new Uint8Array(await file.arrayBuffer()));
  if (!files['collection.json']) throw new Error('Not a backup file');
  const data = JSON.parse(libs.strFromU8(files['collection.json']));
  if (data.app !== 'flashcards') throw new Error('Not a backup file');
  onProgress('Restoring…');
  const media = Object.entries(files)
    .filter(([k]) => k.startsWith('media/') && k.length > 6)
    .map(([k, v]) => {
      const name = k.slice(6);
      return { name, blob: new Blob([v], { type: mimeFor(name) }), size: v.length };
    });
  await db.commit({
    clear: ['decks', 'notetypes', 'notes', 'cards', 'revlog', 'media', 'kv'],
    put: {
      decks: data.decks, notetypes: data.notetypes, notes: data.notes, cards: data.cards, revlog: data.revlog || [], media,
      kv: [
        { key: 'config', value: { ...DEFAULT_CONFIG, ...data.config } },
        { key: 'meta', value: data.meta || {} },
        { key: 'counts', value: data.counts || {} },
      ],
    },
  });
  resetMediaCache();
  await load();
  return { notes: data.notes.length, cards: data.cards.length, media: media.length };
}

export async function eraseEverything() {
  await db.commit({ clear: ['decks', 'notetypes', 'notes', 'cards', 'revlog', 'media', 'kv'] });
  resetMediaCache();
  col.config = { ...DEFAULT_CONFIG };
  col.meta = { nextPos: 1, lastNotetype: null, lastDeck: null };
  col.counts = { day: 0, new: {}, rev: {}, extendNew: {} };
  await load();
}

export function sortDecksForSelect() {
  return [...col.decks.values()].sort((a, b) => compareDeckNames(a.name, b.name));
}

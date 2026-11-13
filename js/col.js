// In-memory collection backed by IndexedDB.
import * as db from './db.js';
import { DEFAULT_CONFIG, answerCard, dayNumber } from './sched.js';
import { cardOrdinals } from './template.js';
import { guid, newId, splitTags, stripHtml, uniq } from './util.js';

export const col = {
  decks: new Map(),
  notetypes: new Map(),
  notes: new Map(),
  cards: new Map(),
  config: { ...DEFAULT_CONFIG },
  meta: { nextPos: 1, lastNotetype: null, lastDeck: null },
  counts: { day: 0, new: {}, rev: {}, extendNew: {} },
};

// ---------- stock note types ----------
const STOCK_CSS = `.card {
  font-family: -apple-system, system-ui, sans-serif;
  font-size: 22px;
  line-height: 1.45;
  text-align: center;
}
`;
const CLOZE_CSS = STOCK_CSS + `.cloze {
  font-weight: 600;
  color: #2f6fde;
}
.nightMode .cloze {
  color: #7fb0ff;
}
`;
const BACK = '{{FrontSide}}\n\n<hr id=answer>\n\n';

export function stockNotetypes() {
  const t = (name, qfmt, afmt) => ({ name, qfmt, afmt });
  const f = (...names) => names.map((name) => ({ name }));
  return [
    { id: 1700000000001, name: 'Basic', kind: 0, fields: f('Front', 'Back'), templates: [t('Card 1', '{{Front}}', BACK + '{{Back}}')], css: STOCK_CSS, sortf: 0 },
    {
      id: 1700000000002, name: 'Basic (and reversed card)', kind: 0, fields: f('Front', 'Back'),
      templates: [t('Card 1', '{{Front}}', BACK + '{{Back}}'), t('Card 2', '{{Back}}', BACK + '{{Front}}')], css: STOCK_CSS, sortf: 0,
    },
    {
      id: 1700000000003, name: 'Basic (optional reversed card)', kind: 0, fields: f('Front', 'Back', 'Add Reverse'),
      templates: [t('Card 1', '{{Front}}', BACK + '{{Back}}'), t('Card 2', '{{#Add Reverse}}{{Back}}{{/Add Reverse}}', BACK + '{{Front}}')], css: STOCK_CSS, sortf: 0,
    },
    {
      id: 1700000000004, name: 'Basic (type in the answer)', kind: 0, fields: f('Front', 'Back'),
      templates: [t('Card 1', '{{Front}}\n\n{{type:Back}}', '{{Front}}\n\n<hr id=answer>\n\n{{type:Back}}')], css: STOCK_CSS, sortf: 0,
    },
    {
      id: 1700000000005, name: 'Cloze', kind: 1, fields: f('Text', 'Back Extra'),
      templates: [t('Cloze', '{{cloze:Text}}', '{{cloze:Text}}<br>\n{{Back Extra}}')], css: CLOZE_CSS, sortf: 0,
    },
  ].map((nt) => ({ ...nt, mod: 0 }));
}

// ---------- loading ----------
export async function load() {
  const [decks, nts, notes, cards, kv] = await Promise.all(['decks', 'notetypes', 'notes', 'cards', 'kv'].map((s) => db.getAll(s)));
  col.decks = new Map(decks.map((d) => [d.id, d]));
  col.notetypes = new Map(nts.map((n) => [n.id, n]));
  col.notes = new Map(notes.map((n) => [n.id, n]));
  col.cards = new Map(cards.map((c) => [c.id, c]));
  for (const { key, value } of kv) {
    if (key === 'config') col.config = { ...DEFAULT_CONFIG, ...value };
    if (key === 'meta') col.meta = { ...col.meta, ...value };
    if (key === 'counts') col.counts = { ...col.counts, ...value };
  }
  if (!col.notetypes.size) {
    const stock = stockNotetypes();
    for (const nt of stock) col.notetypes.set(nt.id, nt);
    await db.commit({ put: { notetypes: stock } });
  }
  rebuildNoteIndex();
}

/** nid -> [cards] index; rebuilt on bulk changes, updated incrementally otherwise. */
export const cardsByNote = new Map();
export function rebuildNoteIndex() {
  cardsByNote.clear();
  for (const c of col.cards.values()) {
    let arr = cardsByNote.get(c.nid);
    if (!arr) cardsByNote.set(c.nid, (arr = []));
    arr.push(c);
  }
}
function indexCard(c) {
  let arr = cardsByNote.get(c.nid);
  if (!arr) cardsByNote.set(c.nid, (arr = []));
  if (!arr.includes(c)) arr.push(c);
}

export function kvRecords(...keys) {
  return keys.map((key) => ({ key, value: col[key] }));
}

export async function saveConfig() {
  await db.commit({ put: { kv: kvRecords('config') } });
}
export async function saveMeta() {
  await db.commit({ put: { kv: kvRecords('meta') } });
}

export function now() {
  return Date.now();
}
export function today() {
  return dayNumber(Date.now(), col.config.rollover);
}

export function ensureCountsToday() {
  const t = today();
  if (col.counts.day !== t) col.counts = { day: t, new: {}, rev: {}, extendNew: {} };
  return col.counts;
}

// ---------- decks ----------
export function normalizeDeckName(name) {
  return String(name)
    .split('::')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('::');
}

export function deckByName(name) {
  const lower = normalizeDeckName(name).toLowerCase();
  for (const d of col.decks.values()) if (d.name.toLowerCase() === lower) return d;
  return null;
}

/** Returns existing deck or creates it (and parents). Records to persist are pushed to `out`. */
export function ensureDeckSync(name, out = [], preferId) {
  name = normalizeDeckName(name) || 'Default';
  const parts = name.split('::');
  let deck = null;
  for (let i = 1; i <= parts.length; i++) {
    const n = parts.slice(0, i).join('::');
    deck = deckByName(n);
    if (!deck) {
      let id = i === parts.length && preferId && !col.decks.has(preferId) ? preferId : newId();
      deck = { id, name: n, newPerDay: null, revPerDay: null, collapsed: false };
      col.decks.set(deck.id, deck);
      out.push(deck);
    }
  }
  return deck;
}

export async function ensureDeck(name) {
  const out = [];
  const d = ensureDeckSync(name, out);
  if (out.length) await db.commit({ put: { decks: out } });
  return d;
}

export function compareDeckNames(a, b) {
  const pa = a.split('::');
  const pb = b.split('::');
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const c = pa[i].localeCompare(pb[i], undefined, { sensitivity: 'base', numeric: true });
    if (c) return c;
  }
  return pa.length - pb.length;
}

export function sortedDecks() {
  return [...col.decks.values()].sort((a, b) => compareDeckNames(a.name, b.name));
}

export function deckSubtree(did) {
  const d = col.decks.get(did);
  if (!d) return new Set();
  const prefix = d.name.toLowerCase() + '::';
  const ids = new Set([did]);
  for (const x of col.decks.values()) if (x.name.toLowerCase().startsWith(prefix)) ids.add(x.id);
  return ids;
}

export function childDecks(did) {
  const d = col.decks.get(did);
  const depth = d ? d.name.split('::').length : 0;
  const prefix = d ? d.name.toLowerCase() + '::' : '';
  return sortedDecks().filter((x) => x.name.split('::').length === depth + 1 && x.name.toLowerCase().startsWith(prefix));
}

export function parentDeck(did) {
  const d = col.decks.get(did);
  if (!d || !d.name.includes('::')) return null;
  return deckByName(d.name.split('::').slice(0, -1).join('::'));
}

export async function renameDeck(did, newName) {
  const d = col.decks.get(did);
  newName = normalizeDeckName(newName);
  if (!d || !newName) throw new Error('Invalid name');
  const existing = deckByName(newName);
  if (existing && existing.id !== did) throw new Error('A deck with that name already exists');
  if (newName.toLowerCase().startsWith(d.name.toLowerCase() + '::')) throw new Error('A deck cannot be moved inside itself');
  const oldPrefix = d.name + '::';
  const changed = [];
  for (const x of col.decks.values()) {
    if (x.name.startsWith(oldPrefix)) {
      x.name = newName + '::' + x.name.slice(oldPrefix.length);
      changed.push(x);
    }
  }
  d.name = newName;
  changed.push(d);
  // make sure parents exist
  if (newName.includes('::')) ensureDeckSync(newName.split('::').slice(0, -1).join('::'), changed);
  await db.commit({ put: { decks: changed } });
}

export async function deleteDeck(did) {
  const ids = deckSubtree(did);
  const cids = [];
  const touched = new Set();
  for (const c of col.cards.values()) {
    if (ids.has(c.did)) {
      cids.push(c.id);
      touched.add(c.nid);
    }
  }
  await removeCards(cids, touched, [...ids]);
}

async function removeCards(cids, nids, deckIds = []) {
  const cidSet = new Set(cids);
  for (const id of cids) col.cards.delete(id);
  const delNotes = [];
  for (const nid of nids) {
    const arr = (cardsByNote.get(nid) || []).filter((c) => !cidSet.has(c.id));
    if (arr.length) cardsByNote.set(nid, arr);
    else {
      cardsByNote.delete(nid);
      col.notes.delete(nid);
      delNotes.push(nid);
    }
  }
  for (const id of deckIds) col.decks.delete(id);
  await db.commit({ del: { cards: cids, notes: delNotes, decks: deckIds } });
}

export async function saveDeck(d) {
  await db.commit({ put: { decks: [d] } });
}

export function deckLimits(did) {
  const d = col.decks.get(did);
  return {
    newPerDay: d?.newPerDay ?? col.config.newPerDay,
    revPerDay: d?.revPerDay ?? col.config.revPerDay,
  };
}

// ---------- notes & cards ----------
export function sortField(note) {
  const nt = col.notetypes.get(note.ntid);
  return stripHtml(note.fields[nt?.sortf || 0] ?? note.fields[0] ?? '');
}

function newCard(nid, did, ord, pos) {
  return { id: newId(), nid, did, ord, type: 0, due: pos, ivl: 0, factor: 0, reps: 0, lapses: 0, step: 0, mod: Date.now(), suspended: false, buried: 0, flags: 0 };
}

export function previewOrdinals(ntid, fields) {
  const nt = col.notetypes.get(ntid);
  return cardOrdinals(nt, { fields });
}

export async function addNote(ntid, did, fields, tags) {
  const nt = col.notetypes.get(ntid);
  const note = { id: newId(), guid: guid(), ntid, fields: [...fields], tags: uniq(tags), mod: Date.now() };
  const ords = cardOrdinals(nt, note);
  if (!ords.length) throw new Error(nt.kind === 1 ? 'Add a cloze deletion, e.g. {{c1::text}}' : 'The front of this card would be empty');
  const pos = col.meta.nextPos++;
  const cards = ords.map((ord) => newCard(note.id, did, ord, pos));
  col.notes.set(note.id, note);
  for (const c of cards) {
    col.cards.set(c.id, c);
    indexCard(c);
  }
  col.meta.lastNotetype = ntid;
  col.meta.lastDeck = did;
  await db.commit({ put: { notes: [note], cards, kv: kvRecords('meta') } });
  return { note, cards };
}

export async function updateNote(note, fields, tags) {
  note.fields = [...fields];
  note.tags = uniq(tags);
  note.mod = Date.now();
  const nt = col.notetypes.get(note.ntid);
  const existing = cardsByNote.get(note.id) || [];
  const have = new Set(existing.map((c) => c.ord));
  const did = existing[0]?.did ?? col.meta.lastDeck ?? sortedDecks()[0]?.id;
  const pos = existing.find((c) => c.type === 0)?.due ?? col.meta.nextPos++;
  const added = cardOrdinals(nt, note)
    .filter((o) => !have.has(o))
    .map((ord) => newCard(note.id, did, ord, pos));
  for (const c of added) {
    col.cards.set(c.id, c);
    indexCard(c);
  }
  await db.commit({ put: { notes: [note], cards: added, kv: kvRecords('meta') } });
  return added;
}

export async function deleteNotes(nids) {
  const cids = [];
  for (const nid of nids) for (const c of cardsByNote.get(nid) || []) cids.push(c.id);
  await removeCards(cids, new Set(nids));
}

export async function saveCards(cards) {
  await db.commit({ put: { cards } });
}

export async function setDeck(cards, did) {
  for (const c of cards) c.did = did;
  await saveCards(cards);
}

export async function setSuspended(cards, value) {
  for (const c of cards) c.suspended = value;
  await saveCards(cards);
}

export async function buryCards(cards) {
  const t = today();
  for (const c of cards) c.buried = t;
  await saveCards(cards);
}

export async function forgetCards(cards) {
  const byNote = new Map();
  for (const c of cards) {
    if (!byNote.has(c.nid)) byNote.set(c.nid, col.meta.nextPos++);
    Object.assign(c, { type: 0, due: byNote.get(c.nid), ivl: 0, factor: 0, reps: 0, lapses: 0, step: 0, mod: Date.now(), buried: 0 });
  }
  await db.commit({ put: { cards, kv: kvRecords('meta') } });
}

export async function addTags(notes, tags) {
  for (const n of notes) {
    n.tags = uniq([...n.tags, ...tags]);
    n.mod = Date.now();
  }
  await db.commit({ put: { notes } });
}

export async function removeTags(notes, tags) {
  const lower = new Set(tags.map((t) => t.toLowerCase()));
  for (const n of notes) {
    n.tags = n.tags.filter((t) => !lower.has(t.toLowerCase()));
    n.mod = Date.now();
  }
  await db.commit({ put: { notes } });
}

export function allTags() {
  const set = new Set();
  for (const n of col.notes.values()) for (const t of n.tags) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

// ---------- answering ----------
export async function answer(card, ease, timeMs) {
  const counts = ensureCountsToday();
  const before = { ...card };
  const countsBefore = JSON.parse(JSON.stringify(counts));
  const ts = Date.now();
  const { card: next, log, leech } = answerCard(card, ease, ts, col.config);
  Object.assign(card, next);
  if (before.type === 0) counts.new[card.did] = (counts.new[card.did] || 0) + 1;
  if (before.type === 2) counts.rev[card.did] = (counts.rev[card.did] || 0) + 1;
  const entry = { id: newId(), cid: card.id, ...log, time: Math.min(Math.round(timeMs), 60000) };
  const put = { cards: [card], revlog: [entry], kv: kvRecords('counts') };
  let note = null;
  let noteBefore = null;
  if (leech) {
    note = col.notes.get(card.nid);
    noteBefore = { ...note, tags: [...note.tags] };
    note.tags = uniq([...note.tags, 'leech']);
    put.notes = [note];
    if (col.config.leechAction === 'suspend') card.suspended = true;
  }
  await db.commit({ put });
  return { leech, undo: { card: before, revlogId: entry.id, counts: countsBefore, note: noteBefore } };
}

export async function undoAnswer(u) {
  const card = col.cards.get(u.card.id);
  if (!card) return null;
  Object.assign(card, u.card);
  col.counts = u.counts;
  const put = { cards: [card], kv: kvRecords('counts') };
  if (u.note) {
    const n = col.notes.get(u.note.id);
    if (n) {
      Object.assign(n, u.note);
      put.notes = [n];
    }
  }
  await db.commit({ put, del: { revlog: [u.revlogId] } });
  return card;
}

// ---------- note types ----------
export function notetypeUseCount(ntid) {
  let n = 0;
  for (const note of col.notes.values()) if (note.ntid === ntid) n++;
  return n;
}

export async function saveNotetype(nt) {
  nt.mod = Date.now();
  col.notetypes.set(nt.id, nt);
  await db.commit({ put: { notetypes: [nt] } });
}

export async function cloneNotetype(ntid, name) {
  const src = col.notetypes.get(ntid);
  const nt = JSON.parse(JSON.stringify(src));
  nt.id = newId();
  nt.name = name;
  await saveNotetype(nt);
  return nt;
}

export async function deleteNotetype(ntid) {
  if (notetypeUseCount(ntid)) throw new Error('This note type is in use');
  col.notetypes.delete(ntid);
  await db.commit({ del: { notetypes: [ntid] } });
}

/**
 * Apply field changes to a note type. `fieldMap` lists, for each new field, the
 * index of the old field it came from (or -1 for a new, empty field).
 */
export async function updateNotetypeFields(nt, newFields, fieldMap) {
  const notes = [];
  for (const note of col.notes.values()) {
    if (note.ntid !== nt.id) continue;
    note.fields = fieldMap.map((i) => (i >= 0 ? note.fields[i] ?? '' : ''));
    notes.push(note);
  }
  const renames = new Map();
  fieldMap.forEach((oldIdx, i) => {
    if (oldIdx >= 0 && nt.fields[oldIdx].name !== newFields[i].name) renames.set(nt.fields[oldIdx].name, newFields[i].name);
  });
  if (renames.size) {
    for (const t of nt.templates) {
      t.qfmt = renameFieldRefs(t.qfmt, renames);
      t.afmt = renameFieldRefs(t.afmt, renames);
    }
  }
  nt.fields = newFields;
  if (nt.sortf >= newFields.length) nt.sortf = 0;
  nt.mod = Date.now();
  await db.commit({ put: { notetypes: [nt], notes } });
}

/** Rewrite {{Field}}, {{#Field}}, {{filter:Field}} references. renames: Map(old -> new) */
export function renameFieldRefs(tmpl, renames) {
  return tmpl.replace(/\{\{([^{}]*?)\}\}/g, (m, inner) => {
    const parts = inner.split(':');
    const last = parts.pop();
    const prefix = /^\s*[#^/]/.test(last) ? last.trim()[0] : '';
    const bare = (prefix ? last.trim().slice(1) : last).trim();
    if (!renames.has(bare)) return m;
    return `{{${[...parts, prefix + renames.get(bare)].join(':')}}}`;
  });
}

// ---------- search ----------
function tokenize(q) {
  const out = [];
  const re = /(-?)(?:(\w+):)?(?:"([^"]*)"|(\S+))/g;
  let m;
  while ((m = re.exec(q))) out.push({ neg: !!m[1], key: m[2]?.toLowerCase() || '', val: (m[3] ?? m[4] ?? '').toLowerCase() });
  return out;
}

function globRe(s) {
  return new RegExp('^' + s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
}

/** Search cards. Supports text, deck:, tag:, is:new|learn|review|due|suspended|buried, note:, card:, prop:ivl>n */
export function searchCards(query) {
  const tokens = tokenize(query || '');
  const t = today();
  const nowTs = Date.now();
  const preds = tokens.map(({ neg, key, val }) => {
    let fn;
    if (key === 'deck') {
      const re = globRe(val);
      const ids = new Set();
      for (const d of col.decks.values()) if (re.test(d.name)) for (const id of deckSubtree(d.id)) ids.add(id);
      fn = (c) => ids.has(c.did);
    } else if (key === 'tag') {
      const re = globRe(val);
      fn = (c, n) => n.tags.some((tg) => re.test(tg) || tg.toLowerCase().startsWith(val + '::'));
    } else if (key === 'is') {
      fn = {
        new: (c) => c.type === 0,
        learn: (c) => c.type === 1 || c.type === 3,
        review: (c) => c.type === 2 || c.type === 3,
        due: (c) => !c.suspended && ((c.type === 2 && c.due <= t) || ((c.type === 1 || c.type === 3) && c.due <= nowTs)),
        suspended: (c) => c.suspended,
        buried: (c) => c.buried === t,
      }[val] || (() => true);
    } else if (key === 'note') {
      const re = globRe(val);
      fn = (c, n) => re.test(col.notetypes.get(n.ntid)?.name || '');
    } else if (key === 'card') {
      fn = (c, n) => {
        const nt = col.notetypes.get(n.ntid);
        return String(c.ord + 1) === val || (nt?.templates[c.ord]?.name || '').toLowerCase() === val;
      };
    } else if (key === 'flag') {
      fn = (c) => String(c.flags || 0) === val;
    } else if (key === 'nid') {
      fn = (c) => String(c.nid) === val;
    } else if (key === 'prop') {
      const m = /^(ivl|due|reps|lapses|ease)(<=|>=|!=|=|<|>)(-?[\d.]+)$/.exec(val);
      fn = (c) => {
        if (!m) return true;
        const v = m[1] === 'ease' ? c.factor / 1000 : m[1] === 'due' ? (c.type === 2 ? c.due - t : NaN) : c[m[1]];
        const x = parseFloat(m[3]);
        return { '<': v < x, '>': v > x, '<=': v <= x, '>=': v >= x, '=': v === x, '!=': v !== x }[m[2]];
      };
    } else {
      const text = key ? `${key}:${val}` : val;
      if (text.includes('*')) {
        const re = new RegExp(text.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'), 'i');
        fn = (c, n) => re.test(searchText(n));
      } else {
        fn = (c, n) => searchText(n).includes(text);
      }
    }
    return neg ? (c, n) => !fn(c, n) : fn;
  });
  const out = [];
  for (const c of col.cards.values()) {
    const n = col.notes.get(c.nid);
    if (!n) continue;
    if (preds.every((p) => p(c, n))) out.push(c);
  }
  return out;
}

const searchCache = new WeakMap();
function searchText(n) {
  let e = searchCache.get(n);
  if (!e || e.mod !== n.mod) searchCache.set(n, (e = { mod: n.mod, text: stripHtml(n.fields.join(' ')).toLowerCase() }));
  return e.text;
}

export function splitTagInput(s) {
  return splitTags(s);
}

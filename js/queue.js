// Builds study queues and deck counts with per-deck daily limits.
import { col, childDecks, deckLimits, deckSubtree, ensureCountsToday, today } from './col.js';
import { dayStart } from './sched.js';

export function indexByDeck() {
  const idx = new Map();
  for (const c of col.cards.values()) {
    let arr = idx.get(c.did);
    if (!arr) idx.set(c.did, (arr = []));
    arr.push(c);
  }
  return idx;
}

function doneInSubtree(did, map) {
  let n = 0;
  for (const id of deckSubtree(did)) n += map[id] || 0;
  return n;
}

function newLeft(did) {
  const counts = ensureCountsToday();
  const lim = deckLimits(did).newPerDay + (counts.extendNew[did] || 0);
  return Math.max(0, lim - doneInSubtree(did, counts.new));
}

function revLeft(did) {
  const counts = ensureCountsToday();
  return Math.max(0, deckLimits(did).revPerDay - doneInSubtree(did, counts.rev));
}

function shuffleSeeded(arr, seed) {
  let s = seed >>> 0;
  for (let i = arr.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function gather(did, kind, idx, t) {
  const own = (idx.get(did) || []).filter((c) => !c.suspended && c.buried !== t && (kind === 'new' ? c.type === 0 : c.type === 2 && c.due <= t));
  if (kind === 'new') {
    if (col.config.newOrder === 'random') {
      // random by note, stable for the day
      const seed = t;
      own.sort((a, b) => a.due - b.due || a.ord - b.ord);
      const groups = new Map();
      for (const c of own) (groups.get(c.nid) || groups.set(c.nid, []).get(c.nid)).push(c);
      own.length = 0;
      for (const g of shuffleSeeded([...groups.values()], seed + did)) own.push(...g);
    } else own.sort((a, b) => a.due - b.due || a.ord - b.ord);
  }
  let all = own;
  for (const ch of childDecks(did)) all = all.concat(gather(ch.id, kind, idx, t));
  if (kind === 'rev') {
    shuffleSeeded(all, t);
    all.sort((a, b) => a.due - b.due);
  }
  const left = kind === 'new' ? newLeft(did) : revLeft(did);
  return all.length > left ? all.slice(0, left) : all;
}

function learning(did, idx, t) {
  const ids = deckSubtree(did);
  const end = dayStart(t + 1, col.config.rollover);
  const out = [];
  for (const id of ids) for (const c of idx.get(id) || []) if ((c.type === 1 || c.type === 3) && !c.suspended && c.buried !== t && c.due < end) out.push(c);
  return out.sort((a, b) => a.due - b.due);
}

export function deckCounts(did, idx = indexByDeck()) {
  const t = today();
  return { new: gather(did, 'new', idx, t).length, learn: learning(did, idx, t).length, rev: gather(did, 'rev', idx, t).length };
}

/** Total cards in a deck subtree. */
export function deckTotal(did, idx = indexByDeck()) {
  let n = 0;
  for (const id of deckSubtree(did)) n += (idx.get(id) || []).length;
  return n;
}

export class StudyQueue {
  constructor(did) {
    this.did = did;
    this.shown = 0;
    this.newShown = 0;
    this.refresh();
  }

  refresh() {
    const idx = indexByDeck();
    const t = today();
    this.day = t;
    this.newQ = gather(this.did, 'new', idx, t);
    this.revQ = gather(this.did, 'rev', idx, t);
    this.learnQ = learning(this.did, idx, t);
    this.ids = deckSubtree(this.did);
  }

  counts() {
    return { new: this.newQ.length, learn: this.learnQ.length, rev: this.revQ.length };
  }

  /** Returns the next card to study or null. */
  next(exclude = null) {
    if (today() !== this.day) this.refresh();
    const nowTs = Date.now();
    this.learnQ.sort((a, b) => a.due - b.due);
    const lrn = this.learnQ.find((c) => c.due <= nowTs && c !== exclude);
    if (lrn) return lrn;
    const pickNew = () => {
      if (!this.newQ.length) return false;
      if (!this.revQ.length) return true;
      const mix = col.config.newMix;
      if (mix === 'first') return true;
      if (mix === 'last') return false;
      // spread new cards evenly through reviews
      const total = this.newQ.length + this.revQ.length + this.shown;
      const target = ((this.shown + 1) * (this.newQ.length + this.newShown)) / Math.max(1, total);
      return this.newShown < target;
    };
    if (this.newQ.length || this.revQ.length) return pickNew() ? this.newQ[0] : this.revQ[0];
    const ahead = nowTs + col.config.learnAheadMins * 60_000;
    const next = this.learnQ.find((c) => c !== exclude && c.due <= ahead) || this.learnQ.find((c) => c.due <= ahead);
    return next || null;
  }

  /** Call after a card has been answered (card already mutated). */
  answered(card, wasType) {
    this.shown++;
    if (wasType === 0) this.newShown++;
    this.newQ = this.newQ.filter((c) => c !== card);
    this.revQ = this.revQ.filter((c) => c !== card);
    this.learnQ = this.learnQ.filter((c) => c !== card);
    const end = dayStart(this.day + 1, col.config.rollover);
    if ((card.type === 1 || card.type === 3) && card.due < end && !card.suspended) this.learnQ.push(card);
  }

  remove(card) {
    this.newQ = this.newQ.filter((c) => c !== card);
    this.revQ = this.revQ.filter((c) => c !== card);
    this.learnQ = this.learnQ.filter((c) => c !== card);
  }

  /** Put a card back (undo). */
  restore(card) {
    this.remove(card);
    this.shown = Math.max(0, this.shown - 1);
    if (card.type === 0) {
      this.newShown = Math.max(0, this.newShown - 1);
      this.newQ.unshift(card);
    } else if (card.type === 2) this.revQ.unshift(card);
    else this.learnQ.push(card);
  }

  /** Time until the next learning card is due (ms) or null. */
  nextLearnIn() {
    if (!this.learnQ.length) return null;
    return Math.min(...this.learnQ.map((c) => c.due)) - Date.now();
  }
}

// Anki card template rendering: {{Field}}, {{#Field}}..{{/Field}}, {{^Field}}, filters
// (cloze, type, hint, text, furigana, kana, kanji) and {{FrontSide}}. Pure, no DOM.
import { escapeHtml, fieldIsEmpty, stripHtml } from './util.js';

const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;
const SPECIAL = new Set(['FrontSide', 'Tags', 'Type', 'Deck', 'Subdeck', 'Card', 'CardFlag']);

function parse(src) {
  const root = { children: [] };
  const stack = [root];
  const re = /\{\{([\s\S]*?)\}\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m.index > last) top.children.push({ text: src.slice(last, m.index) });
    last = re.lastIndex;
    const tag = m[1].trim();
    if (tag[0] === '#' || tag[0] === '^') {
      const node = { section: tag.slice(1).trim(), inverted: tag[0] === '^', children: [] };
      top.children.push(node);
      stack.push(node);
    } else if (tag[0] === '/') {
      const name = tag.slice(1).trim();
      // pop to matching section (tolerate mismatches)
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].section === name) {
          stack.length = i;
          break;
        }
      }
    } else if (tag[0] === '!' || tag === '') {
      // comment / empty
    } else {
      top.children.push({ field: tag });
    }
  }
  if (last < src.length) stack[stack.length - 1].children.push({ text: src.slice(last) });
  return root;
}

const cache = new Map();
function parsed(src) {
  let p = cache.get(src);
  if (!p) {
    p = parse(src);
    if (cache.size > 200) cache.clear();
    cache.set(src, p);
  }
  return p;
}

function lookup(ctx, name) {
  if (name in ctx.fields) return { value: ctx.fields[name], real: !SPECIAL.has(name) };
  const lower = name.toLowerCase();
  for (const k of Object.keys(ctx.fields)) if (k.toLowerCase() === lower) return { value: ctx.fields[k], real: true };
  return null;
}

function renderNodes(nodes, ctx) {
  let out = '';
  for (const n of nodes) {
    if (n.text != null) out += n.text;
    else if (n.section != null) {
      const f = lookup(ctx, n.section);
      const nonEmpty = f ? !fieldIsEmpty(f.value) : false;
      if (nonEmpty !== n.inverted) out += renderNodes(n.children, ctx);
    } else out += renderField(n.field, ctx);
  }
  return out;
}

function renderField(tag, ctx) {
  const parts = tag.split(':');
  let name = parts.pop().trim();
  let filters = parts.map((p) => p.trim()).filter(Boolean);
  // "tts lang:..." style filters: treat anything with a space as tts and drop output
  if (filters.some((f) => f.startsWith('tts'))) return '';
  const f = lookup(ctx, name);
  if (!f) return filters.length ? '' : `<span class="tmpl-error">{unknown field ${escapeHtml(name)}}</span>`;
  let value = f.value ?? '';
  if (f.real && !fieldIsEmpty(value)) ctx.nonEmpty = true;

  // the type: filter must be outermost; handle it specially
  if (filters[0] === 'type') {
    filters = filters.slice(1);
    let expected;
    if (filters.includes('cloze')) expected = clozeAnswers(value, ctx.ord + 1).join(', ');
    else expected = value;
    ctx.typeAnswer = stripHtml(expected);
    return '<span data-type-answer="1"></span>';
  }

  for (let i = filters.length - 1; i >= 0; i--) value = applyFilter(filters[i], value, name, ctx);
  return value;
}

function applyFilter(filter, value, name, ctx) {
  switch (filter) {
    case 'text':
      return escapeHtml(stripHtml(value));
    case 'cloze':
      return renderCloze(value, ctx.ord + 1, ctx.answer);
    case 'cloze-only':
      return clozeAnswers(value, ctx.ord + 1).join(', ');
    case 'hint':
      if (fieldIsEmpty(value)) return '';
      return `<details class="hint"><summary>${escapeHtml(name)}</summary>${value}</details>`;
    case 'furigana':
      return furigana(value, (base, reading) => `<ruby><rb>${base}</rb><rt>${reading}</rt></ruby>`);
    case 'kana':
      return furigana(value, (_b, reading) => reading);
    case 'kanji':
      return furigana(value, (base) => base);
    default:
      return value;
  }
}

function furigana(value, fn) {
  return value.replace(/ ?([^ >]+?)\[(.+?)\]/g, (m, base, reading) => (reading.startsWith('sound:') ? m : fn(base, reading)));
}

export function renderCloze(text, n, answer) {
  return text.replace(CLOZE_RE, (_m, num, body, hint) => {
    if (Number(num) !== n) return `<span class="cloze-inactive">${body}</span>`;
    if (answer) return `<span class="cloze">${body}</span>`;
    return `<span class="cloze">[${hint ? escapeHtml(stripHtml(hint)) : '...'}]</span>`;
  });
}

export function clozeAnswers(text, n) {
  const out = [];
  for (const m of String(text).matchAll(CLOZE_RE)) if (Number(m[1]) === n) out.push(m[2]);
  return out;
}

/** All cloze numbers present in the given field values. */
export function clozeNumbers(values) {
  const set = new Set();
  for (const v of values) for (const m of String(v).matchAll(CLOZE_RE)) set.add(Number(m[1]));
  return [...set].filter((n) => n > 0).sort((a, b) => a - b);
}

function buildFields(notetype, note, extra) {
  const fields = {};
  notetype.fields.forEach((f, i) => (fields[f.name] = note.fields[i] ?? ''));
  return Object.assign(fields, extra);
}

/** Does the template at `ord` produce a non-empty front for this note? */
export function templateHasContent(notetype, note, ord) {
  const t = notetype.templates[ord];
  if (!t) return false;
  const ctx = { fields: buildFields(notetype, note, { Tags: '', Type: '', Deck: '', Subdeck: '', Card: '', CardFlag: '' }), ord, answer: false, nonEmpty: false };
  renderNodes(parsed(t.qfmt).children, ctx);
  return ctx.nonEmpty;
}

/** Which card ordinals should exist for a note. */
export function cardOrdinals(notetype, note) {
  if (notetype.kind === 1) return clozeNumbers(note.fields).map((n) => n - 1);
  const ords = [];
  notetype.templates.forEach((_t, i) => {
    if (templateHasContent(notetype, note, i)) ords.push(i);
  });
  return ords;
}

/**
 * Render question and answer HTML for a card.
 * Returns { q, a, typeAnswer } where q/a may contain a
 * <span data-type-answer="1"></span> placeholder for type-in answers.
 */
export function renderCard(notetype, note, card, info = {}) {
  const tmpl = notetype.kind === 1 ? notetype.templates[0] : notetype.templates[card.ord] || notetype.templates[0];
  const deck = info.deck || '';
  const extra = {
    Tags: (note.tags || []).join(' '),
    Type: notetype.name,
    Deck: deck,
    Subdeck: deck.split('::').pop(),
    Card: tmpl?.name || '',
    CardFlag: card.flags ? `flag${card.flags}` : '',
  };
  const fields = buildFields(notetype, note, extra);
  const qctx = { fields, ord: card.ord, answer: false };
  const q = renderNodes(parsed(tmpl?.qfmt || '').children, qctx);
  const front = q.replace(/<span data-type-answer="1"><\/span>/g, '');
  const actx = { fields: { ...fields, FrontSide: front }, ord: card.ord, answer: true };
  const a = renderNodes(parsed(tmpl?.afmt || '').children, actx);
  return { q, a, typeAnswer: qctx.typeAnswer ?? actx.typeAnswer ?? null };
}

/** Character-level comparison like Anki's type-in answer feedback. */
export function typeCompareHtml(typed, expected) {
  typed = typed.trim();
  expected = expected.trim();
  if (typed === expected) return `<div class="typecmp"><span class="typeGood">${escapeHtml(expected)}</span></div>`;
  const a = [...typed].slice(0, 400);
  const b = [...expected].slice(0, 400);
  // LCS table
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0;
  let j = 0;
  let typedOut = '';
  let expOut = '';
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      typedOut += `<span class="typeGood">${escapeHtml(a[i])}</span>`;
      expOut += `<span class="typeGood">${escapeHtml(b[j])}</span>`;
      i++;
      j++;
    } else if (j < b.length && (i >= a.length || dp[i][j + 1] >= dp[i + 1][j])) {
      expOut += `<span class="typeMissed">${escapeHtml(b[j])}</span>`;
      j++;
    } else {
      typedOut += `<span class="typeBad">${escapeHtml(a[i])}</span>`;
      i++;
    }
  }
  return `<div class="typecmp">${typed ? `${typedOut}<br><span class="typeArrow">↓</span><br>` : ''}${expOut}</div>`;
}

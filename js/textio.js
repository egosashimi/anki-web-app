// Plain text / CSV import and export helpers. Pure.

const SEPARATORS = { tab: '\t', comma: ',', semicolon: ';', pipe: '|', colon: ':', space: ' ' };

/** Parse delimited text with quoted fields ("a ""b""", newlines inside quotes). */
export function parseDelimited(text, sep) {
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let quoted = false;
  let atStart = true;
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && atStart) {
      quoted = true;
      atStart = false;
      i++;
      continue;
    }
    if (ch === sep) {
      row.push(field);
      field = '';
      atStart = true;
      i++;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      atStart = true;
      if (ch === '\r' && text[i + 1] === '\n') i++;
      i++;
      continue;
    }
    field += ch;
    atStart = false;
    i++;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

/**
 * Parse an Anki-style text export or a generic CSV/TSV.
 * Returns { rows, separator, html, tagsColumn, deckColumn, notetypeColumn, guidColumn, deck, notetype }
 */
export function parseTextFile(text) {
  text = text.replace(/^﻿/, '');
  const meta = { html: null, tagsColumn: null, deckColumn: null, notetypeColumn: null, guidColumn: null, separator: null, deck: null, notetype: null };
  const lines = text.split(/\r?\n/);
  let start = 0;
  while (start < lines.length && lines[start].startsWith('#')) {
    const m = /^#([\w ]+):(.*)$/.exec(lines[start]);
    if (m) {
      const key = m[1].trim().toLowerCase();
      const val = m[2].trim();
      if (key === 'separator') meta.separator = SEPARATORS[val.toLowerCase()] ?? val[0];
      else if (key === 'html') meta.html = val.toLowerCase() === 'true';
      else if (key === 'tags column') meta.tagsColumn = parseInt(val, 10) - 1;
      else if (key === 'deck column') meta.deckColumn = parseInt(val, 10) - 1;
      else if (key === 'notetype column') meta.notetypeColumn = parseInt(val, 10) - 1;
      else if (key === 'guid column') meta.guidColumn = parseInt(val, 10) - 1;
      else if (key === 'deck') meta.deck = val;
      else if (key === 'notetype') meta.notetype = val;
    }
    start++;
  }
  const body = lines.slice(start).join('\n');
  const sep = meta.separator ?? detectSeparator(body);
  const rows = parseDelimited(body, sep);
  const html = meta.html ?? /<[a-z][\s\S]*?>/i.test(body);
  return { ...meta, separator: sep, html, rows };
}

export function detectSeparator(text) {
  const sample = text.split(/\r?\n/).filter(Boolean).slice(0, 20);
  let best = '\t';
  let bestScore = -1;
  for (const sep of ['\t', ';', ',', '|']) {
    const counts = sample.map((l) => l.split(sep).length - 1);
    if (!counts.length || !counts[0]) continue;
    const consistent = counts.filter((c) => c === counts[0]).length;
    const score = consistent * 10 + Math.min(...counts);
    if (score > bestScore) {
      best = sep;
      bestScore = score;
    }
  }
  return best;
}

function quote(field, sep) {
  if (field.includes(sep) || field.includes('"') || field.includes('\n') || field.includes('\r')) return `"${field.replace(/"/g, '""')}"`;
  return field;
}

/** rows: [{ fields: [...], tags: [...], deck, notetype, guid }] */
export function serializeText(rows, { deckColumn = false, notetypeColumn = false, guidColumn = false } = {}) {
  const sep = '\t';
  const header = ['#separator:tab', '#html:true'];
  let col = 1;
  const extraCols = [];
  if (guidColumn) {
    header.push(`#guid column:${col++}`);
    extraCols.push('guid');
  }
  if (notetypeColumn) {
    header.push(`#notetype column:${col++}`);
    extraCols.push('notetype');
  }
  if (deckColumn) {
    header.push(`#deck column:${col++}`);
    extraCols.push('deck');
  }
  const maxFields = Math.max(0, ...rows.map((r) => r.fields.length));
  header.push(`#tags column:${col + maxFields}`);
  const lines = rows.map((r) => {
    const fields = [...r.fields];
    while (fields.length < maxFields) fields.push('');
    return [...extraCols.map((k) => r[k] ?? ''), ...fields, r.tags.join(' ')].map((f) => quote(String(f), sep)).join(sep);
  });
  return header.join('\n') + '\n' + lines.join('\n') + '\n';
}

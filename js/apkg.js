// Read and write Anki packages (.apkg / .colpkg). Pure: libraries are injected so
// this module can run in the browser and in Node tests.
//   libs = { SQL (initialised sql.js), unzipSync, zipSync, zstdDecompress }
import { stripHtml } from './util.js';

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const isZstd = (b) => b && b.length > 4 && ZSTD_MAGIC.every((x, i) => b[i] === x);
const td = new TextDecoder();
const te = new TextEncoder();

// ---------- minimal protobuf decoding ----------
function readVarint(buf, pos) {
  let result = 0;
  let shift = 0;
  let b;
  do {
    b = buf[pos++];
    result += (b & 0x7f) * 2 ** shift;
    shift += 7;
  } while (b & 0x80);
  return [result, pos];
}

/** Decode a protobuf message into { fieldNumber: [values] } (varints as numbers, bytes as Uint8Array). */
export function pbDecode(buf) {
  const out = {};
  let pos = 0;
  while (pos < buf.length) {
    let key;
    [key, pos] = readVarint(buf, pos);
    const field = Math.floor(key / 8);
    const wire = key & 7;
    let val;
    if (wire === 0) [val, pos] = readVarint(buf, pos);
    else if (wire === 1) {
      val = buf.subarray(pos, pos + 8);
      pos += 8;
    } else if (wire === 2) {
      let len;
      [len, pos] = readVarint(buf, pos);
      val = buf.subarray(pos, pos + len);
      pos += len;
    } else if (wire === 5) {
      val = buf.subarray(pos, pos + 4);
      pos += 4;
    } else throw new Error('Unsupported protobuf wire type ' + wire);
    (out[field] ||= []).push(val);
  }
  return out;
}
const pbStr = (m, f) => (m[f]?.[0] ? td.decode(m[f][0]) : '');
const pbNum = (m, f) => (typeof m[f]?.[0] === 'number' ? m[f][0] : 0);

function rows(db, sql) {
  const res = db.exec(sql);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])));
}

/**
 * Parse an Anki package. Returns plain data:
 * { crt, notetypes, decks, notes, cards, revlog, media: [{ name, data: () => Uint8Array }] }
 */
export function readApkg(bytes, libs) {
  const files = libs.unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  let colBytes = files['collection.anki21b'] || files['collection.anki21'] || files['collection.anki2'];
  if (!colBytes) throw new Error('Not an Anki package: no collection found');
  if (isZstd(colBytes)) colBytes = libs.zstdDecompress(colBytes);
  const db = new libs.SQL.Database(colBytes);
  try {
    const tables = new Set(rows(db, "select name from sqlite_master where type='table'").map((r) => r.name));
    const colRow = rows(db, 'select * from col')[0] || {};
    const crt = Number(colRow.crt) || Math.floor(Date.now() / 1000);
    let notetypes = [];
    let decks = [];
    if (tables.has('notetypes')) {
      // schema 15+: note types and decks live in their own tables (protobuf configs)
      const fields = rows(db, 'select ntid, ord, name from fields');
      const templates = rows(db, 'select ntid, ord, name, config from templates');
      for (const r of rows(db, 'select id, name, config from notetypes')) {
        const cfg = pbDecode(r.config || new Uint8Array());
        notetypes.push({
          id: Number(r.id),
          name: r.name,
          kind: pbNum(cfg, 1),
          sortf: pbNum(cfg, 2),
          css: pbStr(cfg, 3),
          fields: fields.filter((f) => f.ntid === r.id).sort((a, b) => a.ord - b.ord).map((f) => ({ name: f.name })),
          templates: templates
            .filter((t) => t.ntid === r.id)
            .sort((a, b) => a.ord - b.ord)
            .map((t) => {
              const c = pbDecode(t.config || new Uint8Array());
              return { name: t.name, qfmt: pbStr(c, 1), afmt: pbStr(c, 2) };
            }),
        });
      }
      decks = rows(db, 'select id, name from decks').map((d) => ({ id: Number(d.id), name: String(d.name).split('\x1f').join('::') }));
    } else {
      const models = JSON.parse(colRow.models || '{}');
      notetypes = Object.values(models).map((m) => ({
        id: Number(m.id),
        name: m.name,
        kind: m.type || 0,
        sortf: m.sortf || 0,
        css: m.css || '',
        fields: [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => ({ name: f.name })),
        templates: [...m.tmpls].sort((a, b) => a.ord - b.ord).map((t) => ({ name: t.name, qfmt: t.qfmt, afmt: t.afmt })),
      }));
      decks = Object.values(JSON.parse(colRow.decks || '{}')).map((d) => ({ id: Number(d.id), name: d.name, dyn: !!d.dyn }));
    }
    const notes = rows(db, 'select id, guid, mid, mod, tags, flds from notes').map((n) => ({
      id: Number(n.id),
      guid: n.guid,
      mid: Number(n.mid),
      mod: Number(n.mod),
      tags: String(n.tags).trim().split(/\s+/).filter(Boolean),
      fields: String(n.flds).split('\x1f'),
    }));
    const cards = rows(db, 'select id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags from cards').map((c) =>
      Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]))
    );
    const revlog = tables.has('revlog')
      ? rows(db, 'select id, cid, ease, ivl, lastIvl, factor, time, type from revlog').map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)])))
      : [];

    // media
    const media = [];
    let list = files['media'];
    if (list && list.length) {
      if (isZstd(list)) list = libs.zstdDecompress(list);
      if (list[0] === 0x7b /* { */) {
        for (const [k, name] of Object.entries(JSON.parse(td.decode(list)))) if (files[k]) media.push(mediaEntry(name, files[k], libs));
      } else {
        const entries = pbDecode(list)[1] || [];
        entries.forEach((e, i) => {
          const m = pbDecode(e);
          const name = pbStr(m, 1);
          const zipName = m[255] ? String(pbNum(m, 255)) : String(i);
          if (name && files[zipName]) media.push(mediaEntry(name, files[zipName], libs));
        });
      }
    }
    return { crt, notetypes, decks, notes, cards, revlog, media };
  } finally {
    db.close();
  }
}

function mediaEntry(name, raw, libs) {
  return { name, data: () => (isZstd(raw) ? libs.zstdDecompress(raw) : raw) };
}

// ---------- writing (schema 11 legacy package, importable by all Anki versions) ----------
const SCHEMA = `
create table col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
create table notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
create table cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
create table revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
create table graves (usn integer not null, oid integer not null, type integer not null);
create index ix_notes_usn on notes (usn);
create index ix_cards_usn on cards (usn);
create index ix_revlog_usn on revlog (usn);
create index ix_cards_nid on cards (nid);
create index ix_cards_sched on cards (did, queue, due);
create index ix_revlog_cid on revlog (cid);
create index ix_notes_csum on notes (csum);
`;

const LATEX_PRE =
  '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n';

function deckJson(id, name, mod) {
  return {
    id, name, mod, usn: -1, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0],
    collapsed: false, browserCollapsed: false, desc: '', dyn: 0, conf: 1, extendNew: 0, extendRev: 0,
  };
}

function dconfJson(conf) {
  return {
    1: {
      id: 1, name: 'Default', replayq: true, maxTaken: 60, timer: 0, autoplay: true, mod: 0, usn: 0, dyn: false,
      lapse: { delays: conf.relearnSteps, mult: conf.lapseMult, minInt: conf.minIvl, leechFails: conf.leechThreshold, leechAction: conf.leechAction === 'suspend' ? 0 : 1 },
      rev: { perDay: conf.revPerDay, ease4: conf.easyBonus, fuzz: 0.05, minSpace: 1, ivlFct: conf.ivlMod, maxIvl: conf.maxIvl, bury: false, hardFactor: conf.hardIvl },
      new: { perDay: conf.newPerDay, delays: conf.learnSteps, separate: true, ints: [conf.graduatingIvl, conf.easyIvl, 7], initialFactor: Math.round(conf.startingEase * 1000), bury: false, order: 1 },
    },
  };
}

function modelJson(nt, mod) {
  const req = nt.templates.map((t, ord) => {
    const used = nt.fields.map((f, i) => (t.qfmt.includes(f.name) ? i : -1)).filter((i) => i >= 0);
    return [ord, 'any', used];
  });
  return {
    id: nt.id, name: nt.name, type: nt.kind, mod, usn: -1, sortf: nt.sortf || 0, did: null,
    tmpls: nt.templates.map((t, ord) => ({ name: t.name, ord, qfmt: t.qfmt, afmt: t.afmt, bqfmt: '', bafmt: '', did: null, bfont: '', bsize: 0 })),
    flds: nt.fields.map((f, ord) => ({ name: f.name, ord, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] })),
    css: nt.css || '', latexPre: LATEX_PRE, latexPost: '\\end{document}', latexsvg: false, req, tags: [], vers: [],
  };
}

/** Collect media filenames referenced by note fields. */
export function referencedMedia(fieldValues) {
  const names = new Set();
  for (const v of fieldValues) {
    for (const m of String(v).matchAll(/<(?:img|audio|video|source)\b[^>]*?\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)) names.add(decodeURIComponent(m[1] || m[2] || m[3]));
    for (const m of String(v).matchAll(/\[sound:([^\]]+)\]/g)) names.add(m[1]);
  }
  return [...names].filter((n) => !/^(https?:|data:|blob:)/i.test(n));
}

/**
 * Build an .apkg.
 * data = { notetypes, decks, notes, cards, revlog, media: [{ name, data: Uint8Array }], conf, includeScheduling,
 *          today (day number), dayStartMs(day) -> ms, csum(text) -> int (sync) }
 */
export function writeApkg(data, libs) {
  const db = new libs.SQL.Database();
  try {
    db.run(SCHEMA);
    const { conf } = data;
    const sched = data.includeScheduling;
    const nowSec = Math.floor(Date.now() / 1000);
    let crtDay = data.today;
    if (sched) for (const c of data.cards) if (c.type === 2) crtDay = Math.min(crtDay, c.due);
    crtDay -= 1;
    const crt = Math.floor(data.dayStartMs(crtDay) / 1000);

    const decks = { 1: deckJson(1, 'Default', nowSec) };
    for (const d of data.decks) decks[d.id] = deckJson(d.id, d.name, nowSec);
    const models = {};
    for (const nt of data.notetypes) models[nt.id] = modelJson(nt, nowSec);
    const colConf = {
      nextPos: 1, estTimes: true, activeDecks: [1], sortType: 'noteFld', timeLim: 0, sortBackwards: false, addToCur: true,
      curDeck: 1, newBury: true, newSpread: 0, dueCounts: true, curModel: data.notetypes[0]?.id ?? null, collapseTime: 1200, rollover: conf.rollover,
    };
    db.run('insert into col values (1,?,?,?,11,0,0,0,?,?,?,?,?)', [
      crt, nowSec * 1000, nowSec * 1000, JSON.stringify(colConf), JSON.stringify(models), JSON.stringify(decks), JSON.stringify(dconfJson(conf)), '{}',
    ]);

    db.run('begin');
    const nstmt = db.prepare('insert into notes values (?,?,?,?,?,?,?,?,?,?,?)');
    const ntById = new Map(data.notetypes.map((n) => [n.id, n]));
    for (const n of data.notes) {
      const nt = ntById.get(n.ntid);
      const sfld = stripHtml(n.fields[nt?.sortf || 0] ?? '');
      nstmt.run([n.id, n.guid, n.ntid, Math.floor((n.mod || Date.now()) / 1000), -1, n.tags.length ? ` ${n.tags.join(' ')} ` : '', n.fields.join('\x1f'), sfld, data.csum(sfld), 0, '']);
    }
    nstmt.free();

    const cstmt = db.prepare('insert into cards values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    let pos = 0;
    const posMap = new Map();
    for (const c of data.cards) {
      let type = 0, queue = 0, due, ivl = 0, factor = 0, reps = 0, lapses = 0, left = 0;
      const newPos = () => {
        if (!posMap.has(c.nid)) posMap.set(c.nid, ++pos);
        return posMap.get(c.nid);
      };
      if (!sched || c.type === 0) due = newPos();
      else {
        type = c.type;
        ivl = c.ivl;
        factor = c.factor;
        reps = c.reps;
        lapses = c.lapses;
        if (c.type === 2) {
          queue = 2;
          due = c.due - crtDay;
        } else {
          queue = 1;
          due = Math.floor(c.due / 1000);
          const steps = c.type === 3 ? conf.relearnSteps : conf.learnSteps;
          const remaining = Math.max(1, steps.length - (c.step || 0));
          left = remaining * 1000 + remaining;
        }
      }
      if (c.suspended) queue = -1;
      cstmt.run([c.id, c.nid, c.did, c.ord, Math.floor((c.mod || Date.now()) / 1000), -1, type, queue, due, ivl, factor, reps, lapses, left, 0, 0, c.flags || 0, '']);
    }
    cstmt.free();

    if (sched && data.revlog?.length) {
      const rstmt = db.prepare('insert or ignore into revlog values (?,?,?,?,?,?,?,?,?)');
      for (const r of data.revlog) rstmt.run([r.id, r.cid, -1, r.ease, r.ivl, r.lastIvl, r.factor, r.time, r.type]);
      rstmt.free();
    }
    db.run('commit');

    const zipFiles = { 'collection.anki2': [db.export(), { level: 6 }] };
    const mediaMap = {};
    data.media.forEach((m, i) => {
      mediaMap[i] = m.name;
      zipFiles[String(i)] = [m.data, { level: 0 }];
    });
    zipFiles['media'] = te.encode(JSON.stringify(mediaMap));
    return libs.zipSync(zipFiles);
  } finally {
    db.close();
  }
}

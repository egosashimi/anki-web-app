import { back, go } from '../app.js';
import { col, ensureDeck, sortedDecks } from '../col.js';
import { exportApkg, exportBackup, exportText, importApkg, importText, previewText, restoreBackup } from '../io.js';
import { confirmDialog, h, iconBtn, offerFile, pickFile, progressSheet, segmented, setHeader, sheet, switchEl, toast } from '../ui.js';
import { plural, splitTags, stripHtml } from '../util.js';

function resultSheet(title, lines) {
  let close;
  close = sheet(
    h('div', null,
      h('div', { class: 'group' }, lines.map(([k, v]) => h('div', { class: 'row' }, h('div', { class: 'grow' }, k), h('div', { class: 'val' }, String(v))))),
      h('button', { class: 'btn block primary', onclick: () => { close(); go('#/decks'); } }, 'Go to decks')
    ),
    { title }
  );
}

export function importView(main) {
  setHeader({ title: 'Import', left: [iconBtn('back', 'Back', () => back('#/settings'))] });
  const wrap = h('div', { class: 'wrap' });
  main.append(wrap);
  let includeScheduling = true;
  const body = h('div');

  const choose = async () => {
    const file = await pickFile();
    if (!file) return;
    const name = file.name.toLowerCase();
    if (name.endsWith('.apkg') || name.endsWith('.colpkg')) return doApkg(file);
    if (name.endsWith('.zip')) return doBackup(file);
    if (/\.(txt|csv|tsv|text)$/.test(name) || file.type.startsWith('text/')) return doText(file);
    // sniff: zip magic
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (head[0] === 0x50 && head[1] === 0x4b) return doApkg(file);
    return doText(file);
  };

  async function doApkg(file) {
    const p = progressSheet('Loading…');
    try {
      const stats = await importApkg(file, { includeScheduling, onProgress: p.set });
      p.close();
      resultSheet('Import complete', [
        ['New notes', stats.notes],
        ['Updated notes', stats.updated],
        ['Cards', stats.cards],
        ['Media files', stats.media],
        ['Skipped (already present)', stats.skipped],
      ]);
    } catch (e) {
      p.close();
      console.error(e);
      if (/^Not an Anki package/.test(e.message) || /zip/i.test(e.message)) {
        // maybe it's actually a backup
        try {
          return await doBackup(file, true);
        } catch {}
      }
      toast('Import failed: ' + e.message, { ms: 6000 });
    }
  }

  async function doBackup(file, silentFail = false) {
    if (!(await confirmDialog('Restoring a backup replaces everything currently on this device.', { title: 'Restore backup', ok: 'Restore', danger: true }))) return;
    const p = progressSheet('Restoring…');
    try {
      const r = await restoreBackup(file, { onProgress: p.set });
      p.close();
      resultSheet('Backup restored', [['Notes', r.notes], ['Cards', r.cards], ['Media files', r.media]]);
    } catch (e) {
      p.close();
      if (silentFail) throw e;
      toast('Restore failed: ' + e.message, { ms: 6000 });
    }
  }

  async function doText(file) {
    const text = await file.text();
    const parsed = previewText(text);
    if (!parsed.rows.length) return toast('No rows found in file');
    textOptions(parsed, file.name);
  }

  function textOptions(parsed, filename) {
    const nts = [...col.notetypes.values()].sort((a, b) => a.name.localeCompare(b.name));
    let nt = (parsed.notetype && nts.find((n) => n.name === parsed.notetype)) || nts.find((n) => n.name === 'Basic') || nts.find((n) => n.kind === 0) || nts[0];
    const decks = sortedDecks();
    const fallbackDeckName = filename.replace(/\.[^.]+$/, '');
    let did = (parsed.deck && decks.find((d) => d.name === parsed.deck)?.id) || null;
    let newDeckName = did ? null : parsed.deck || fallbackDeckName;
    let firstRowHeader = false;
    let skipDuplicates = true;
    let html = parsed.html;
    const ncols = Math.max(...parsed.rows.slice(0, 50).map((r) => r.length));
    let mapping = [];
    const defaultMapping = () => {
      mapping = [];
      let fi = 0;
      for (let i = 0; i < ncols; i++) {
        if (i === parsed.tagsColumn) mapping.push('tags');
        else if (i === parsed.deckColumn) mapping.push('deck');
        else if (i === parsed.guidColumn) mapping.push('guid');
        else if (i === parsed.notetypeColumn) mapping.push(null);
        else mapping.push(fi < nt.fields.length ? fi++ : null);
      }
    };
    defaultMapping();

    const box = h('div');
    const render = () => {
      const ntSel = h('select', { onchange: () => { nt = col.notetypes.get(Number(ntSel.value)); defaultMapping(); render(); } }, nts.map((n) => h('option', { value: n.id, selected: n.id === nt.id }, n.name)));
      const deckOpts = [h('option', { value: 'new', selected: did == null }, `New deck: ${newDeckName}`), ...decks.map((d) => h('option', { value: d.id, selected: d.id === did }, d.name))];
      const deckSel = h('select', { onchange: () => { did = deckSel.value === 'new' ? null : Number(deckSel.value); } }, deckOpts);
      const colSelect = (i) =>
        h('select', { onchange: (e) => { const v = e.target.value; mapping[i] = v === '' ? null : v === 'tags' || v === 'deck' || v === 'guid' ? v : Number(v); } },
          h('option', { value: '', selected: mapping[i] == null }, 'Ignore'),
          nt.fields.map((f, fi) => h('option', { value: fi, selected: mapping[i] === fi }, f.name)),
          h('option', { value: 'tags', selected: mapping[i] === 'tags' }, 'Tags'),
          h('option', { value: 'deck', selected: mapping[i] === 'deck' }, 'Deck'),
          h('option', { value: 'guid', selected: mapping[i] === 'guid' }, 'ID (guid)')
        );
      const sample = parsed.rows.slice(0, 5);
      const table = h('div', { class: 'preview-table' },
        h('table', null,
          h('thead', null, h('tr', null, Array.from({ length: ncols }, (_, i) => h('th', null, colSelect(i))))),
          h('tbody', null, sample.map((r) => h('tr', null, Array.from({ length: ncols }, (_, i) => h('td', null, stripHtml(r[i] ?? '').slice(0, 80))))))
        )
      );
      const toggle = (label, val, fn) => h('div', { class: 'row' }, h('div', { class: 'grow' }, label), switchEl(val, fn));
      box.replaceChildren(
        h('p', { class: 'msg' }, `${filename} · ${plural(parsed.rows.length, 'row')}`),
        h('label', { class: 'lbl' }, 'Note type'), ntSel,
        h('label', { class: 'lbl' }, 'Deck'), deckSel,
        h('label', { class: 'lbl' }, 'Columns'), table,
        h('div', { class: 'group', style: { marginTop: '14px' } },
          toggle('First row is a header', firstRowHeader, (v) => (firstRowHeader = v)),
          toggle('Allow HTML in fields', html, (v) => (html = v)),
          toggle('Skip duplicates', skipDuplicates, (v) => (skipDuplicates = v))
        ),
        h('label', { class: 'lbl' }, 'Extra tags'),
        extraTags,
        h('div', { class: 'actions' }, h('button', { class: 'btn block primary', onclick: run }, 'Import'))
      );
    };
    const extraTags = h('input', { type: 'text', placeholder: 'Optional, space separated', autocapitalize: 'off' });
    let close;
    const run = async () => {
      if (!mapping.some((m) => typeof m === 'number')) return toast('Map at least one column to a field');
      try {
        const deckId = did ?? (await ensureDeck(newDeckName)).id;
        const stats = await importText({ parsed: { ...parsed, html }, ntid: nt.id, did: deckId, mapping, skipDuplicates, firstRowHeader, extraTags: splitTags(extraTags.value) });
        close();
        resultSheet('Import complete', [['New notes', stats.notes], ['Updated notes', stats.updated], ['Cards', stats.cards], ['Skipped (duplicate)', stats.skipped], ['Skipped (no card produced)', stats.empty]].filter(([k, v]) => v || !k.startsWith('Skipped')));
      } catch (e) {
        toast('Import failed: ' + e.message);
      }
    };
    render();
    close = sheet(box, { title: 'Import text' });
  }

  body.append(
    h('div', { class: 'empty', style: { paddingTop: '8vh' } },
      h('h2', null, 'Import cards'),
      h('p', null, 'Anki packages (.apkg, .colpkg), text or CSV files, or a backup (.zip) from this app.'),
      h('button', { class: 'btn primary', onclick: choose }, 'Choose file…')
    ),
    h('div', { class: 'group' },
      h('div', { class: 'row' }, h('div', { class: 'grow' }, 'Include scheduling', h('div', { class: 'sub' }, 'Keep review history and due dates from Anki packages')), switchEl(includeScheduling, (v) => (includeScheduling = v)))
    ),
    h('p', { class: 'hint-text' }, 'Text files: one note per line, fields separated by tabs, commas or semicolons. Anki “Notes in Plain Text” exports are supported, including headers like #separator and #tags column.')
  );
  wrap.append(body);
}

export function exportView(main, _p, query) {
  setHeader({ title: 'Export', left: [iconBtn('back', 'Back', () => back('#/settings'))] });
  const wrap = h('div', { class: 'wrap' });
  main.append(wrap);
  let format = 'apkg';
  let did = Number(query.get('did')) || 0;
  if (did && !col.decks.has(did)) did = 0;
  let includeScheduling = true;
  let includeMedia = true;
  const opts = h('div');
  const decks = sortedDecks();

  const render = () => {
    const toggle = (label, sub, val, fn) => h('div', { class: 'row' }, h('div', { class: 'grow' }, label, sub ? h('div', { class: 'sub' }, sub) : null), switchEl(val, fn));
    const deckSel = h('select', { onchange: () => (did = Number(deckSel.value)) },
      h('option', { value: 0, selected: !did }, 'All decks'),
      decks.map((d) => h('option', { value: d.id, selected: d.id === did }, ' '.repeat(d.name.split('::').length - 1) + d.name.split('::').pop()))
    );
    opts.replaceChildren(...[
      format !== 'backup' ? h('div', null, h('label', { class: 'lbl' }, 'Deck'), deckSel) : null,
      format === 'apkg'
        ? h('div', { class: 'group', style: { marginTop: '16px' } },
            toggle('Include scheduling', 'Review history and due dates', includeScheduling, (v) => (includeScheduling = v)),
            toggle('Include media', 'Images and audio used by the cards', includeMedia, (v) => (includeMedia = v))
          )
        : null,
      h('p', { class: 'hint-text' },
        format === 'apkg' ? 'Opens in Anki desktop, AnkiMobile and AnkiDroid, or re-import here.' :
        format === 'text' ? 'Tab-separated notes with HTML, tags and IDs. Media is not included.' :
        'Everything on this device — decks, cards, history, media and settings — in one file you can restore later.'),
      h('button', { class: 'btn block primary mt', onclick: run }, 'Export'),
    ].filter(Boolean));
  };

  async function run() {
    const p = progressSheet('Exporting…');
    try {
      let result;
      if (format === 'apkg') result = await exportApkg({ did: did || null, includeScheduling, includeMedia, onProgress: p.set });
      else if (format === 'text') result = exportText({ did: did || null, includeDeck: true, includeNotetype: true });
      else result = await exportBackup({ onProgress: p.set });
      p.close();
      offerFile(result);
    } catch (e) {
      p.close();
      console.error(e);
      toast('Export failed: ' + e.message, { ms: 6000 });
    }
  }

  wrap.append(
    h('div', { style: { marginTop: '10px' } }, segmented([['apkg', 'Anki (.apkg)'], ['text', 'Text'], ['backup', 'Backup']], format, (v) => { format = v; render(); })),
    opts
  );
  render();
}


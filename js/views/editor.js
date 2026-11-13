import { back, go } from '../app.js';
import {
  addNote, cardsByNote, col, deleteNotes, ensureDeck, forgetCards, previewOrdinals, saveMeta, setDeck, setSuspended, sortedDecks, updateNote,
} from '../col.js';
import * as db from '../db.js';
import { addMediaFile, mediaUrl } from '../media.js';
import { renderCardInto } from '../render.js';
import { DAY, dueLabel, formatIvl } from '../sched.js';
import { clozeNumbers } from '../template.js';
import { actionSheet, confirmDialog, deckSelect, h, icon, pickFile, setHeader, sheet, textBtn, toast } from '../ui.js';
import { escapeHtml, fieldIsEmpty, splitTags } from '../util.js';

// ---------- field <-> editor html ----------
async function toEditorHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  for (const el of tpl.content.querySelectorAll('script')) el.remove();
  for (const el of tpl.content.querySelectorAll('*')) for (const a of [...el.attributes]) if (a.name.toLowerCase().startsWith('on')) el.removeAttribute(a.name);
  await Promise.all(
    [...tpl.content.querySelectorAll('img[src]')].map(async (img) => {
      const src = img.getAttribute('src');
      if (/^(https?:|data:|blob:)/i.test(src)) return;
      let name = src;
      try {
        name = decodeURIComponent(src);
      } catch {}
      const url = await mediaUrl(name);
      img.dataset.media = src;
      if (url) img.setAttribute('src', url);
    })
  );
  const div = document.createElement('div');
  div.append(tpl.content);
  return div.innerHTML;
}

function fromEditor(el) {
  const clone = el.cloneNode(true);
  for (const img of clone.querySelectorAll('img[data-media]')) {
    img.setAttribute('src', img.dataset.media);
    img.removeAttribute('data-media');
  }
  let html = clone.innerHTML.replace(/(<br\s*\/?>|\s|&nbsp;)+$/i, '').replace(/^(\s|&nbsp;)+/, '');
  if (fieldIsEmpty(html)) html = '';
  return html;
}

export default function editorView(main, [nidStr], query) {
  const editing = nidStr != null;
  const note = editing ? col.notes.get(Number(nidStr)) : null;
  if (editing && !note) {
    go('#/browse', { replace: true });
    return;
  }
  const ret = query.get('return');
  const leave = () => (ret ? go('#/' + ret, { replace: true }) : back('#/browse'));

  let ntid = note?.ntid ?? (col.notetypes.has(col.meta.lastNotetype) ? col.meta.lastNotetype : [...col.notetypes.keys()][0]);
  const qDid = Number(query.get('did'));
  let did = editing ? (cardsByNote.get(note.id)?.[0]?.did ?? null) : col.decks.has(qDid) ? qDid : col.decks.has(col.meta.lastDeck) ? col.meta.lastDeck : sortedDecks()[0]?.id ?? null;

  const wrap = h('div', { class: 'wrap' });
  main.append(wrap);

  let fieldEls = [];
  let lastField = null;
  let savedRange = null;
  let dirty = false;

  const onSelChange = () => {
    const sel = document.getSelection();
    if (sel.rangeCount && fieldEls.some((f) => f.contains(sel.anchorNode))) savedRange = sel.getRangeAt(0).cloneRange();
  };
  document.addEventListener('selectionchange', onSelChange);

  const save = async () => {
    const fields = fieldEls.map(fromEditor);
    const tags = splitTags(tagsInput.value);
    try {
      if (editing) {
        const added = await updateNote(note, fields, tags);
        if (did != null) {
          const cards = cardsByNote.get(note.id) || [];
          if (cards.some((c) => c.did !== did)) await setDeck(cards, did);
        }
        toast(added.length ? `Saved · ${added.length} new card${added.length > 1 ? 's' : ''}` : 'Saved');
        dirty = false;
        leave();
      } else {
        if (did == null) did = (await ensureDeck('Default')).id;
        const { cards } = await addNote(ntid, did, fields, tags);
        toast(`Added ${cards.length} card${cards.length > 1 ? 's' : ''}`);
        dirty = false;
        renderFields(new Array(fields.length).fill(''));
        fieldEls[0]?.focus();
      }
    } catch (e) {
      toast(e.message);
    }
  };

  setHeader({
    title: editing ? 'Edit' : 'Add',
    left: editing ? [textBtn('Cancel', () => leave())] : [],
    right: [textBtn('Preview', () => preview()), textBtn(editing ? 'Save' : 'Add', save, { style: 'font-weight:600' })],
  });

  // note type & deck selectors
  const ntSel = h(
    'select',
    {
      disabled: editing,
      onchange: () => {
        const values = fieldEls.map(fromEditor);
        ntid = Number(ntSel.value);
        col.meta.lastNotetype = ntid;
        saveMeta();
        renderFields(values);
      },
    },
    [...col.notetypes.values()].sort((a, b) => a.name.localeCompare(b.name)).map((nt) => h('option', { value: nt.id, selected: nt.id === ntid }, nt.name))
  );
  const decks = sortedDecks();
  const deckRow = decks.length
    ? deckSelect(decks, did, (v) => {
        did = v;
        dirty = true;
      })
    : h('div', { class: 'hint-text' }, 'A “Default” deck will be created.');

  const selectors = h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '6px' } },
    h('div', null, h('label', { class: 'lbl' }, 'Type'), ntSel),
    h('div', null, h('label', { class: 'lbl' }, 'Deck'), deckRow)
  );

  // toolbar
  const exec = (cmd, val = null) => {
    restoreRange();
    document.execCommand(cmd, false, val);
    dirty = true;
  };
  const restoreRange = () => {
    const target = lastField || fieldEls[0];
    if (!target) return;
    if (document.activeElement !== target) target.focus();
    if (savedRange && target.contains(savedRange.startContainer)) {
      const sel = document.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
  };
  const noBlur = (e) => e.preventDefault();
  const tb = (label, title, fn, style) => h('button', { type: 'button', title, 'aria-label': title, onpointerdown: noBlur, onmousedown: noBlur, onclick: fn, style }, label);
  const cloze = (same) => {
    restoreRange();
    const all = fieldEls.map(fromEditor);
    const nums = clozeNumbers(all);
    const max = nums.length ? Math.max(...nums) : 0;
    const n = same ? Math.max(1, max) : max + 1;
    const sel = document.getSelection();
    let inner = '';
    if (sel.rangeCount) {
      const div = document.createElement('div');
      div.append(sel.getRangeAt(0).cloneContents());
      inner = div.innerHTML;
    }
    document.execCommand('insertHTML', false, `{{c${n}::${inner}}}`);
    if (!inner) {
      // place caret inside the braces
      const s = document.getSelection();
      if (s.rangeCount) {
        const r = s.getRangeAt(0);
        const node = r.startContainer;
        if (node.nodeType === 3 && r.startOffset >= 2) {
          r.setStart(node, r.startOffset - 2);
          r.collapse(true);
          s.removeAllRanges();
          s.addRange(r);
        }
      }
    }
    dirty = true;
  };
  const attach = async () => {
    const target = lastField || fieldEls[0];
    const range = savedRange;
    const file = await pickFile('image/*,audio/*');
    if (!file) return;
    try {
      const name = await addMediaFile(file);
      target.focus();
      if (range && target.contains(range.startContainer)) {
        const sel = document.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        const r = document.createRange();
        r.selectNodeContents(target);
        r.collapse(false);
        const sel = document.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      }
      if (file.type.startsWith('audio')) document.execCommand('insertText', false, `[sound:${name}]`);
      else {
        const url = await mediaUrl(name);
        document.execCommand('insertHTML', false, `<img src="${url}" data-media="${escapeHtml(name)}">`);
      }
      dirty = true;
    } catch (e) {
      toast('Could not add file: ' + e.message);
    }
  };
  const toolbar = h('div', { class: 'toolbar' });
  const renderToolbar = () => {
    const nt = col.notetypes.get(ntid);
    toolbar.replaceChildren(...[
      tb('B', 'Bold', () => exec('bold'), 'font-weight:800'),
      tb('I', 'Italic', () => exec('italic'), 'font-style:italic;font-weight:500'),
      tb('U', 'Underline', () => exec('underline'), 'text-decoration:underline;font-weight:500'),
      tb('x²', 'Superscript', () => exec('superscript')),
      tb('x₂', 'Subscript', () => exec('subscript')),
      tb('⌫', 'Clear formatting', () => exec('removeFormat')),
      nt?.kind === 1 ? tb('[…]', 'Cloze (new number)', () => cloze(false)) : null,
      nt?.kind === 1 ? tb('[…]=', 'Cloze (same number)', () => cloze(true)) : null,
      tb(icon('image'), 'Attach image or audio', attach),
    ].filter(Boolean));
  };

  const fieldsBox = h('div');
  const renderFields = async (values) => {
    const nt = col.notetypes.get(ntid);
    renderToolbar();
    fieldEls = [];
    const nodes = [];
    for (let i = 0; i < nt.fields.length; i++) {
      const f = nt.fields[i];
      const el = h('div', {
        class: 'field-input',
        contenteditable: 'true',
        'data-placeholder': f.name,
        autocapitalize: 'sentences',
        spellcheck: 'true',
        onfocus: () => (lastField = el),
        oninput: () => (dirty = true),
        onpaste: async (e) => {
          const files = [...(e.clipboardData?.files || [])].filter((x) => x.type.startsWith('image/'));
          e.preventDefault();
          if (files.length) {
            for (const file of files) {
              const name = await addMediaFile(file);
              const url = await mediaUrl(name);
              document.execCommand('insertHTML', false, `<img src="${url}" data-media="${escapeHtml(name)}">`);
            }
          } else {
            const text = e.clipboardData.getData('text/plain');
            document.execCommand('insertHTML', false, escapeHtml(text).replace(/\r?\n/g, '<br>'));
          }
          dirty = true;
        },
      });
      el.innerHTML = await toEditorHtml(values[i] ?? '');
      fieldEls.push(el);
      nodes.push(h('label', { class: 'lbl' }, f.name), el);
    }
    fieldsBox.replaceChildren(...nodes);
  };

  const tagsInput = h('input', { type: 'text', value: (note?.tags || []).join(' '), placeholder: 'Tags (space separated)', autocapitalize: 'off', autocorrect: 'off', spellcheck: false, oninput: () => (dirty = true) });

  wrap.append(selectors, toolbar, fieldsBox, h('label', { class: 'lbl' }, 'Tags'), tagsInput);
  wrap.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: save }, editing ? 'Save' : 'Add')));
  if (!editing) wrap.append(h('p', { class: 'hint-text center' }, 'Tip: ⌘/Ctrl + Enter adds the card.'));

  // card list (edit mode)
  if (editing) {
    const cardsBox = h('div');
    const renderCards = () => {
      const nt = col.notetypes.get(note.ntid);
      const cards = (cardsByNote.get(note.id) || []).slice().sort((a, b) => a.ord - b.ord);
      cardsBox.replaceChildren(
        h('div', { class: 'group-title' }, 'Cards'),
        h(
          'div',
          { class: 'group' },
          cards.map((c) =>
            h(
              'button',
              { class: 'row', onclick: () => cardMenu(c) },
              h('div', { class: 'grow' }, h('div', null, nt.kind === 1 ? `Cloze ${c.ord + 1}` : nt.templates[c.ord]?.name || `Card ${c.ord + 1}`), h('div', { class: 'sub' }, `${col.decks.get(c.did)?.name || '?'} · ${dueLabel(c, Date.now(), col.config)}`)),
              icon('right', 'chev')
            )
          )
        ),
        h('button', {
          class: 'btn block danger',
          onclick: async () => {
            if (!(await confirmDialog('This note and all its cards will be deleted.', { title: 'Delete note', ok: 'Delete', danger: true }))) return;
            await deleteNotes([note.id]);
            dirty = false;
            toast('Note deleted');
            ret && ret.startsWith('study') ? go('#/' + ret, { replace: true }) : back('#/browse');
          },
        }, 'Delete note')
      );
    };
    const cardMenu = (c) =>
      actionSheet([
        { label: 'Card info', icon: 'info', onClick: () => cardInfo(c) },
        { label: 'Preview', icon: 'eye', onClick: () => preview(c) },
        { label: c.suspended ? 'Unsuspend' : 'Suspend', icon: 'pause', onClick: async () => { await setSuspended([c], !c.suspended); renderCards(); } },
        {
          label: 'Reset to new',
          icon: 'reset',
          onClick: async () => {
            if (await confirmDialog('Scheduling for this card will be reset.', { title: 'Reset card', ok: 'Reset', danger: true })) {
              await forgetCards([c]);
              renderCards();
            }
          },
        },
      ]);
    wrap.append(cardsBox);
    renderCards();
    const infoId = Number(query.get('info'));
    if (infoId && col.cards.has(infoId)) setTimeout(() => cardInfo(col.cards.get(infoId)), 50);
  }

  async function preview(cardArg) {
    const fields = fieldEls.map(fromEditor);
    const tmpNote = { id: note?.id ?? -1, ntid, fields, tags: splitTags(tagsInput.value) };
    let ords;
    try {
      ords = previewOrdinals(ntid, fields);
    } catch {
      ords = [];
    }
    if (!ords.length) return toast('Nothing to preview yet');
    let idx = cardArg ? Math.max(0, ords.indexOf(cardArg.ord)) : 0;
    let side = 'q';
    const host = h('div', { class: 'preview-frame' });
    const label = h('div', { class: 'muted center', style: { fontSize: '13px' } });
    const draw = async () => {
      const c = { id: -1, nid: tmpNote.id, did: did ?? 0, ord: ords[idx], flags: 0, type: 0 };
      label.textContent = `${side === 'q' ? 'Front' : 'Back'} · card ${idx + 1} of ${ords.length}`;
      await renderCardInto(host, c, { side, note: tmpNote, autoplay: false });
    };
    const controls = h(
      'div',
      { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => { side = side === 'q' ? 'a' : 'q'; draw(); } }, 'Flip'),
      ords.length > 1 ? h('button', { class: 'btn', onclick: () => { idx = (idx + 1) % ords.length; side = 'q'; draw(); } }, 'Next card') : null
    );
    sheet(h('div', null, label, host, controls), { title: 'Preview' });
    draw();
  }

  async function cardInfo(c) {
    const logs = (await db.byIndex('revlog', 'cid', c.id)).sort((a, b) => b.id - a.id);
    const rows = [
      ['Added', new Date(Math.floor(c.nid)).toLocaleDateString()],
      ['First review', logs.length ? new Date(logs[logs.length - 1].id).toLocaleDateString() : '—'],
      ['Latest review', logs.length ? new Date(logs[0].id).toLocaleDateString() : '—'],
      ['Due', dueLabel(c, Date.now(), col.config)],
      ['Interval', c.type === 2 || c.type === 3 ? formatIvl(c.ivl * DAY, true) : '—'],
      ['Ease', c.factor ? `${Math.round(c.factor / 10)}%` : '—'],
      ['Reviews', String(c.reps)],
      ['Lapses', String(c.lapses)],
      ['Average time', logs.length ? `${(logs.reduce((s, l) => s + l.time, 0) / logs.length / 1000).toFixed(1)}s` : '—'],
      ['Card ID', String(c.id)],
    ];
    const typeName = ['Learn', 'Review', 'Relearn', 'Filtered', 'Manual'];
    const easeName = ['', 'Again', 'Hard', 'Good', 'Easy'];
    sheet(
      h(
        'div',
        null,
        h('div', { class: 'group' }, rows.map(([k, v]) => h('div', { class: 'row' }, h('div', { class: 'grow' }, k), h('div', { class: 'val' }, v)))),
        logs.length
          ? h('div', null,
              h('div', { class: 'group-title' }, 'History'),
              h('div', { class: 'group' }, logs.slice(0, 50).map((l) =>
                h('div', { class: 'row' },
                  h('div', { class: 'grow' }, new Date(l.id).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }), h('div', { class: 'sub' }, `${typeName[l.type] || ''} · ${l.ivl < 0 ? formatIvl(-l.ivl * 1000) : formatIvl(l.ivl * DAY, true)}`)),
                  h('div', { class: 'val', style: { color: `var(--${['', 'again', 'hard', 'good', 'easy'][l.ease]})` } }, easeName[l.ease] || '')
                )
              ))
            )
          : null
      ),
      { title: 'Card info' }
    );
  }

  renderFields(note ? note.fields : []).then(() => {
    if (!editing && matchMedia('(hover: hover)').matches) fieldEls[0]?.focus();
  });

  const onKey = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  };
  document.addEventListener('keydown', onKey);
  const beforeUnload = (e) => {
    if (dirty) e.preventDefault();
  };
  window.addEventListener('beforeunload', beforeUnload);

  return () => {
    document.removeEventListener('selectionchange', onSelChange);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('beforeunload', beforeUnload);
  };
}

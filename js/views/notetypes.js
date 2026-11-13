import { back, go } from '../app.js';
import { cardsByNote, cloneNotetype, renameFieldRefs, col, deleteNotetype, notetypeUseCount, rebuildNoteIndex, saveNotetype, updateNotetypeFields } from '../col.js';
import * as db from '../db.js';
import { cardOrdinals } from '../template.js';
import { actionSheet, confirmDialog, h, icon, iconBtn, promptDialog, setHeader, textBtn, toast } from '../ui.js';
import { newId, plural } from '../util.js';

export function notetypesView(main) {
  setHeader({
    title: 'Note types',
    left: [iconBtn('back', 'Back', () => back('#/settings'))],
    right: [textBtn('Add', () => addFlow())],
  });
  const wrap = h('div', { class: 'wrap' });
  main.append(wrap);
  const list = [...col.notetypes.values()].sort((a, b) => a.name.localeCompare(b.name));
  wrap.append(
    h('div', { class: 'group', style: { marginTop: '12px' } },
      list.map((nt) =>
        h('a', { class: 'row', href: `#/notetype/${nt.id}` },
          h('div', { class: 'grow' }, nt.name, h('div', { class: 'sub' }, `${plural(notetypeUseCount(nt.id), 'note')} · ${nt.kind === 1 ? 'cloze' : plural(nt.templates.length, 'card type')}`)),
          icon('right', 'chev')
        )
      )
    )
  );

  async function addFlow() {
    actionSheet(
      list.map((nt) => ({
        label: `Clone: ${nt.name}`,
        onClick: async () => {
          const name = await promptDialog('Name', `${nt.name} copy`, { ok: 'Create' });
          if (!name) return;
          const created = await cloneNotetype(nt.id, name);
          go(`#/notetype/${created.id}`);
        },
      })),
      { title: 'New note type' }
    );
  }
}

export function notetypeView(main, [idStr]) {
  const orig = col.notetypes.get(Number(idStr));
  if (!orig) return go('#/notetypes', { replace: true });
  // working copy
  const nt = JSON.parse(JSON.stringify(orig));
  let fieldMap = nt.fields.map((_f, i) => i);
  let tmplMap = nt.templates.map((_t, i) => i);
  let dirty = false;
  let tab = 'fields';
  let tmplIdx = 0;

  const save = async () => {
    try {
      const nameTaken = [...col.notetypes.values()].some((x) => x.id !== nt.id && x.name === nt.name);
      if (nameTaken) return toast('Another note type has that name');
      if (!nt.fields.length) return toast('A note type needs at least one field');
      if (new Set(nt.fields.map((f) => f.name)).size !== nt.fields.length) return toast('Field names must be unique');
      const target = col.notetypes.get(nt.id);
      // fields
      const fieldsChanged = fieldMap.length !== target.fields.length || fieldMap.some((v, i) => v !== i || nt.fields[i].name !== target.fields[i].name);
      if (fieldsChanged) await updateNotetypeFields(target, nt.fields.map((f) => ({ ...f })), fieldMap);
      // templates
      await applyTemplates(target, nt, tmplMap);
      target.name = nt.name;
      target.css = nt.css;
      target.sortf = nt.sortf;
      await saveNotetype(target);
      dirty = false;
      toast('Saved');
      back('#/notetypes');
    } catch (e) {
      toast(e.message);
    }
  };

  setHeader({ title: nt.name, left: [textBtn('Cancel', () => back('#/notetypes'))], right: [textBtn('Save', save, { style: 'font-weight:600' })] });
  const wrap = h('div', { class: 'wrap' });
  main.append(wrap);
  const body = h('div');

  const nameInput = h('input', { type: 'text', value: nt.name, oninput: () => { nt.name = nameInput.value.trim(); dirty = true; } });
  const tabs = h('div', { class: 'seg', style: { marginTop: '16px' } });
  const renderTabs = () =>
    tabs.replaceChildren(
      ...[['fields', 'Fields'], ['templates', nt.kind === 1 ? 'Template' : 'Cards'], ['css', 'Styling']].map(([k, l]) =>
        h('button', { class: k === tab ? 'on' : '', onclick: () => { tab = k; renderTabs(); render(); } }, l)
      )
    );
  renderTabs();
  const uses = notetypeUseCount(nt.id);
  wrap.append(h('label', { class: 'lbl' }, 'Name'), nameInput, tabs, body);
  wrap.append(
    h('div', { class: 'btn-row', style: { marginTop: '28px' } },
      h('button', {
        class: 'btn danger',
        onclick: async () => {
          if (uses) return toast(`In use by ${plural(uses, 'note')} — delete those first`);
          if (!(await confirmDialog(`Delete “${orig.name}”?`, { title: 'Delete note type', ok: 'Delete', danger: true }))) return;
          await deleteNotetype(orig.id);
          go('#/notetypes', { replace: true });
        },
      }, 'Delete note type')
    )
  );

  function render() {
    if (tab === 'fields') renderFields();
    else if (tab === 'templates') renderTemplates();
    else renderCss();
  }

  function renderFields() {
    const rows = nt.fields.map((f, i) =>
      h('div', { class: 'row' },
        h('div', { class: 'grow' }, f.name, i === nt.sortf ? h('div', { class: 'sub' }, 'Sort field') : null),
        iconBtn('more', 'Field options', () =>
          actionSheet([
            {
              label: 'Rename', icon: 'rename', onClick: async () => {
                const name = await promptDialog('Rename field', f.name);
                if (!name || /[:{}"#^/]/.test(name)) return name && toast('Names cannot contain : { } " # ^ /');
                if (nt.fields.some((x) => x !== f && x.name === name)) return toast('Field names must be unique');
                const renames = new Map([[f.name, name]]);
                for (const t of nt.templates) {
                  t.qfmt = renameFieldRefs(t.qfmt, renames);
                  t.afmt = renameFieldRefs(t.afmt, renames);
                }
                f.name = name;
                dirty = true;
                render();
              },
            },
            i > 0 && { label: 'Move up', onClick: () => move(i, -1) },
            i < nt.fields.length - 1 && { label: 'Move down', onClick: () => move(i, 1) },
            i !== nt.sortf && { label: 'Use as sort field', onClick: () => { nt.sortf = i; dirty = true; render(); } },
            nt.fields.length > 1 && {
              label: 'Delete', icon: 'trash', danger: true, onClick: async () => {
                if (uses && !(await confirmDialog(`The “${f.name}” field will be removed from ${plural(uses, 'note')}.`, { title: 'Delete field', ok: 'Delete', danger: true }))) return;
                nt.fields.splice(i, 1);
                fieldMap.splice(i, 1);
                if (nt.sortf >= nt.fields.length || nt.sortf === i) nt.sortf = 0;
                else if (nt.sortf > i) nt.sortf--;
                dirty = true;
                render();
              },
            },
          ], { title: f.name })
        )
      )
    );
    body.replaceChildren(
      h('div', { class: 'group', style: { marginTop: '12px' } }, rows),
      h('button', {
        class: 'btn block',
        onclick: async () => {
          const name = await promptDialog('New field', '', { ok: 'Add' });
          if (!name) return;
          if (nt.fields.some((f) => f.name === name)) return toast('Field names must be unique');
          nt.fields.push({ name });
          fieldMap.push(-1);
          dirty = true;
          render();
        },
      }, '+ Add field'),
      h('p', { class: 'hint-text' }, 'Renaming a field also updates the card templates.')
    );
  }

  function move(i, dir) {
    const j = i + dir;
    [nt.fields[i], nt.fields[j]] = [nt.fields[j], nt.fields[i]];
    [fieldMap[i], fieldMap[j]] = [fieldMap[j], fieldMap[i]];
    if (nt.sortf === i) nt.sortf = j;
    else if (nt.sortf === j) nt.sortf = i;
    dirty = true;
    render();
  }

  function renderTemplates() {
    if (tmplIdx >= nt.templates.length) tmplIdx = 0;
    const t = nt.templates[tmplIdx];
    const fieldsHint = h('p', { class: 'hint-text' }, 'Fields: ', nt.fields.map((f) => h('code', { class: 'inline' }, `{{${f.name}}}`)).flatMap((c) => [c, ' ']), nt.kind === 1 ? '' : ' · {{FrontSide}} on the back');
    const q = h('textarea', { value: t.qfmt, spellcheck: false, autocapitalize: 'off', oninput: () => { t.qfmt = q.value; dirty = true; } });
    const a = h('textarea', { value: t.afmt, spellcheck: false, autocapitalize: 'off', oninput: () => { t.afmt = a.value; dirty = true; } });
    const picker =
      nt.kind === 1
        ? null
        : h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', alignItems: 'center' } },
            h('select', { onchange: (e) => { tmplIdx = Number(e.target.value); render(); } }, nt.templates.map((x, i) => h('option', { value: i, selected: i === tmplIdx }, x.name))),
            iconBtn('more', 'Card type options', () =>
              actionSheet([
                { label: 'Add card type', icon: 'add', onClick: () => {
                  nt.templates.push({ name: `Card ${nt.templates.length + 1}`, qfmt: `{{${nt.fields[1]?.name || nt.fields[0].name}}}`, afmt: `{{FrontSide}}\n\n<hr id=answer>\n\n{{${nt.fields[0].name}}}` });
                  tmplMap.push(-1);
                  tmplIdx = nt.templates.length - 1;
                  dirty = true;
                  render();
                } },
                { label: 'Rename', icon: 'rename', onClick: async () => {
                  const name = await promptDialog('Rename card type', t.name);
                  if (name) { t.name = name; dirty = true; render(); }
                } },
                nt.templates.length > 1 && { label: 'Delete card type', icon: 'trash', danger: true, onClick: async () => {
                  if (!(await confirmDialog(`Cards of type “${t.name}” will be deleted.`, { title: 'Delete card type', ok: 'Delete', danger: true }))) return;
                  nt.templates.splice(tmplIdx, 1);
                  tmplMap.splice(tmplIdx, 1);
                  tmplIdx = 0;
                  dirty = true;
                  render();
                } },
              ], { title: t.name })
            )
          );
    body.replaceChildren(picker || '', h('label', { class: 'lbl' }, 'Front template'), q, h('label', { class: 'lbl' }, 'Back template'), a, fieldsHint);
  }

  function renderCss() {
    const css = h('textarea', { value: nt.css || '', spellcheck: false, autocapitalize: 'off', style: { minHeight: '260px' }, oninput: () => { nt.css = css.value; dirty = true; } });
    body.replaceChildren(h('label', { class: 'lbl' }, 'Card styling (CSS)'), css, h('p', { class: 'hint-text' }, 'Cards are wrapped in .card; in dark mode .nightMode is added.'));
  }

  render();
  const beforeUnload = (e) => dirty && e.preventDefault();
  window.addEventListener('beforeunload', beforeUnload);
  return () => window.removeEventListener('beforeunload', beforeUnload);
}

/** Persist template add/remove/reorder: remap card ordinals and generate new cards. */
async function applyTemplates(target, working, tmplMap) {
  const put = [];
  const del = [];
  if (target.kind !== 1) {
    const oldToNew = new Map();
    tmplMap.forEach((oldIdx, newIdx) => oldIdx >= 0 && oldToNew.set(oldIdx, newIdx));
    // check no note loses all its cards
    for (const [nid, cards] of cardsByNote) {
      const note = col.notes.get(nid);
      if (note?.ntid !== target.id) continue;
      if (!cards.some((c) => oldToNew.has(c.ord))) throw new Error('Deleting this card type would leave some notes without cards');
    }
    for (const c of col.cards.values()) {
      const note = col.notes.get(c.nid);
      if (note?.ntid !== target.id) continue;
      if (!oldToNew.has(c.ord)) {
        del.push(c.id);
        col.cards.delete(c.id);
      } else if (oldToNew.get(c.ord) !== c.ord) {
        c.ord = oldToNew.get(c.ord);
        put.push(c);
      }
    }
  }
  target.templates = working.templates.map((t) => ({ ...t }));
  // generate any newly required cards
  rebuildNoteIndex();
  for (const note of col.notes.values()) {
    if (note.ntid !== target.id) continue;
    const existing = cardsByNote.get(note.id) || [];
    const have = new Set(existing.map((c) => c.ord));
    const did = existing[0]?.did;
    if (did == null) continue;
    const pos = existing.find((c) => c.type === 0)?.due ?? col.meta.nextPos++;
    for (const ord of cardOrdinals(target, note)) {
      if (have.has(ord)) continue;
      const c = { id: newId(), nid: note.id, did, ord, type: 0, due: pos, ivl: 0, factor: 0, reps: 0, lapses: 0, step: 0, mod: Date.now(), suspended: false, buried: 0, flags: 0 };
      col.cards.set(c.id, c);
      put.push(c);
    }
  }
  await db.commit({ put: { cards: put }, del: { cards: del } });
  rebuildNoteIndex();
}

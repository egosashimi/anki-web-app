import { go } from '../app.js';
import { addTags, col, deleteNotes, forgetCards, removeTags, searchCards, setDeck, setSuspended, sortField, sortedDecks } from '../col.js';
import { dueLabel } from '../sched.js';
import { actionSheet, confirmDialog, h, icon, promptDialog, setHeader, sheet, textBtn, toast } from '../ui.js';
import { plural, splitTags } from '../util.js';

const FILTERS = [
  ['', 'All'],
  ['is:due', 'Due'],
  ['is:new', 'New'],
  ['is:learn', 'Learning'],
  ['is:review', 'Review'],
  ['is:suspended', 'Suspended'],
  ['tag:leech', 'Leeches'],
  ['-flag:0', 'Flagged'],
];
const PAGE = 100;
const SORTS = [
  ['added', 'Date added'],
  ['due', 'Due'],
  ['sort', 'Sort field'],
  ['ivl', 'Interval'],
  ['lapses', 'Lapses'],
];
let lastQuery = '';
let lastFilter = '';
let lastSort = 'added';

export default function browseView(main, _params, query) {
  if (query.has('q')) {
    lastQuery = query.get('q');
    lastFilter = '';
  }
  let selecting = false;
  const selected = new Set();
  let results = [];
  let shown = PAGE;

  const wrap = h('div', { class: 'wrap' });
  main.append(wrap);

  const selectBtn = textBtn('Select', () => {
    selecting = !selecting;
    selected.clear();
    selectBtn.textContent = selecting ? 'Done' : 'Select';
    renderList();
  });
  setHeader({ title: 'Browse', left: [textBtn('Sort', () => sortMenu())], right: [selectBtn] });

  const input = h('input', {
    type: 'search',
    placeholder: 'Search  (deck:  tag:  is:due)',
    value: lastQuery,
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: false,
    enterkeyhint: 'search',
  });
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(run, 180);
  });
  const chips = h('div', { class: 'chips' });
  const renderChips = () =>
    chips.replaceChildren(...FILTERS.map(([q, label]) => h('button', { class: `chip ${q === lastFilter ? 'on' : ''}`, onclick: () => { lastFilter = q; renderChips(); run(); } }, label)));
  renderChips();
  const count = h('div', { class: 'result-count' });
  wrap.append(h('div', { class: 'search-bar' }, input, chips));
  wrap.append(count);
  const list = h('div');
  wrap.append(list);
  const bulk = h('div', { class: 'bulk-bar', hidden: true });
  wrap.append(bulk);

  function sortMenu() {
    actionSheet(SORTS.map(([k, label]) => ({ label: (k === lastSort ? '✓ ' : '') + label, onClick: () => { lastSort = k; run(); } })), { title: 'Sort by' });
  }

  function run() {
    lastQuery = input.value;
    const q = [lastQuery, lastFilter].filter(Boolean).join(' ');
    results = searchCards(q);
    const keyed = {
      added: (c) => -c.nid * 100 - c.ord,
      due: (c) => (c.type === 0 ? 1e15 + c.due : c.type === 2 ? c.due * 86400000 : c.due),
      ivl: (c) => -c.ivl,
      lapses: (c) => -c.lapses,
    }[lastSort];
    if (lastSort === 'sort') {
      const cache = new Map();
      const sf = (c) => cache.get(c.nid) ?? (cache.set(c.nid, sortField(col.notes.get(c.nid)).toLowerCase()), cache.get(c.nid));
      results.sort((a, b) => sf(a).localeCompare(sf(b)) || a.ord - b.ord);
    } else results.sort((a, b) => keyed(a) - keyed(b));
    shown = PAGE;
    selected.clear();
    renderList();
  }

  function renderList() {
    count.textContent = `${plural(results.length, 'card')}${selecting ? ` · ${selected.size} selected` : ''}`;
    const nowTs = Date.now();
    const rows = results.slice(0, shown).map((c) => {
      const n = col.notes.get(c.nid);
      const nt = col.notetypes.get(n.ntid);
      const title = sortField(n) || '(empty)';
      const deck = col.decks.get(c.did)?.name.split('::').pop() || '';
      const tmpl = nt.kind === 1 ? `c${c.ord + 1}` : nt.templates.length > 1 ? nt.templates[c.ord]?.name : '';
      const row = h(
        'div',
        {
          class: `card-row ${c.suspended ? 'suspended' : ''} ${selected.has(c.id) ? 'selected' : ''}`,
          onclick: () => {
            if (selecting) {
              selected.has(c.id) ? selected.delete(c.id) : selected.add(c.id);
              row.classList.toggle('selected');
              count.textContent = `${plural(results.length, 'card')} · ${selected.size} selected`;
              renderBulk();
            } else go(`#/edit/${c.nid}`);
          },
        },
        selecting ? h('div', { class: 'check' }, selected.has(c.id) ? icon('check') : null) : null,
        h('div', { class: 'grow' }, h('div', { class: 'title' }, title), h('div', { class: 'sub' }, [deck, tmpl, dueLabel(c, nowTs, col.config), n.tags.length ? n.tags.join(' ') : ''].filter(Boolean).join(' · ')))
      );
      return row;
    });
    list.replaceChildren(...rows);
    if (results.length > shown) list.append(h('button', { class: 'btn block mt', onclick: () => { shown += PAGE * 2; renderList(); } }, `Show more (${results.length - shown} remaining)`));
    if (!results.length) list.append(h('div', { class: 'empty', style: { paddingTop: '10vh' } }, h('p', null, col.cards.size ? 'No cards match.' : 'No cards yet.')));
    renderBulk();
  }

  function selectedCards() {
    return [...selected].map((id) => col.cards.get(id)).filter(Boolean);
  }
  function selectedNotes() {
    return [...new Set(selectedCards().map((c) => c.nid))].map((id) => col.notes.get(id));
  }

  function renderBulk() {
    bulk.hidden = !selecting;
    if (!selecting) return;
    const none = !selected.size;
    const b = (label, fn, cls = '') => h('button', { class: `btn ${cls}`, disabled: none, onclick: fn }, label);
    bulk.replaceChildren(
      h('button', { class: 'btn', onclick: () => { if (selected.size === results.length) selected.clear(); else results.forEach((c) => selected.add(c.id)); renderList(); } }, selected.size === results.length && results.length ? 'None' : 'All'),
      b('Move', () => moveTo()),
      b('Suspend', async () => {
        const cards = selectedCards();
        const all = cards.every((c) => c.suspended);
        await setSuspended(cards, !all);
        toast(all ? 'Unsuspended' : 'Suspended');
        run();
      }),
      b('Tag', async () => {
        const tags = await promptDialog('Add tags', '', { ok: 'Add', placeholder: 'tag1 tag2' });
        if (tags) {
          await addTags(selectedNotes(), splitTags(tags));
          toast('Tags added');
          run();
        }
      }),
      b('Untag', async () => {
        const tags = await promptDialog('Remove tags', '', { ok: 'Remove', placeholder: 'tag1 tag2' });
        if (tags) {
          await removeTags(selectedNotes(), splitTags(tags));
          toast('Tags removed');
          run();
        }
      }),
      b('Reset', async () => {
        if (!(await confirmDialog(`Reset ${plural(selected.size, 'card')} to new?`, { title: 'Reset', ok: 'Reset', danger: true }))) return;
        await forgetCards(selectedCards());
        toast('Reset');
        run();
      }),
      b('Delete', async () => {
        const notes = selectedNotes();
        if (!(await confirmDialog(`Delete ${plural(notes.length, 'note')} and all their cards?`, { title: 'Delete', ok: 'Delete', danger: true }))) return;
        await deleteNotes(notes.map((n) => n.id));
        toast('Deleted');
        run();
      }, 'danger')
    );
  }

  function moveTo() {
    let close;
    const decks = sortedDecks();
    close = sheet(
      h('div', { class: 'action-list' }, decks.map((d) =>
        h('button', {
          style: { paddingLeft: `${16 + (d.name.split('::').length - 1) * 16}px` },
          onclick: async () => {
            close();
            await setDeck(selectedCards(), d.id);
            toast(`Moved to ${d.name}`);
            run();
          },
        }, d.name.split('::').pop())
      )),
      { title: 'Move to deck' }
    );
  }

  run();
}

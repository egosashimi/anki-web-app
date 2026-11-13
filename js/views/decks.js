import { go, rerender } from '../app.js';
import { col, childDecks, deleteDeck, ensureDeck, renameDeck, saveDeck, sortedDecks } from '../col.js';
import * as db from '../db.js';
import { deckCounts, deckTotal, indexByDeck } from '../queue.js';
import { dayNumber, dayStart } from '../sched.js';
import { actionSheet, confirmDialog, h, icon, iconBtn, promptDialog, setHeader, toast } from '../ui.js';
import { fmtDuration, plural } from '../util.js';

export async function createDeckFlow(parent) {
  const name = await promptDialog(parent ? `New deck in ${parent.name.split('::').pop()}` : 'New deck', '', {
    ok: 'Create',
    placeholder: 'Deck name',
    hint: parent ? null : 'Use “::” to nest decks, e.g. Languages::Spanish',
  });
  if (!name) return null;
  const d = await ensureDeck(parent ? `${parent.name}::${name}` : name);
  rerender();
  return d;
}

function countEl(n, cls) {
  return h('span', { class: n ? cls : 'zero' }, String(n));
}

export function deckMenu(d) {
  actionSheet(
    [
      { label: 'Study', icon: 'play', onClick: () => go(`#/study/${d.id}`) },
      { label: 'Add cards', icon: 'add', onClick: () => go(`#/add?did=${d.id}`) },
      { label: 'Browse cards', icon: 'browse', onClick: () => go(`#/browse?q=${encodeURIComponent(`deck:"${d.name}"`)}`) },
      { label: 'Options', icon: 'gear', onClick: () => go(`#/deck/${d.id}`) },
      {
        label: 'Rename',
        icon: 'rename',
        onClick: async () => {
          const name = await promptDialog('Rename deck', d.name);
          if (!name || name === d.name) return;
          try {
            await renameDeck(d.id, name);
            rerender();
          } catch (e) {
            toast(e.message);
          }
        },
      },
      { label: 'New subdeck', icon: 'folder', onClick: () => createDeckFlow(d) },
      { label: 'Export', icon: 'export', onClick: () => go(`#/export?did=${d.id}`) },
      {
        label: 'Delete',
        icon: 'trash',
        danger: true,
        onClick: async () => {
          const n = deckTotal(d.id);
          const ok = await confirmDialog(n ? `“${d.name}” and its ${plural(n, 'card')} will be deleted.` : `Delete “${d.name}”?`, { title: 'Delete deck', ok: 'Delete', danger: true });
          if (!ok) return;
          await deleteDeck(d.id);
          toast('Deck deleted');
          rerender();
        },
      },
    ],
    { title: d.name }
  );
}

export default function decksView(main) {
  setHeader({
    title: 'Decks',
    left: [],
    right: [
      iconBtn('more', 'More', () =>
        actionSheet([
          { label: 'Create deck', icon: 'folder', onClick: () => createDeckFlow() },
          { label: 'Import file', icon: 'import', onClick: () => go('#/import') },
          { label: 'Export collection', icon: 'export', onClick: () => go('#/export') },
        ])
      ),
    ],
  });
  const wrap = h('div', { class: 'wrap' });
  main.append(wrap);

  if (!col.decks.size) {
    wrap.append(
      h(
        'div',
        { class: 'empty' },
        h('h2', null, 'No decks yet'),
        h('p', null, 'Create a deck or import an Anki package to get started.'),
        h('div', null, h('button', { class: 'btn primary', onclick: () => createDeckFlow() }, 'Create deck')),
        h('div', null, h('button', { class: 'btn', onclick: () => go('#/import') }, 'Import .apkg / text'))
      )
    );
    return;
  }

  const idx = indexByDeck();
  const list = h('div', { class: 'deck-list' });
  const roots = sortedDecks().filter((d) => !d.name.includes('::'));
  const renderDeck = (d, depth) => {
    const c = deckCounts(d.id, idx);
    const kids = childDecks(d.id);
    const toggle = kids.length
      ? h('button', {
          class: `toggle ${d.collapsed ? 'collapsed' : ''}`,
          'aria-label': d.collapsed ? 'Expand' : 'Collapse',
          onclick: async () => {
            d.collapsed = !d.collapsed;
            await saveDeck(d);
            rerender();
          },
        }, icon('chevron'))
      : h('span', { class: 'toggle' });
    list.append(
      h(
        'div',
        { class: 'deck-row', style: { paddingLeft: `${depth * 18}px` } },
        toggle,
        h('button', { class: 'name', onclick: () => go(`#/study/${d.id}`) }, d.name.split('::').pop()),
        h('div', { class: 'counts', 'aria-label': `${c.new} new, ${c.learn} learning, ${c.rev} due` }, countEl(c.new, 'c-new'), countEl(c.learn, 'c-learn'), countEl(c.rev, 'c-rev')),
        h('button', { class: 'icon-btn more', 'aria-label': 'Deck options', onclick: () => deckMenu(d) }, icon('more'))
      )
    );
    if (!d.collapsed) for (const k of kids) renderDeck(k, depth + 1);
  };
  for (const d of roots) renderDeck(d, 0);
  wrap.append(list);

  const summary = h('div', { class: 'today-summary' });
  wrap.append(summary);
  // today's activity
  const start = dayStart(dayNumber(Date.now(), col.config.rollover), col.config.rollover);
  db.getAll('revlog', IDBKeyRange.lowerBound(start)).then((logs) => {
    if (!logs.length) {
      summary.textContent = 'No cards studied today.';
      return;
    }
    const time = logs.reduce((s, l) => s + (l.time || 0), 0);
    summary.textContent = `Studied ${plural(logs.length, 'card')} in ${fmtDuration(time)} today.`;
  });
  wrap.append(h('div', { class: 'center', style: { marginTop: '10px' } }, h('button', { class: 'text-btn', onclick: () => createDeckFlow() }, '+ Create deck')));
}


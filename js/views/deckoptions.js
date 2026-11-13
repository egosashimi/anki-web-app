import { back, go } from '../app.js';
import { col, saveDeck } from '../col.js';
import { deckCounts, deckTotal } from '../queue.js';
import { h, setHeader, switchEl, textBtn } from '../ui.js';
import { numberRow } from './settings.js';
import { deckMenu } from './decks.js';

export default function deckOptionsView(main, [idStr]) {
  const d = col.decks.get(Number(idStr));
  if (!d) return go('#/decks', { replace: true });
  setHeader({ title: d.name.split('::').pop(), left: [textBtn('Done', () => back('#/decks'))], right: [textBtn('More', () => deckMenu(d))] });
  const wrap = h('div', { class: 'wrap' });
  main.append(wrap);
  const c = deckCounts(d.id);

  const limitsBox = h('div');
  const renderLimits = () => {
    const rows = [];
    const toggle = (label, key, defKey) =>
      h('div', { class: 'row' }, h('div', { class: 'grow' }, label, h('div', { class: 'sub' }, d[key] == null ? `Using default (${col.config[defKey]})` : 'Custom for this deck')),
        switchEl(d[key] != null, async (on) => {
          d[key] = on ? col.config[defKey] : null;
          await saveDeck(d);
          renderLimits();
        }));
    rows.push(toggle('Custom new cards/day', 'newPerDay', 'newPerDay'));
    if (d.newPerDay != null) rows.push(numberRow('New cards/day', 'newPerDay', { target: d, onSave: () => saveDeck(d), max: 9999 }));
    rows.push(toggle('Custom reviews/day', 'revPerDay', 'revPerDay'));
    if (d.revPerDay != null) rows.push(numberRow('Maximum reviews/day', 'revPerDay', { target: d, onSave: () => saveDeck(d), max: 99999 }));
    limitsBox.replaceChildren(h('div', { class: 'group' }, rows));
  };
  renderLimits();

  const desc = h('textarea', {
    placeholder: 'Notes about this deck (optional)',
    style: { fontFamily: 'inherit', fontSize: '16px', minHeight: '80px' },
    value: d.desc || '',
    onchange: async () => {
      d.desc = desc.value;
      await saveDeck(d);
    },
  });

  wrap.append(
    h('div', { class: 'stat-grid' },
      h('div', { class: 'stat' }, h('div', { class: 'num' }, deckTotal(d.id).toLocaleString()), h('div', { class: 'lbl' }, 'cards')),
      h('div', { class: 'stat' }, h('div', { class: 'num' }, h('span', { class: 'c-new' }, c.new), ' ', h('span', { class: 'c-learn' }, c.learn), ' ', h('span', { class: 'c-rev' }, c.rev)), h('div', { class: 'lbl' }, 'new · learning · due'))
    ),
    h('button', { class: 'btn primary block', onclick: () => go(`#/study/${d.id}`) }, 'Study now'),
    h('div', { class: 'group-title' }, 'Daily limits'),
    limitsBox,
    h('p', { class: 'hint-text' }, 'Limits include subdecks. Other scheduling options are shared and live in Settings.'),
    h('label', { class: 'lbl' }, 'Description'),
    desc
  );
}

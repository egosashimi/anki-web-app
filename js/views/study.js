import { go, setKeyHandler } from '../app.js';
import { answer, buryCards, cardsByNote, col, ensureCountsToday, saveCards, setSuspended, undoAnswer, kvRecords } from '../col.js';
import * as db from '../db.js';
import { StudyQueue } from '../queue.js';
import { renderCardInto, stopAudio } from '../render.js';
import { formatIvl, previewLabels } from '../sched.js';
import { actionSheet, h, icon, iconBtn, setHeader, toast } from '../ui.js';

const FLAG_COLORS = ['', '#e5484d', '#f76b15', '#30a46c', '#3e63dd', '#d6409f', '#12a594', '#8e4ec6'];

export default function studyView(main, [didStr]) {
  const did = Number(didStr);
  const deck = col.decks.get(did);
  if (!deck) {
    go('#/decks', { replace: true });
    return;
  }
  document.getElementById('app').classList.add('immersive');
  main.className = 'study-main';
  main.style.padding = '0';

  const q = new StudyQueue(did);
  let card = null;
  let side = 'q';
  let shownAt = 0;
  let typed = '';
  let ctrl = {};
  const undoStack = [];
  let pollTimer = null;
  let destroyed = false;

  const countsEl = h('div', { class: 'study-counts' });
  const undoBtn = iconBtn('undo', 'Undo', () => doUndo());
  const menuBtn = iconBtn('more', 'More', () => menu());
  setHeader({ title: '', left: [iconBtn('close', 'Close', () => go('#/decks'))], right: [undoBtn, menuBtn] });
  document.querySelector('#topbar h1').replaceChildren(countsEl);

  const host = h('div', { class: 'card-host' });
  const doneBox = h('div', { hidden: true });
  const area = h('div', { class: 'card-area', onclick: (e) => { if (side === 'q' && card && !e.composedPath()[0]?.closest?.('a,button,input,details,audio,video')) reveal(); } }, host, doneBox);
  const bar = h('div', { class: 'answer-bar' });
  const barInner = h('div', { class: 'inner' });
  bar.append(barInner);
  const root = h('div', { class: 'study' }, area, bar);
  main.append(root);

  function updateCounts() {
    const c = q.counts();
    const cur = card ? (card.type === 0 ? 'new' : card.type === 2 ? 'rev' : 'learn') : null;
    countsEl.replaceChildren(
      h('span', { class: `c-new ${cur === 'new' && side === 'q' ? 'cur' : ''}` }, String(c.new)),
      h('span', { class: `c-learn ${cur === 'learn' && side === 'q' ? 'cur' : ''}` }, String(c.learn)),
      h('span', { class: `c-rev ${cur === 'rev' && side === 'q' ? 'cur' : ''}` }, String(c.rev))
    );
    undoBtn.disabled = !undoStack.length;
    undoBtn.style.opacity = undoStack.length ? '1' : '0.35';
  }

  async function showNext(exclude) {
    clearTimeout(pollTimer);
    stopAudio();
    card = q.next(exclude);
    side = 'q';
    typed = '';
    updateCounts();
    if (!card) return showDone();
    menuBtn.hidden = false;
    bar.hidden = false;
    doneBox.hidden = true;
    host.hidden = false;
    shownAt = Date.now();
    area.scrollTop = 0;
    ctrl = await renderCardInto(host, card, { side: 'q', autoplay: col.config.autoplay, onEnter: reveal });
    if (destroyed) return;
    barInner.replaceChildren(h('button', { class: 'btn primary show-btn', onclick: reveal }, 'Show answer'));
    if (ctrl.hasInput && matchMedia('(hover: hover)').matches) ctrl.focusInput();
  }

  async function reveal() {
    if (!card || side !== 'q') return;
    typed = ctrl.typedValue?.() || '';
    side = 'a';
    updateCounts();
    const labels = col.config.showIntervals ? previewLabels(card, Date.now(), col.config) : ['', '', '', ''];
    barInner.replaceChildren(
      h(
        'div',
        { class: 'ease-row' },
        ['Again', 'Hard', 'Good', 'Easy'].map((name, i) =>
          h('button', { class: `e${i + 1}`, onclick: () => rate(i + 1), 'aria-label': `${name} ${labels[i]}` }, name, labels[i] ? h('small', null, labels[i]) : null)
        )
      )
    );
    ctrl = await renderCardInto(host, card, { side: 'a', typed, autoplay: col.config.autoplay });
    if (destroyed) return;
    const anchor = ctrl.answerAnchor;
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      const ar = area.getBoundingClientRect();
      if (r.top > ar.top + ar.height * 0.6) area.scrollTop += r.top - ar.top - 16;
    }
  }

  async function rate(ease) {
    if (!card || side !== 'a') return;
    const c = card;
    const wasType = c.type;
    card = null;
    const taken = Date.now() - shownAt;
    const res = await answer(c, ease, taken);
    undoStack.push({ ...res.undo, wasType });
    if (undoStack.length > 30) undoStack.shift();
    q.answered(c, wasType);
    if (res.leech) toast(col.config.leechAction === 'suspend' ? 'Leech: card suspended' : 'Leech: card tagged “leech”');
    showNext(c);
  }

  async function doUndo() {
    const u = undoStack.pop();
    if (!u) return;
    const c = await undoAnswer(u.undo || u);
    if (!c) return;
    q.restore(c);
    card = c;
    side = 'q';
    typed = '';
    shownAt = Date.now();
    updateCounts();
    ctrl = await renderCardInto(host, c, { side: 'q', autoplay: false, onEnter: reveal });
    barInner.replaceChildren(h('button', { class: 'btn primary show-btn', onclick: reveal }, 'Show answer'));
    toast('Undone');
  }

  function menu() {
    if (!card) return;
    const c = card;
    actionSheet([
      { label: 'Edit note', icon: 'edit', onClick: () => go(`#/edit/${c.nid}?return=study/${did}`) },
      {
        label: 'Bury card',
        icon: 'eye',
        onClick: async () => {
          await buryCards([c]);
          q.remove(c);
          toast('Card buried until tomorrow');
          showNext();
        },
      },
      {
        label: 'Bury note',
        icon: 'eye',
        onClick: async () => {
          const sibs = cardsByNote.get(c.nid) || [c];
          await buryCards(sibs);
          sibs.forEach((s) => q.remove(s));
          toast('Note buried until tomorrow');
          showNext();
        },
      },
      {
        label: 'Suspend card',
        icon: 'pause',
        onClick: async () => {
          await setSuspended([c], true);
          q.remove(c);
          toast('Card suspended');
          showNext();
        },
      },
      {
        label: c.flags ? 'Change flag' : 'Flag card',
        icon: 'flag',
        onClick: () =>
          actionSheet(
            ['None', 'Red', 'Orange', 'Green', 'Blue', 'Pink', 'Turquoise', 'Purple'].map((name, i) => ({
              label: h('span', null, i ? h('span', { class: 'flag-dot', style: { background: FLAG_COLORS[i] } }) : null, name),
              onClick: async () => {
                c.flags = i;
                await saveCards([c]);
                toast(i ? `Flagged ${name.toLowerCase()}` : 'Flag removed');
              },
            })),
            { title: 'Flag' }
          ),
      },
      { label: 'Card info', icon: 'info', onClick: () => go(`#/edit/${c.nid}?return=study/${did}&info=${c.id}`) },
    ]);
  }

  function showDone() {
    menuBtn.hidden = true;
    stopAudio();
    const nextIn = q.nextLearnIn();
    const counts = ensureCountsToday();
    const msg = nextIn != null ? `More learning cards will be due in ${formatIvl(Math.max(60000, nextIn))}.` : 'You have finished this deck for now.';
    const hasNew = [...col.cards.values()].some((c) => c.type === 0 && !c.suspended && q.ids.has(c.did));
    host.hidden = true;
    doneBox.hidden = false;
    doneBox.replaceChildren(
      h(
        'div',
        { class: 'done' },
        h('div', { class: 'check' }, icon('check')),
        h('h2', null, 'Congratulations!'),
        h('p', null, msg),
        hasNew
          ? h('div', null, h('button', {
              class: 'btn',
              onclick: async () => {
                counts.extendNew[did] = (counts.extendNew[did] || 0) + 10;
                await db.commit({ put: { kv: kvRecords('counts') } });
                q.refresh();
                showNext();
              },
            }, 'Learn 10 more new cards'))
          : null,
        h('div', null, h('button', { class: 'btn primary', onclick: () => go('#/decks') }, 'Back to decks'))
      )
    );
    barInner.replaceChildren();
    bar.hidden = true;
    if (nextIn != null) {
      const poll = () => {
        if (destroyed) return;
        const wait = q.nextLearnIn() - col.config.learnAheadMins * 60000;
        if (wait <= 0) showNext();
        else pollTimer = setTimeout(poll, Math.max(5000, Math.min(wait, 60000)));
      };
      poll();
    }
  }

  setKeyHandler((e) => {
    if (document.querySelector('.backdrop')) return;
    const inInput = e.composedPath()[0]?.tagName === 'INPUT';
    if (side === 'q' && (e.key === ' ' || (e.key === 'Enter' && !inInput))) {
      e.preventDefault();
      reveal();
    } else if (side === 'a' && ['1', '2', '3', '4'].includes(e.key)) {
      rate(Number(e.key));
    } else if (side === 'a' && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      rate(3);
    } else if (!inInput && (e.key === 'z' || e.key === 'u')) doUndo();
    else if (!inInput && e.key === 'e' && card) go(`#/edit/${card.nid}?return=study/${did}`);
    else if (e.key === 'Escape') go('#/decks');
  });

  showNext();
  return () => {
    destroyed = true;
    clearTimeout(pollTimer);
    stopAudio();
    main.style.padding = '';
  };
}


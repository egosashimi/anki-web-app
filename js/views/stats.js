import { col, deckSubtree, sortedDecks } from '../col.js';
import * as db from '../db.js';
import { dayNumber, dayStart } from '../sched.js';
import { h, setHeader } from '../ui.js';
import { fmtDuration } from '../util.js';

let selectedDeck = 0;

const STATE_COLORS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#6250d6', '#eda100'],
  dark: ['#3987e5', '#d95926', '#199e70', '#9085e9', '#c98500'],
};

function isDark() {
  const t = document.documentElement.dataset.theme;
  return t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
}

function tile(num, label) {
  return h('div', { class: 'stat' }, h('div', { class: 'num' }, num), h('div', { class: 'lbl' }, label));
}

/** Single-series bar chart with a hover/tap readout. bars: [{ label, value }] */
function barChart(bars, { color, unit = 'cards', emptyText = 'Nothing to show' }) {
  const W = 320;
  const H = 120;
  const pad = { t: 8, b: 18, l: 0, r: 0 };
  const max = Math.max(...bars.map((b) => b.value));
  const readout = h('div', { class: 'sub', style: { minHeight: '18px', marginBottom: '4px' } });
  const total = bars.reduce((s, b) => s + b.value, 0);
  const setDefault = () => (readout.textContent = total ? `${total.toLocaleString()} ${unit} total` : emptyText);
  setDefault();
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${readout.textContent}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const plotH = H - pad.t - pad.b;
  const n = bars.length;
  const slot = W / n;
  const gap = 2;
  const bw = Math.max(1, slot - gap);
  // recessive gridline at max and baseline
  const line = (y) => {
    const l = document.createElementNS(ns, 'line');
    Object.entries({ x1: 0, x2: W, y1: y, y2: y, class: 'grid', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }).forEach(([k, v]) => l.setAttribute(k, v));
    svg.append(l);
  };
  line(pad.t + plotH);
  if (max > 0) line(pad.t);
  const marks = [];
  bars.forEach((b, i) => {
    const x = i * slot + gap / 2;
    if (b.value > 0) {
      const bh = Math.max(2, (b.value / max) * plotH);
      const y = pad.t + plotH - bh;
      const r = Math.min(4, bw / 2, bh);
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', `M${x},${y + bh} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${y + bh} Z`);
      p.setAttribute('fill', color);
      svg.append(p);
      marks[i] = p;
    }
  });
  // x labels: first, middle, last
  const lbl = (i, anchor) => {
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', anchor === 'start' ? 0 : anchor === 'end' ? W : i * slot + slot / 2);
    t.setAttribute('y', H - 4);
    t.setAttribute('text-anchor', anchor);
    t.textContent = bars[i].short;
    svg.append(t);
  };
  if (n) {
    lbl(0, 'start');
    lbl(Math.floor(n / 2), 'middle');
    lbl(n - 1, 'end');
  }
  const wrap = h('div', { style: { position: 'relative', touchAction: 'pan-y' } }, svg);
  const yMax = h('div', { class: 'sub', style: { position: 'absolute', right: 0, top: '-2px', fontSize: '10px', margin: 0 } }, max ? max.toLocaleString() : '');
  wrap.append(yMax);
  const pick = (clientX) => {
    const r = svg.getBoundingClientRect();
    const i = Math.min(n - 1, Math.max(0, Math.floor(((clientX - r.left) / r.width) * n)));
    marks.forEach((m, j) => m && m.setAttribute('opacity', j === i ? '1' : '0.45'));
    readout.textContent = `${bars[i].label} · ${bars[i].value.toLocaleString()} ${unit}`;
  };
  const reset = () => {
    marks.forEach((m) => m && m.setAttribute('opacity', '1'));
    setDefault();
  };
  wrap.addEventListener('pointermove', (e) => pick(e.clientX));
  wrap.addEventListener('pointerdown', (e) => pick(e.clientX));
  wrap.addEventListener('pointerleave', reset);
  return h('div', null, readout, wrap);
}

export default async function statsView(main) {
  setHeader({ title: 'Statistics' });
  const wrap = h('div', { class: 'wrap' });
  main.append(wrap);
  const decks = sortedDecks();
  if (selectedDeck && !col.decks.has(selectedDeck)) selectedDeck = 0;
  const sel = h(
    'select',
    { onchange: () => { selectedDeck = Number(sel.value); draw(); } },
    h('option', { value: 0 }, 'All decks'),
    decks.map((d) => h('option', { value: d.id, selected: d.id === selectedDeck }, ' '.repeat(d.name.split('::').length - 1) + d.name.split('::').pop()))
  );
  wrap.append(h('div', { style: { marginTop: '6px' } }, sel));
  const body = h('div');
  wrap.append(body);

  const allLogs = await db.getAll('revlog');

  function draw() {
    const conf = col.config;
    const ids = selectedDeck ? deckSubtree(selectedDeck) : null;
    const cards = [...col.cards.values()].filter((c) => !ids || ids.has(c.did));
    const cardIds = new Set(cards.map((c) => c.id));
    const logs = ids ? allLogs.filter((l) => cardIds.has(l.cid)) : allLogs;
    const today = dayNumber(Date.now(), conf.rollover);
    const todayStart = dayStart(today, conf.rollover);

    // today
    const tl = logs.filter((l) => l.id >= todayStart);
    const time = tl.reduce((s, l) => s + (l.time || 0), 0);
    const again = tl.filter((l) => l.ease === 1).length;
    const correct = tl.length ? Math.round(((tl.length - again) / tl.length) * 100) : null;

    // retention: reviews of mature-ish cards in last 30 days
    const since = dayStart(today - 29, conf.rollover);
    const recentRev = logs.filter((l) => l.id >= since && l.type === 1);
    const retention = recentRev.length ? Math.round((recentRev.filter((l) => l.ease > 1).length / recentRev.length) * 100) : null;

    // card states
    const states = [0, 0, 0, 0, 0];
    for (const c of cards) {
      if (c.suspended) states[4]++;
      else if (c.type === 0) states[0]++;
      else if (c.type === 1 || c.type === 3) states[1]++;
      else if (c.ivl < 21) states[2]++;
      else states[3]++;
    }
    const total = cards.length;
    const colors = STATE_COLORS[isDark() ? 'dark' : 'light'];
    const names = ['New', 'Learning', 'Young', 'Mature', 'Suspended'];

    // forecast next 30 days (overdue folds into today)
    const fc = new Array(30).fill(0);
    const nowTs = Date.now();
    for (const c of cards) {
      if (c.suspended) continue;
      let d = null;
      if (c.type === 2) d = Math.max(0, c.due - today);
      else if (c.type === 1 || c.type === 3) d = Math.max(0, dayNumber(Math.max(c.due, nowTs), conf.rollover) - today);
      if (d != null && d < 30) fc[d]++;
    }
    const fmtDay = (day, opts) => new Date(dayStart(day, conf.rollover)).toLocaleDateString([], opts);
    const forecast = fc.map((v, i) => ({ value: v, label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : fmtDay(today + i, { weekday: 'short', month: 'short', day: 'numeric' }), short: i === 0 ? 'Today' : `+${i}d` }));

    // past 30 days
    const past = new Array(30).fill(0);
    for (const l of logs) {
      if (l.id < since) continue;
      const d = dayNumber(l.id, conf.rollover) - (today - 29);
      if (d >= 0 && d < 30) past[d]++;
    }
    const history = past.map((v, i) => ({ value: v, label: i === 29 ? 'Today' : fmtDay(today - 29 + i, { weekday: 'short', month: 'short', day: 'numeric' }), short: i === 29 ? 'Today' : `-${29 - i}d` }));

    // streak
    const studiedDays = new Set(logs.map((l) => dayNumber(l.id, conf.rollover)));
    let streak = 0;
    for (let d = studiedDays.has(today) ? today : today - 1; studiedDays.has(d); d--) streak++;

    const due = fc[0];
    const stack = h('div', { class: 'stack', role: 'img', 'aria-label': names.map((n, i) => `${n} ${states[i]}`).join(', ') });
    states.forEach((v, i) => v && stack.append(h('div', { style: { flex: String(v), background: colors[i] }, title: `${names[i]}: ${v}` })));

    body.replaceChildren(
      h('div', { class: 'group-title' }, 'Today'),
      h('div', { class: 'stat-grid' },
        tile(tl.length.toLocaleString(), 'cards studied'),
        tile(tl.length ? fmtDuration(time) : '0s', 'time spent'),
        tile(correct == null ? '—' : `${correct}%`, 'correct today'),
        tile(due.toLocaleString(), 'due today')
      ),
      h('div', { class: 'stat-grid' },
        tile(retention == null ? '—' : `${retention}%`, 'retention, 30 days'),
        tile(`${streak} ${streak === 1 ? 'day' : 'days'}`, 'study streak')
      ),
      h('div', { class: 'panel' },
        h('h3', null, 'Cards'),
        h('div', { class: 'sub' }, `${total.toLocaleString()} total`),
        total ? stack : null,
        h('div', { class: 'legend' }, names.map((n, i) => h('span', null, h('i', { style: { background: colors[i] } }), n, h('b', null, states[i].toLocaleString()))))
      ),
      h('div', { class: 'panel' }, h('h3', null, 'Forecast'), barChart(forecast, { color: colors[0], unit: 'due', emptyText: 'No reviews due in the next 30 days' })),
      h('div', { class: 'panel' }, h('h3', null, 'Reviews, past 30 days'), barChart(history, { color: colors[0], unit: 'reviews', emptyText: 'No reviews in the past 30 days' }))
    );
  }
  draw();
}


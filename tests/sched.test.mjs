import test from 'node:test';
import assert from 'node:assert/strict';
import { answerCard, dayNumber, dayStart, DEFAULT_CONFIG, formatIvl, fuzz, MIN, previewLabels, reviewIntervals } from '../js/sched.js';

const conf = { ...DEFAULT_CONFIG };
const NOW = new Date(2026, 0, 15, 12, 0, 0).getTime();
const newCard = () => ({ id: 1700000000123, type: 0, due: 1, ivl: 0, factor: 0, reps: 0, lapses: 0, step: 0 });

test('dayNumber respects rollover hour', () => {
  const before = new Date(2026, 0, 15, 3, 59).getTime();
  const after = new Date(2026, 0, 15, 4, 0).getTime();
  assert.equal(dayNumber(after) - dayNumber(before), 1);
  assert.equal(dayNumber(dayStart(dayNumber(NOW))), dayNumber(NOW));
});

test('new card goes through learning steps', () => {
  let { card } = answerCard(newCard(), 3, NOW, conf);
  assert.equal(card.type, 1);
  assert.equal(card.step, 1);
  assert.equal(card.due, NOW + 10 * MIN);
  assert.equal(card.factor, 2500);
  ({ card } = answerCard(card, 3, NOW + 10 * MIN, conf));
  assert.equal(card.type, 2);
  assert.equal(card.ivl, 1);
  assert.equal(card.due, dayNumber(NOW + 10 * MIN) + 1);
});

test('again resets to first step, hard averages first two steps', () => {
  const again = answerCard(newCard(), 1, NOW, conf).card;
  assert.equal(again.due, NOW + 1 * MIN);
  const hard = answerCard(newCard(), 2, NOW, conf).card;
  assert.equal(hard.due, NOW + 5.5 * MIN);
});

test('easy on new card graduates with easy interval', () => {
  const { card } = answerCard(newCard(), 4, NOW, conf);
  assert.equal(card.type, 2);
  assert.ok(card.ivl >= 3 && card.ivl <= 5, `ivl ${card.ivl}`);
});

test('review intervals are ordered and lapse enters relearning', () => {
  const today = dayNumber(NOW);
  const rev = { id: 42, type: 2, due: today, ivl: 10, factor: 2500, reps: 5, lapses: 0, step: 0 };
  const { hard, good, easy } = reviewIntervals(rev, today, conf);
  assert.ok(hard > 10 && hard < good && good < easy, `${hard} ${good} ${easy}`);
  assert.ok(good >= 22 && good <= 28, `good ${good}`);
  const lapse = answerCard(rev, 1, NOW, conf);
  assert.equal(lapse.card.type, 3);
  assert.equal(lapse.card.lapses, 1);
  assert.equal(lapse.card.factor, 2300);
  assert.equal(lapse.card.ivl, 1);
  const back = answerCard(lapse.card, 3, NOW + 10 * MIN, conf).card;
  assert.equal(back.type, 2);
  assert.equal(back.due, today + 1);
  assert.equal(answerCard(rev, 2, NOW, conf).card.factor, 2350);
  assert.equal(answerCard(rev, 4, NOW, conf).card.factor, 2650);
});

test('preview labels match actual answers', () => {
  const today = dayNumber(NOW);
  const rev = { id: 99, type: 2, due: today - 3, ivl: 30, factor: 2300, reps: 9, lapses: 1, step: 0 };
  const labels = previewLabels(rev, NOW, conf);
  assert.equal(labels[0], '10m');
  const good = answerCard(rev, 3, NOW, conf).card;
  assert.equal(labels[2], formatIvl((good.due - today) * 86400000, true));
  assert.deepEqual(previewLabels(newCard(), NOW, conf).slice(0, 3), ['1m', '6m', '10m']);
});

test('leech detection at threshold', () => {
  const today = dayNumber(NOW);
  const rev = { id: 5, type: 2, due: today, ivl: 3, factor: 1300, reps: 20, lapses: 7, step: 0 };
  assert.equal(answerCard(rev, 1, NOW, conf).leech, true);
  assert.equal(answerCard({ ...rev, lapses: 8 }, 1, NOW, conf).leech, false);
  assert.equal(answerCard({ ...rev, lapses: 11 }, 1, NOW, conf).leech, true);
});

test('fuzz is deterministic and bounded', () => {
  assert.equal(fuzz(1, 3), 1);
  for (let s = 0; s < 50; s++) {
    const v = fuzz(100, s);
    assert.ok(v >= 93 && v <= 107, String(v));
    assert.equal(v, fuzz(100, s));
  }
});

test('max interval caps', () => {
  const today = dayNumber(NOW);
  const rev = { id: 7, type: 2, due: today, ivl: 36000, factor: 2500, reps: 9, lapses: 0, step: 0 };
  assert.equal(reviewIntervals(rev, today, conf).easy, 36500);
});

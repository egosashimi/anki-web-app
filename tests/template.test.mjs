import test from 'node:test';
import assert from 'node:assert/strict';
import { cardOrdinals, clozeNumbers, renderCard, typeCompareHtml } from '../js/template.js';

const basic = { name: 'Basic', kind: 0, fields: [{ name: 'Front' }, { name: 'Back' }], templates: [{ name: 'Card 1', qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr id=answer>{{Back}}' }] };
const optRev = {
  name: 'Opt', kind: 0, fields: [{ name: 'Front' }, { name: 'Back' }, { name: 'Add Reverse' }],
  templates: [
    { name: 'Card 1', qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr id=answer>{{Back}}' },
    { name: 'Card 2', qfmt: '{{#Add Reverse}}{{Back}}{{/Add Reverse}}', afmt: '{{FrontSide}}<hr id=answer>{{Front}}' },
  ],
};
const cloze = { name: 'Cloze', kind: 1, fields: [{ name: 'Text' }, { name: 'Extra' }], templates: [{ name: 'Cloze', qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>{{Extra}}' }] };

test('basic render with FrontSide', () => {
  const r = renderCard(basic, { fields: ['Q', 'A'], tags: [] }, { ord: 0 });
  assert.equal(r.q, 'Q');
  assert.equal(r.a, 'Q<hr id=answer>A');
});

test('conditional card generation', () => {
  assert.deepEqual(cardOrdinals(optRev, { fields: ['a', 'b', ''] }), [0]);
  assert.deepEqual(cardOrdinals(optRev, { fields: ['a', 'b', 'y'] }), [0, 1]);
  assert.deepEqual(cardOrdinals(basic, { fields: ['', 'b'] }), []);
  assert.deepEqual(cardOrdinals(basic, { fields: ['<br>', 'b'] }), []);
  assert.deepEqual(cardOrdinals(basic, { fields: ['<img src="x.png">', 'b'] }), [0]);
});

test('cloze rendering and numbering', () => {
  const note = { fields: ['{{c1::Paris}} is in {{c2::France::country}}', 'x'], tags: [] };
  assert.deepEqual(clozeNumbers(note.fields), [1, 2]);
  assert.deepEqual(cardOrdinals(cloze, note), [0, 1]);
  const c2 = renderCard(cloze, note, { ord: 1 });
  assert.match(c2.q, /<span class="cloze">\[country\]<\/span>/);
  assert.match(c2.q, /<span class="cloze-inactive">Paris<\/span>/);
  assert.match(c2.a, /<span class="cloze">France<\/span>/);
  assert.match(c2.a, /<br>x$/);
});

test('inverted sections, filters and special fields', () => {
  const nt = { ...basic, templates: [{ name: 'T', qfmt: '{{^Back}}empty{{/Back}}{{text:Front}} {{Tags}} {{Deck}} {{kanji:Front}}', afmt: '{{hint:Back}}' }] };
  const r = renderCard(nt, { fields: ['<b>日本[にほん]</b>', ''], tags: ['t1'] }, { ord: 0 }, { deck: 'A::B' });
  assert.equal(r.q, 'empty日本[にほん] t1 A::B <b>日本</b>');
  assert.equal(r.a, '');
});

test('type answer placeholder and comparison', () => {
  const nt = { ...basic, templates: [{ name: 'T', qfmt: '{{Front}} {{type:Back}}', afmt: '{{FrontSide}}<hr id=answer>{{type:Back}}' }] };
  const r = renderCard(nt, { fields: ['Q', '<b>cat</b>'], tags: [] }, { ord: 0 });
  assert.equal(r.typeAnswer, 'cat');
  assert.match(r.q, /data-type-answer/);
  assert.equal((r.a.match(/data-type-answer/g) || []).length, 1);
  assert.match(typeCompareHtml('cat', 'cat'), /typeGood/);
  const diff = typeCompareHtml('cot', 'cat');
  assert.match(diff, /typeBad">o/);
  assert.match(diff, /typeMissed">a/);
});

test('renaming fields rewrites template references', async () => {
  const { renameFieldRefs } = await import('../js/col.js');
  const m = new Map([['Front', 'Word'], ['Add Reverse', 'Rev']]);
  assert.equal(
    renameFieldRefs('{{Front}} {{#Add Reverse}}{{Back}}{{/Add Reverse}} {{type:Front}} {{FrontSide}}', m),
    '{{Word}} {{#Rev}}{{Back}}{{/Rev}} {{type:Word}} {{FrontSide}}'
  );
});

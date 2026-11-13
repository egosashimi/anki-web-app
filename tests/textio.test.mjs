import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSeparator, parseDelimited, parseTextFile, serializeText } from '../js/textio.js';

test('parses quoted CSV', () => {
  assert.deepEqual(parseDelimited('a,"b, c","d ""e"""\n"multi\nline",x\n', ','), [['a', 'b, c', 'd "e"'], ['multi\nline', 'x']]);
});

test('detects separators', () => {
  assert.equal(detectSeparator('a\tb\nc\td'), '\t');
  assert.equal(detectSeparator('a;b;c\nd;e;f'), ';');
  assert.equal(detectSeparator('a,b\nc,d'), ',');
});

test('reads Anki text export headers and round trips', () => {
  const text = serializeText([{ fields: ['front <b>x</b>', 'back\twith tab'], tags: ['a', 'b'], guid: 'g1' }], { guidColumn: true });
  const parsed = parseTextFile(text);
  assert.equal(parsed.separator, '\t');
  assert.equal(parsed.html, true);
  assert.equal(parsed.guidColumn, 0);
  assert.equal(parsed.tagsColumn, 3);
  assert.deepEqual(parsed.rows, [['g1', 'front <b>x</b>', 'back\twith tab', 'a b']]);
});

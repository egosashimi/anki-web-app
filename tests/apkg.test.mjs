import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readApkg, referencedMedia, writeApkg } from '../js/apkg.js';
import { DEFAULT_CONFIG, dayNumber, dayStart } from '../js/sched.js';
import { loadLibs } from './helpers.mjs';

const libs = await loadLibs();
const fixture = (n) => new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));

for (const name of ['modern.apkg', 'legacy.apkg']) {
  test(`reads ${name} exported by Anki`, () => {
    const d = readApkg(fixture(name), libs);
    const names = d.notetypes.map((n) => n.name);
    assert.ok(names.includes('Basic') && names.includes('Cloze'), names.join(','));
    const basic = d.notetypes.find((n) => n.name === 'Basic');
    assert.deepEqual(basic.fields.map((f) => f.name), ['Front', 'Back']);
    assert.equal(basic.templates[0].qfmt, '{{Front}}');
    assert.match(basic.templates[0].afmt, /FrontSide/);
    assert.equal(d.notetypes.find((n) => n.name === 'Cloze').kind, 1);
    assert.ok(d.decks.some((x) => x.name === 'Spanish::Verbs'), d.decks.map((x) => x.name).join(','));
    assert.equal(d.notes.length, 3);
    assert.equal(d.cards.length, 5);
    const hablar = d.notes.find((n) => n.fields[0] === 'hablar');
    assert.deepEqual(hablar.tags.sort(), ['ar', 'verb']);
    const rev = d.cards.find((c) => c.nid === hablar.id);
    assert.equal(rev.type, 2);
    assert.equal(d.media.length, 1);
    assert.equal(d.media[0].name, 'dot.png');
    const bytes = d.media[0].data();
    assert.deepEqual([...bytes.slice(1, 4)], [80, 78, 71]); // "PNG"
  });
}

test('write then read back an .apkg', () => {
  const nt = { id: 1700000000001, name: 'Basic', kind: 0, sortf: 0, css: '.card{}', fields: [{ name: 'Front' }, { name: 'Back' }], templates: [{ name: 'Card 1', qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr id=answer>{{Back}}' }] };
  const today = dayNumber(Date.now());
  const notes = [{ id: 1, guid: 'abc', ntid: nt.id, fields: ['q <img src="a.png">', 'a'], tags: ['x'], mod: Date.now() }];
  const cards = [
    { id: 11, nid: 1, did: 5, ord: 0, type: 2, due: today + 3, ivl: 7, factor: 2500, reps: 3, lapses: 0, step: 0, suspended: false, flags: 0 },
  ];
  const media = [{ name: 'a.png', data: new Uint8Array([1, 2, 3]) }];
  assert.deepEqual(referencedMedia(notes[0].fields), ['a.png']);
  const out = writeApkg(
    {
      notetypes: [nt], decks: [{ id: 5, name: 'Deck::Sub' }], notes, cards, revlog: [{ id: 123, cid: 11, ease: 3, ivl: 7, lastIvl: 3, factor: 2500, time: 4000, type: 1 }], media,
      conf: DEFAULT_CONFIG, includeScheduling: true, today, dayStartMs: (d) => dayStart(d),
      csum: (s) => parseInt(createHash('sha1').update(s).digest('hex').slice(0, 8), 16),
    },
    libs
  );
  const d = readApkg(out, libs);
  assert.equal(d.notes[0].guid, 'abc');
  assert.deepEqual(d.notes[0].fields, notes[0].fields);
  assert.equal(d.cards[0].type, 2);
  assert.equal(dayNumber(d.crt * 1000) + d.cards[0].due, today + 3);
  assert.equal(d.revlog.length, 1);
  assert.equal(d.media[0].name, 'a.png');
  assert.deepEqual([...d.media[0].data()], [1, 2, 3]);
  assert.ok(d.decks.some((x) => x.name === 'Deck::Sub'));
});

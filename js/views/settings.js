import { APP_VERSION, applyTheme, go } from '../app.js';
import { col, saveConfig } from '../col.js';
import * as db from '../db.js';
import { eraseEverything } from '../io.js';
import { DEFAULT_CONFIG } from '../sched.js';
import { confirmDialog, fmtBytes, h, icon, promptDialog, segmented, setHeader, switchEl, toast } from '../ui.js';
import { formatSteps, parseSteps } from '../util.js';

export function numberRow(label, key, { min = 0, max = 99999, step = 1, scale = 1, sub, target = col.config, onSave = saveConfig } = {}) {
  const input = h('input', {
    type: 'number',
    inputmode: step < 1 ? 'decimal' : 'numeric',
    min,
    max,
    step,
    value: +(target[key] * scale).toFixed(4),
    onchange: async () => {
      const v = parseFloat(input.value);
      if (!Number.isFinite(v) || v < min || v > max) {
        toast(`Enter a value between ${min} and ${max}`);
        input.value = +(target[key] * scale).toFixed(4);
        return;
      }
      target[key] = v / scale;
      await onSave();
    },
  });
  return h('label', { class: 'row' }, h('div', { class: 'grow' }, label, sub ? h('div', { class: 'sub' }, sub) : null), input);
}

function stepsRow(label, key, allowEmpty) {
  const input = h('input', {
    type: 'text',
    class: 'short',
    value: formatSteps(col.config[key]),
    autocapitalize: 'off',
    onchange: async () => {
      const steps = parseSteps(input.value);
      if (!steps || (!allowEmpty && !steps.length)) {
        toast('Use steps like “1m 10m 1h”');
        input.value = formatSteps(col.config[key]);
        return;
      }
      col.config[key] = steps;
      input.value = formatSteps(steps);
      await saveConfig();
    },
  });
  return h('label', { class: 'row' }, h('div', { class: 'grow' }, label), input);
}

function selectRow(label, key, options, after) {
  const sel = h(
    'select',
    {
      onchange: async () => {
        const raw = sel.value;
        col.config[key] = typeof DEFAULT_CONFIG[key] === 'number' ? Number(raw) : raw;
        await saveConfig();
        after?.();
      },
    },
    options.map(([v, l]) => h('option', { value: v, selected: String(col.config[key]) === String(v) }, l))
  );
  return h('label', { class: 'row' }, h('div', { class: 'grow' }, label), sel);
}

function toggleRow(label, key, sub) {
  return h(
    'div',
    { class: 'row' },
    h('div', { class: 'grow' }, label, sub ? h('div', { class: 'sub' }, sub) : null),
    switchEl(!!col.config[key], async (v) => {
      col.config[key] = v;
      await saveConfig();
    })
  );
}

function linkRow(label, href, sub, ic) {
  return h('a', { class: 'row', href }, ic ? icon(ic) : null, h('div', { class: 'grow' }, label, sub ? h('div', { class: 'sub' }, sub) : null), icon('right', 'chev'));
}

export default function settingsView(main) {
  setHeader({ title: 'Settings' });
  const wrap = h('div', { class: 'wrap' });
  main.append(wrap);
  const hours = Array.from({ length: 24 }, (_, i) => [i, `${String(i).padStart(2, '0')}:00`]);

  const storageRow = h('div', { class: 'row' }, h('div', { class: 'grow' }, 'Storage', h('div', { class: 'sub' }, 'Checking…')));
  (async () => {
    const sub = storageRow.querySelector('.sub');
    let persisted = false;
    try {
      persisted = (await navigator.storage?.persisted?.()) || false;
    } catch {}
    let usage = '';
    try {
      const est = await navigator.storage?.estimate?.();
      if (est) usage = `${fmtBytes(est.usage || 0)} used`;
    } catch {}
    const [cards, media] = await Promise.all([db.count('cards'), db.count('media')]);
    sub.textContent = [`${cards.toLocaleString()} cards`, `${media.toLocaleString()} media files`, usage, persisted ? 'persistent' : 'may be cleared by the browser'].filter(Boolean).join(' · ');
  })();

  wrap.append(
    h('div', { class: 'group-title' }, 'Appearance'),
    h(
      'div',
      { class: 'group' },
      h('div', { class: 'row' }, h('div', { class: 'grow' }, 'Theme'), h('div', { style: { width: '210px' } }, segmented([['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], col.config.theme, async (v) => {
        col.config.theme = v;
        await saveConfig();
        applyTheme();
      }))),
      toggleRow('Show next intervals', 'showIntervals', 'Display times above the answer buttons'),
      toggleRow('Autoplay audio', 'autoplay')
    ),

    h('div', { class: 'group-title' }, 'Daily limits'),
    h('div', { class: 'group' },
      numberRow('New cards/day', 'newPerDay', { max: 9999 }),
      numberRow('Maximum reviews/day', 'revPerDay', { max: 99999 }),
      selectRow('Next day starts at', 'rollover', hours)
    ),
    h('p', { class: 'hint-text' }, 'Defaults for every deck. Individual decks can override these in deck options.'),

    h('div', { class: 'group-title' }, 'New cards'),
    h('div', { class: 'group' },
      stepsRow('Learning steps', 'learnSteps', false),
      numberRow('Graduating interval', 'graduatingIvl', { min: 1, max: 365, sub: 'days' }),
      numberRow('Easy interval', 'easyIvl', { min: 1, max: 365, sub: 'days' }),
      selectRow('Order', 'newOrder', [['added', 'Order added'], ['random', 'Random']]),
      selectRow('Mix with reviews', 'newMix', [['mix', 'Mixed'], ['first', 'New first'], ['last', 'Reviews first']])
    ),

    h('div', { class: 'group-title' }, 'Lapses'),
    h('div', { class: 'group' },
      stepsRow('Relearning steps', 'relearnSteps', true),
      numberRow('New interval', 'lapseMult', { min: 0, max: 100, scale: 100, sub: '% of previous interval' }),
      numberRow('Minimum interval', 'minIvl', { min: 1, max: 365, sub: 'days' }),
      numberRow('Leech threshold', 'leechThreshold', { min: 0, max: 99, sub: 'lapses (0 disables)' }),
      selectRow('Leech action', 'leechAction', [['tag', 'Tag only'], ['suspend', 'Suspend card']])
    ),

    h('div', { class: 'group-title' }, 'Advanced'),
    h('div', { class: 'group' },
      numberRow('Maximum interval', 'maxIvl', { min: 1, max: 36500, sub: 'days' }),
      numberRow('Starting ease', 'startingEase', { min: 131, max: 999, scale: 100, sub: '%' }),
      numberRow('Easy bonus', 'easyBonus', { min: 100, max: 500, scale: 100, sub: '%' }),
      numberRow('Interval modifier', 'ivlMod', { min: 10, max: 500, scale: 100, sub: '%' }),
      numberRow('Hard interval', 'hardIvl', { min: 100, max: 200, scale: 100, sub: '%' }),
      numberRow('Learn ahead limit', 'learnAheadMins', { min: 0, max: 1440, sub: 'minutes' })
    ),

    h('div', { class: 'group-title' }, 'Data'),
    h('div', { class: 'group' },
      linkRow('Import', '#/import', '.apkg, .colpkg, .txt, .csv, backup .zip', 'import'),
      linkRow('Export', '#/export', 'Anki package, text, or full backup', 'export'),
      linkRow('Note types', '#/notetypes', 'Fields, card templates and styling', 'edit'),
      storageRow
    ),
    h('p', { class: 'hint-text' }, 'Everything is stored only on this device. On iPhone, add the app to your Home Screen (Share → Add to Home Screen) so Safari keeps your data, and export a backup now and then.'),

    h('div', { class: 'group', style: { marginTop: '24px' } },
      h('button', {
        class: 'row',
        onclick: async () => {
          if (!(await confirmDialog('Restore all scheduling options to their defaults?', { title: 'Reset options', ok: 'Reset' }))) return;
          const keep = { theme: col.config.theme };
          col.config = { ...DEFAULT_CONFIG, ...keep };
          await saveConfig();
          go('#/settings', { replace: true });
        },
      }, h('div', { class: 'grow' }, 'Reset options to defaults')),
      h('button', {
        class: 'row danger',
        onclick: async () => {
          if (!(await confirmDialog('All decks, cards, review history and media on this device will be permanently deleted.', { title: 'Erase all data', ok: 'Continue', danger: true }))) return;
          const typed = await promptDialog('Type ERASE to confirm', '', { ok: 'Erase' });
          if (typed !== 'ERASE') return toast('Nothing was deleted');
          await eraseEverything();
          applyTheme();
          toast('All data erased');
          go('#/decks');
        },
      }, h('div', { class: 'grow' }, 'Erase all data'))
    ),
    h('p', { class: 'hint-text center', style: { marginTop: '24px' } }, `Flashcards · version ${APP_VERSION}`),
    h('p', { class: 'hint-text center' }, 'Compatible with Anki packages. No account, no tracking.')
  );
}

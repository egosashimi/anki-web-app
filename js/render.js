// Turns rendered template HTML into safe, styled DOM inside a shadow root.
import { col } from './col.js';
import { mediaUrl } from './media.js';
import { renderCard, typeCompareHtml } from './template.js';
import { escapeHtml } from './util.js';

const BASE_CSS = `
:host { display: block; color: var(--fg); }
.card { padding: 8px 4px 24px; overflow-wrap: anywhere; min-height: 100%; }
.card img { max-width: 100%; height: auto; }
.card video { max-width: 100%; }
.card table { margin: 0 auto; border-collapse: collapse; }
hr#answer, hr { border: 0; border-top: 1px solid var(--line); margin: 20px 0; }
.cloze { font-weight: 600; color: var(--accent); }
.cloze-inactive { }
.tmpl-error { color: var(--danger); font-size: 14px; }
details.hint { margin: 10px 0; }
details.hint summary { color: var(--accent); cursor: pointer; font-size: 0.85em; }
.sound { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%;
  border: 0; background: var(--bg2); color: var(--fg); vertical-align: middle; margin: 2px 4px; cursor: pointer; }
.sound svg { width: 16px; height: 16px; margin-left: 2px; }
.sound.missing { opacity: .4; }
input.typeans { font: inherit; font-size: 18px; width: 100%; max-width: 420px; padding: 10px 12px; margin: 12px auto 0; display: block;
  border-radius: 12px; border: 1px solid var(--line); background: var(--bg2); color: var(--fg); text-align: center; outline: none; }
input.typeans:focus { border-color: var(--accent); }
.typecmp { font-family: ui-monospace, Menlo, monospace; font-size: 18px; margin: 12px 0; }
.typeGood { color: var(--good); }
.typeBad { color: var(--again); text-decoration: line-through; }
.typeMissed { color: var(--hard); text-decoration: underline; }
.typeArrow { color: var(--muted); }
ruby rt { font-size: 0.55em; }
`;

const NIGHT_OVERRIDES = `
.card { background-color: transparent !important; color: var(--fg) !important; }
`;

const ALLOWED_URL = /^(https?:|data:image\/|blob:|#|mailto:)/i;

/** Remove scripts, inline handlers and javascript: URLs. Works on a template element. */
export function sanitize(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walk = (root) => {
    for (const el of [...root.querySelectorAll('*')]) {
      const tag = el.tagName.toLowerCase();
      if (['script', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'form'].includes(tag)) {
        el.remove();
        continue;
      }
      for (const attr of [...el.attributes]) {
        const n = attr.name.toLowerCase();
        if (n.startsWith('on')) el.removeAttribute(attr.name);
        else if ((n === 'href' || n === 'src' || n === 'xlink:href' || n === 'action' || n === 'formaction') && /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
      }
      if (tag === 'a' && el.getAttribute('href') && !el.getAttribute('href').startsWith('#')) {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
    }
  };
  walk(tpl.content);
  return tpl;
}

const PLAY_SVG = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';

async function resolveMedia(frag, styleText) {
  // images / audio / video sources referencing local media
  const jobs = [];
  for (const el of frag.querySelectorAll('img[src], audio[src], video[src], source[src]')) {
    const src = el.getAttribute('src');
    if (ALLOWED_URL.test(src)) continue;
    let name;
    try {
      name = decodeURIComponent(src);
    } catch {
      name = src;
    }
    jobs.push(mediaUrl(name).then((url) => (url ? el.setAttribute('src', url) : el.setAttribute('data-missing', name))));
  }
  for (const btn of frag.querySelectorAll('button.sound[data-src]')) {
    jobs.push(mediaUrl(btn.dataset.src).then((url) => (url ? (btn.dataset.url = url) : btn.classList.add('missing'))));
  }
  // CSS url(...) references, e.g. custom fonts "_font.ttf"
  let css = styleText;
  const refs = [...new Set([...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]))].filter((r) => !ALLOWED_URL.test(r));
  await Promise.all([
    ...jobs,
    ...refs.map(async (r) => {
      const url = await mediaUrl(r);
      if (url) css = css.split(r).join(url);
    }),
  ]);
  return css;
}

function soundify(html) {
  return html.replace(/\[sound:([^\]]+)\]/g, (_m, name) => `<button class="sound" type="button" data-src="${escapeHtml(name)}" aria-label="Play audio">${PLAY_SVG}</button>`).replace(/\[anki:tts[^\]]*\][\s\S]*?\[\/anki:tts\]/g, '');
}

let currentAudio = null;
export function stopAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

function playQueue(urls) {
  stopAudio();
  const list = [...urls];
  const playNext = () => {
    const u = list.shift();
    if (!u) return;
    const a = new Audio(u);
    currentAudio = a;
    a.onended = playNext;
    a.play().catch(() => {});
  };
  playNext();
}

function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Render a card side into `host`. Returns { typedValue() } accessor for type-in answers.
 * opts: { side: 'q'|'a', typed, autoplay, onEnter }
 */
export async function renderCardInto(host, card, opts = {}) {
  const note = opts.note || col.notes.get(card.nid);
  const nt = col.notetypes.get(note?.ntid);
  if (!note || !nt) {
    host.textContent = 'Missing note or note type.';
    return {};
  }
  const deck = col.decks.get(card.did)?.name || '';
  const { q, a, typeAnswer } = renderCard(nt, note, card, { deck });
  let html = opts.side === 'a' ? a : q;
  if (opts.side === 'a') {
    html = html.replace(/<span data-type-answer="1"><\/span>/g, typeAnswer != null ? typeCompareHtml(opts.typed || '', typeAnswer) : '');
  } else {
    html = html.replace(/<span data-type-answer="1"><\/span>/g, '<input class="typeans" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Type answer" enterkeyhint="done">');
  }
  html = soundify(html);
  const tpl = sanitize(html);
  const dark = isDark();
  const css = await resolveMedia(tpl.content, nt.css || '');
  const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = BASE_CSS + '\n' + css + (dark ? NIGHT_OVERRIDES : '');
  const wrapper = document.createElement('div');
  wrapper.className = `card card${card.ord + 1}${dark ? ' nightMode night_mode' : ''}`;
  wrapper.append(tpl.content);
  root.replaceChildren(style, wrapper);

  const sounds = [...root.querySelectorAll('button.sound')];
  for (const b of sounds) b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (b.dataset.url) playQueue([b.dataset.url]);
  });
  // on the answer side, only autoplay sounds that are not on the question
  let autoplay = sounds;
  if (opts.side === 'a') {
    const qSounds = (q.match(/\[sound:[^\]]+\]/g) || []).length;
    autoplay = sounds.slice(a.includes(q.replace(/<span data-type-answer="1"><\/span>/g, '')) ? qSounds : 0);
  }
  if (opts.autoplay && autoplay.length) playQueue(autoplay.map((b) => b.dataset.url).filter(Boolean));
  for (const v of root.querySelectorAll('audio[autoplay], video[autoplay]')) if (!opts.autoplay) v.removeAttribute('autoplay');

  const input = root.querySelector('input.typeans');
  if (input && opts.onEnter) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        opts.onEnter();
      }
    });
    input.addEventListener('click', (e) => e.stopPropagation());
  }
  return {
    typedValue: () => input?.value ?? '',
    focusInput: () => input?.focus(),
    hasInput: !!input,
    answerAnchor: root.getElementById('answer'),
  };
}

// DOM helpers and shared UI components.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value') el.value = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const P = {
  decks: '<rect x="3" y="7" width="14" height="13" rx="2"/><path d="M7 4h11a3 3 0 0 1 3 3v10"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  browse: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  stats: '<path d="M5 20V11M12 20V5M19 20v-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  import: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  export: '<path d="M12 15V3M7 8l5-5 5 5M5 21h14"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
  moon: '<path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  rename: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
};

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.style.display = 'contents';
  span.innerHTML = `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
  return span.firstChild;
}

export function iconBtn(name, label, onClick) {
  return h('button', { class: 'icon-btn', 'aria-label': label, title: label, onclick: onClick }, icon(name));
}

export function textBtn(label, onClick, props = {}) {
  return h('button', { class: 'text-btn', onclick: onClick, ...props }, label);
}

// ---------- header ----------
export function setHeader({ title = '', left = [], right = [] } = {}) {
  const bar = document.getElementById('topbar');
  bar.querySelector('h1').textContent = title;
  bar.querySelector('.left').replaceChildren(...[left].flat().filter(Boolean));
  bar.querySelector('.right').replaceChildren(...[right].flat().filter(Boolean));
  document.title = title && title !== 'Decks' ? `${title} · Flashcards` : 'Flashcards';
}

// ---------- toast ----------
let toastTimer;
export function toast(msg, { action, onAction, ms = 2600 } = {}) {
  const t = document.getElementById('toast');
  t.replaceChildren(...[h('span', null, msg), action ? h('button', { onclick: () => { t.classList.remove('show'); onAction?.(); } }, action) : null].filter(Boolean));
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- sheets ----------
let openSheets = [];
export function sheet(content, { onClose, title } = {}) {
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'grabber' }), title ? h('h2', null, title) : null, content);
  const backdrop = h('div', { class: 'backdrop' }, panel);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    openSheets = openSheets.filter((s) => s !== close);
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && openSheets[openSheets.length - 1] === close) {
      e.stopPropagation();
      close();
    }
  };
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  // swipe down to dismiss
  let startY = null;
  panel.addEventListener('touchstart', (e) => {
    startY = panel.scrollTop <= 0 ? e.touches[0].clientY : null;
  }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) panel.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  panel.addEventListener('touchend', (e) => {
    if (startY == null) return;
    const dy = e.changedTouches[0].clientY - startY;
    panel.style.transform = '';
    if (dy > 110) close();
    startY = null;
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(backdrop);
  openSheets.push(close);
  return close;
}

export function closeAllSheets() {
  for (const c of [...openSheets]) c();
}

export function isSheetOpen() {
  return openSheets.length > 0;
}

/** items: [{ label, icon, danger, onClick }] */
export function actionSheet(items, { title } = {}) {
  let close;
  const list = h(
    'div',
    { class: 'action-list' },
    items.filter(Boolean).map((it) =>
      h('button', { class: it.danger ? 'danger' : '', onclick: () => { close(); it.onClick(); } }, it.icon ? icon(it.icon) : null, it.label)
    )
  );
  const cancel = h('button', { class: 'btn block', style: { marginTop: '10px' }, onclick: () => close() }, 'Cancel');
  close = sheet(h('div', null, list, cancel), { title });
  return close;
}

export function confirmDialog(message, { title = 'Are you sure?', ok = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    let close;
    const body = h(
      'div',
      null,
      h('p', { class: 'msg' }, message),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: `btn block ${danger ? 'danger' : 'primary'}`, onclick: () => { result = true; close(); } }, ok),
        h('button', { class: 'btn block', onclick: () => close() }, 'Cancel')
      )
    );
    close = sheet(body, { title, onClose: () => resolve(result) });
  });
}

export function promptDialog(title, value = '', { ok = 'Save', placeholder = '', hint } = {}) {
  return new Promise((resolve) => {
    let result = null;
    let close;
    const input = h('input', { type: 'text', value, placeholder, autocapitalize: 'sentences', enterkeyhint: 'done' });
    const submit = () => {
      result = input.value.trim();
      close();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    const body = h(
      'div',
      null,
      input,
      hint ? h('p', { class: 'hint-text' }, hint) : null,
      h('div', { class: 'actions' }, h('button', { class: 'btn block primary', onclick: submit }, ok), h('button', { class: 'btn block', onclick: () => close() }, 'Cancel'))
    );
    close = sheet(body, { title, onClose: () => resolve(result || null) });
    setTimeout(() => {
      input.focus();
      input.select();
    }, 60);
  });
}

export function progressSheet(text = 'Working…') {
  const label = h('div', null, text);
  const close = sheet(h('div', { class: 'progress' }, h('div', { class: 'spinner' }), label));
  return { set: (t) => (label.textContent = t), close };
}

// ---------- files ----------
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', style: { display: 'none' } });
    if (accept) input.accept = accept;
    input.addEventListener('change', () => {
      resolve(input.files[0] || null);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

/** Offer a generated file: share sheet on iOS (save to Files), download elsewhere. */
export function offerFile({ blob, filename }, title = 'Export ready') {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  const canShare = navigator.canShare?.({ files: [file] });
  const url = URL.createObjectURL(blob);
  let close;
  const actions = h('div', { class: 'actions' });
  if (canShare) {
    actions.append(
      h('button', {
        class: 'btn block primary',
        onclick: async () => {
          try {
            await navigator.share({ files: [file], title: filename });
            close();
          } catch (e) {
            if (e.name !== 'AbortError') toast('Sharing failed: ' + e.message);
          }
        },
      }, 'Save or share…')
    );
  }
  actions.append(h('a', { class: `btn block ${canShare ? '' : 'primary'}`, href: url, download: filename, onclick: () => setTimeout(() => close(), 300) }, 'Download'));
  actions.append(h('button', { class: 'btn block', onclick: () => close() }, 'Close'));
  close = sheet(h('div', null, h('p', { class: 'msg' }, `${filename} · ${fmtBytes(blob.size)}`), actions), {
    title,
    onClose: () => setTimeout(() => URL.revokeObjectURL(url), 60_000),
  });
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function switchEl(checked, onChange) {
  const input = h('input', { type: 'checkbox', checked, onchange: () => onChange(input.checked) });
  return h('label', { class: 'switch' }, input, h('span'));
}

export function segmented(options, value, onChange) {
  const el = h('div', { class: 'seg', role: 'tablist' });
  const render = (v) => {
    el.replaceChildren(
      ...options.map(([val, label]) =>
        h('button', { class: val === v ? 'on' : '', type: 'button', onclick: () => { render(val); onChange(val); } }, label)
      )
    );
  };
  render(value);
  return el;
}

export function deckSelect(decks, value, onChange) {
  const sel = h(
    'select',
    { onchange: () => onChange?.(Number(sel.value)) },
    decks.map((d) => h('option', { value: d.id, selected: d.id === value }, ' '.repeat(d.name.split('::').length - 1) + d.name.split('::').pop()))
  );
  return sel;
}

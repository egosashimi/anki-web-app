import { col, load } from './col.js';
import { h, icon, toast, closeAllSheets } from './ui.js';
import decksView from './views/decks.js';
import studyView from './views/study.js';
import editorView from './views/editor.js';
import browseView from './views/browse.js';
import statsView from './views/stats.js';
import settingsView from './views/settings.js';
import deckOptionsView from './views/deckoptions.js';
import { notetypesView, notetypeView } from './views/notetypes.js';
import { importView, exportView } from './views/importexport.js';

export const APP_VERSION = document.querySelector('meta[name="app-version"]')?.content || 'dev';

const routes = [
  [/^\/?(?:decks)?$/, decksView, 'decks'],
  [/^\/study\/(\d+)$/, studyView, 'decks'],
  [/^\/add$/, editorView, 'add'],
  [/^\/edit\/(\d+)$/, editorView, 'browse'],
  [/^\/browse$/, browseView, 'browse'],
  [/^\/stats$/, statsView, 'stats'],
  [/^\/settings$/, settingsView, 'settings'],
  [/^\/deck\/(\d+)$/, deckOptionsView, 'decks'],
  [/^\/notetypes$/, notetypesView, 'settings'],
  [/^\/notetype\/(\d+)$/, notetypeView, 'settings'],
  [/^\/import$/, importView, 'settings'],
  [/^\/export$/, exportView, 'settings'],
];

const TABS = [
  ['decks', 'Decks', '#/decks'],
  ['add', 'Add', '#/add'],
  ['browse', 'Browse', '#/browse'],
  ['stats', 'Stats', '#/stats'],
  ['settings', 'Settings', '#/settings'],
];

let cleanup = null;
let keyHandler = null;

export function setKeyHandler(fn) {
  keyHandler = fn;
}

export function go(hash, { replace = false } = {}) {
  if (replace) {
    history.replaceState(null, '', hash);
    route();
  } else if (location.hash === hash) route();
  else location.hash = hash;
}

export function back(fallback = '#/decks') {
  if (history.length > 1 && sessionStorageGet('navCount') > 0) history.back();
  else go(fallback, { replace: true });
}

function sessionStorageGet(k) {
  try {
    return Number(sessionStorage.getItem(k) || 0);
  } catch {
    return 0;
  }
}
function sessionStorageSet(k, v) {
  try {
    sessionStorage.setItem(k, String(v));
  } catch {}
}

export function rerender() {
  route();
}

function route() {
  closeAllSheets();
  const raw = location.hash.replace(/^#/, '') || '/decks';
  const [path, qs] = raw.split('?');
  const query = new URLSearchParams(qs || '');
  if (cleanup) {
    try {
      cleanup();
    } catch (e) {
      console.error(e);
    }
    cleanup = null;
  }
  keyHandler = null;
  const app = document.getElementById('app');
  app.classList.remove('immersive');
  const main = document.getElementById('main');
  main.replaceChildren();
  main.scrollTop = 0;
  main.className = '';
  for (const [re, view, tab] of routes) {
    const m = re.exec(path);
    if (!m) continue;
    renderTabs(tab);
    try {
      const r = view(main, m.slice(1), query);
      if (typeof r === 'function') cleanup = r;
      else if (r && typeof r.then === 'function') r.then((fn) => typeof fn === 'function' && (cleanup = fn)).catch(showError);
    } catch (e) {
      showError(e);
    }
    return;
  }
  go('#/decks', { replace: true });
}

function showError(e) {
  console.error(e);
  toast('Error: ' + (e?.message || e));
}

function renderTabs(active) {
  const nav = document.getElementById('tabs');
  nav.replaceChildren(
    ...TABS.map(([id, label, href]) => h('a', { href, class: id === active ? 'active' : '', 'aria-current': id === active ? 'page' : null }, icon(id), label))
  );
}

export function applyTheme() {
  const t = col.config.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]:not([media])')?.setAttribute('content', dark ? '#0c0c0d' : '#ffffff');
}

async function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try {
    const hadController = !!navigator.serviceWorker.controller;
    await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      toast('A new version is available', {
        action: 'Reload',
        ms: 15000,
        onAction: () => {
          reloading = true;
          location.reload();
        },
      });
    });
  } catch (e) {
    console.warn('SW registration failed', e);
  }
}

async function start() {
  try {
    await load();
  } catch (e) {
    document.getElementById('main').replaceChildren(
      h('div', { class: 'empty' }, h('h2', null, 'Storage unavailable'), h('p', null, String(e?.message || e) + '. Private browsing may block local storage.'))
    );
    return;
  }
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    applyTheme();
  });
  window.addEventListener('hashchange', () => {
    sessionStorageSet('navCount', sessionStorageGet('navCount') + 1);
    route();
  });
  document.addEventListener('keydown', (e) => {
    if (keyHandler && !e.metaKey && !e.ctrlKey && !e.altKey) keyHandler(e);
  });
  route();
  registerSW();
  if (navigator.storage?.persist) {
    navigator.storage.persisted?.().then((p) => {
      if (!p) navigator.storage.persist().catch(() => {});
    });
  }
}

start();

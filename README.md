# Flashcards

A minimal, mobile-first spaced-repetition flashcard app that runs entirely in the browser. It is compatible with Anki packages and uses no accounts or servers: everything stays on your device. You can install it on an iPhone's Home Screen and it works offline.

## Features

- **Study** with an Anki-style SM-2 scheduler: learning and relearning steps, Again / Hard / Good / Easy, interval previews, fuzz, leeches, daily limits, a configurable day rollover, and undo.
- **Decks**, including nested decks (`Parent::Child`). Each deck can override the new-card and review limits.
- **Add and edit notes** with a small rich-text editor (bold, italic, sub/superscript, images and audio from your photo library or files, cloze buttons) and tags.
- **Note types**: Basic, Basic (and reversed card), Basic (optional reversed card), Basic (type in the answer), Cloze, plus any custom note types you import or clone. You can edit fields, card templates and CSS.
- **Templates** follow Anki's syntax: `{{Field}}`, `{{#Field}}…{{/Field}}`, `{{^Field}}`, `{{FrontSide}}`, `cloze:`, `type:`, `hint:`, `text:`, `furigana:` / `kana:` / `kanji:`, and `[sound:…]`.
- **Browse** with search (`deck:`, `tag:`, `is:due|new|learn|review|suspended`, `note:`, `card:`, `flag:`, `prop:ivl>10`, `-negation`, `wild*cards`) and bulk move, suspend, tag, reset and delete.
- **Stats**: today's activity, retention, study streak, card states, a 30-day forecast and 30-day history.
- **Import**:
  - `.apkg` and `.colpkg` from Anki, both the legacy format and the newer zstd-compressed one (Anki 2.1.50+), with optional scheduling and review history, plus media.
  - Plain text, CSV and TSV, including Anki's "Notes in Plain Text" headers.
  - Backups made by this app.
- **Export**:
  - `.apkg`, which opens in Anki desktop, AnkiMobile and AnkiDroid. It can include scheduling and media.
  - Tab-separated text.
  - A full backup `.zip`.
- **Offline PWA**: a service worker caches the whole app. It has light and dark themes and safe-area support for notched iPhones.

## Install on iPhone

1. Open the GitHub Pages URL in **Safari**.
2. Tap **Share**, then **Add to Home Screen**.

Adding the app to the Home Screen also stops Safari from evicting its storage. Even so, use **Settings → Export → Backup** from time to time, because the data exists only on that device.

## Deploying

`.github/workflows/pages.yml` runs the tests on every push. On the default branch it also publishes the site to GitHub Pages.

To set this up once, go to **Settings → Pages → Build and deployment** in the repository and set **Source** to **GitHub Actions**.

There is no build step. The workflow copies the static files and stamps a version into `sw.js` and `index.html`, so each deploy refreshes the offline cache. When an update arrives, open copies of the app show a "new version" prompt.

## Development

```sh
npm start   # serves the folder at http://localhost:8080
npm test    # unit tests: scheduler, templates, text parsing, .apkg read/write
```

The tests read real `.apkg` files exported by Anki (`tests/fixtures/`).

### Layout

| Path | Purpose |
| --- | --- |
| `js/sched.js` | Scheduler (pure) |
| `js/template.js` | Anki template renderer (pure) |
| `js/apkg.js` | `.apkg` reader/writer (pure; libraries injected) |
| `js/textio.js` | CSV/TSV parsing and serialisation (pure) |
| `js/col.js` | In-memory collection persisted to IndexedDB |
| `js/queue.js` | Study queues and per-deck daily limits |
| `js/io.js` | Import and export glue |
| `js/render.js` | Sanitised card rendering in a shadow root, media and audio |
| `js/views/` | Screens |
| `vendor/` | [sql.js](https://github.com/sql-js/sql.js) 1.12.0, [fflate](https://github.com/101arrowz/fflate) 0.8.2, [fzstd](https://github.com/101arrowz/fzstd) 0.1.1 (MIT) |

Card HTML from imported decks is sanitised before display: scripts and inline event handlers are removed. Each card renders inside a shadow root so that deck CSS cannot affect the app.

# mnmltype

A quiet place to type. As you type, a side panel shows live stats: net and gross WPM, CPM, live and peak WPM, accuracy, consistency, and text counts. Everything runs in the browser. No backend, no storage, no tracking.

**Live:** https://mnmltype.web.app

Stack: Vite + TypeScript (no framework), Vitest, Playwright, Firebase Hosting. See [SPEC.md](SPEC.md) for the full spec.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest unit tests (stats engine)
npx playwright install chromium
npm run e2e        # Playwright smoke tests (builds and serves on :4173)
```

## How it measures

- Only real typing counts toward speed. Paste, drop, cut, undo and redo change the text (so word counts follow) but are ignored by WPM, CPM and corrections.
- Errors are corrections: every deleted character, including text replaced by typing over a selection.
- Active time sums the gaps between keystrokes, each capped at 2 s, so pauses don't drag WPM down.
- Speed stats appear after 3 s of active typing.

The engine (`src/engine/stats.ts`) is pure and has no DOM access. `computeStats(events, text, now)` is the entry point.

## Deploy

```sh
npm i -g firebase-tools
firebase login
firebase use <project-id>   # or edit .firebaserc (currently: mnmltype)
npm run deploy              # build + firebase deploy --only hosting
npm run deploy:preview      # deploy to a preview channel
```

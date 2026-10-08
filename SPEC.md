# Typing Stats — Implementation Spec

A single-page site with a text area. As the user types, a side panel shows live typing statistics. Static, client-side only, hosted on Firebase Hosting.

**Stack:** Vite + TypeScript (vanilla, no framework) · Firebase Hosting · Vitest · Playwright
**Visual direction:** Black and blue, very minimal and sleek, with a few smooth animations that stand out.

---

## 1. Scope

### In scope
- One page: an editor and a stats panel.
- Live stats computed in the browser. No backend, no storage, no accounts.
- Reset control.
- Responsive layout (desktop, tablet, phone).
- Deployed with Firebase Hosting.

### Out of scope
- Auth, Firestore, analytics, and saved history.
- Typing-test mode or reference text.
- Spellcheck-based errors. Errors are defined **only** by corrections (see §3.3).
- Multiple pages, routing, settings screens.

---

## 2. Project structure

```
typing-stats/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── firebase.json
├── .firebaserc              # placeholder project id
├── public/
│   └── favicon.svg          # simple blue mark on black
├── src/
│   ├── main.ts              # bootstrap, wires modules
│   ├── styles/
│   │   ├── tokens.css       # colors, type, spacing, motion tokens
│   │   ├── base.css
│   │   └── components.css
│   ├── engine/
│   │   ├── tracker.ts       # input event capture -> event log
│   │   ├── stats.ts         # PURE functions: event log + text -> Stats
│   │   └── types.ts
│   ├── ui/
│   │   ├── editor.ts
│   │   ├── panel.ts         # stat cards, render loop
│   │   ├── odometer.ts      # animated number component
│   │   ├── sparkline.ts     # WPM over time (SVG)
│   │   └── ambient.ts       # background glow driven by typing speed
│   └── util/
│       └── raf.ts           # rAF scheduler / throttling
└── tests/
    ├── stats.test.ts        # Vitest
    └── smoke.spec.ts        # Playwright
```

Rules:
- `engine/stats.ts` must be pure and have no DOM access, so it is fully unit-testable.
- No runtime dependencies except fonts. Write the animation code by hand (CSS plus small TS). Do not add GSAP, Framer, or chart libraries.

---

## 3. Stats engine

### 3.1 Event capture (`tracker.ts`)

Listen to `beforeinput` and `input` on the editor (a `<textarea>`). Use `InputEvent.inputType` to classify each event. Log each event as:

```ts
type KeyEvent = {
  t: number;            // performance.now()
  kind: 'insert' | 'delete' | 'paste' | 'cut' | 'undo' | 'redo' | 'other';
  inserted: number;     // chars added
  deleted: number;      // chars removed (includes selection replacement)
};
```

Classification:
| inputType | kind |
|---|---|
| `insertText`, `insertLineBreak`, `insertParagraph`, `insertCompositionText` (on commit) | insert |
| `deleteContentBackward`, `deleteContentForward`, `deleteWordBackward`, `deleteWordForward`, `deleteSoftLineBackward`, etc. | delete |
| `insertFromPaste`, `insertFromDrop` | paste |
| `deleteByCut`, `deleteByDrag` | cut |
| `historyUndo` / `historyRedo` | undo / redo |

- Compute `deleted` by comparing the selection range in `beforeinput` with the text length change in `input`. Typing over a selection = 1 insert event with `deleted = selection length`. Those deleted chars **count as corrections**.
- IME: count composed text only when composition ends (`compositionend`). Do not count intermediate composition updates.
- **Paste, drop, cut, undo, and redo are excluded from all speed and correction metrics.** They still change the text, so content metrics (word count etc.) still reflect them.

### 3.2 Session timing

- The session starts on the first `insert` event.
- **Active time** = the sum of the gaps between consecutive typing events (insert/delete), with each gap capped at `IDLE_CAP_MS = 2000`. This stops pauses from lowering WPM.
- **Elapsed time** = wall-clock time since the session started (display only).
- Status is **Idle** when no typing event has happened for more than 2 s. Show this subtly in the UI (see §5.4).

### 3.3 Metrics

Definitions (`typed` = sum of `inserted` across insert events; `corrected` = sum of `deleted` across delete events plus selection-replacement deletions; `activeMin` = active time in minutes):

| Metric | Definition | Display |
|---|---|---|
| **WPM (net)** | `((typed − corrected) / 5) / activeMin`, floored at 0 | Hero number, integer |
| **WPM (gross)** | `(typed / 5) / activeMin` | Secondary |
| **CPM** | `(typed − corrected) / activeMin` | Integer |
| **Live WPM** | Net WPM over a trailing 10 s window of events | Drives sparkline and ambient glow |
| **Peak WPM** | Max of Live WPM sampled every 1 s (only after ≥ 5 s of activity) | Integer |
| **Correction rate** | `corrected / typed` | Percent, 1 decimal |
| **Accuracy** | `1 − correction rate`, clamped to [0, 1] | Percent, 1 decimal |
| **Keystrokes** | Count of insert + delete events | Integer |
| **Backspaces** | Count of delete events | Integer |
| **Consistency** | `1 − (stddev / mean)` of inter-key intervals (gaps ≤ IDLE_CAP only), clamped to [0, 1], needs ≥ 20 intervals | Percent, integer |
| **Words** | `text.trim().split(/\s+/).filter(Boolean).length` | Integer |
| **Characters** | `text.length`, plus excluding whitespace | Integer / integer |
| **Sentences** | Matches of `/[^.!?]+[.!?]+/g` plus a trailing fragment if non-empty | Integer |
| **Paragraphs** | Non-empty blocks split on `\n\s*\n` | Integer |
| **Avg word length** | Mean length of word tokens with punctuation stripped | 1 decimal |
| **Unique words** | Lowercased, punctuation stripped, Set size | Integer |
| **Longest word** | Longest token (punctuation stripped) | String, truncate at 18 chars |
| **Active time** | §3.2 | `m:ss` |
| **Elapsed time** | §3.2 | `m:ss` |

Edge cases:
- Before 3 s of active time, speed metrics show `—` instead of noisy numbers.
- Division by zero always gives `—`, never `NaN` or `Infinity`.
- Use `Intl.Segmenter` (word granularity) for word counts when available, with the regex above as the fallback.

### 3.4 Output type

```ts
type Stats = {
  wpmNet: number | null; wpmGross: number | null; cpm: number | null;
  wpmLive: number | null; wpmPeak: number | null;
  correctionRate: number | null; accuracy: number | null; consistency: number | null;
  keystrokes: number; backspaces: number;
  words: number; chars: number; charsNoSpace: number;
  sentences: number; paragraphs: number;
  avgWordLen: number | null; uniqueWords: number; longestWord: string;
  activeMs: number; elapsedMs: number; idle: boolean;
  wpmSeries: number[];   // Live WPM sampled every 1 s, last 60 samples
};
```

`computeStats(events: KeyEvent[], text: string, now: number): Stats` is the single entry point.

### 3.5 Performance
- Recompute on each input event, but render at most once per animation frame (`raf.ts`).
- Content metrics that need text scans: debounce to 100 ms when text is longer than 20k characters.
- Keep the event log bounded: store running totals plus a ring buffer (last 60 s) for the windowed metrics. The full log must not grow without limit.
- Target: there must be no input latency. Typing at 150+ WPM must not cause dropped frames.

---

## 4. Layout

### Desktop (≥ 1024px)
```
┌──────────────────────────────────────────────────────────────┐
│ ● typing.stats                                     [ reset ] │  ← 56px header, very quiet
├───────────────────────────────────────────┬──────────────────┤
│                                           │   87             │  ← hero WPM
│   Start typing…                           │   WPM            │
│                                           │   ▁▂▃▅▆▇▆▅ spark │
│   (editor, fills height, max-width 72ch,  │ ──────────────── │
│    generous padding)                      │  CPM      435    │
│                                           │  Accuracy 96.2%  │
│                                           │  Peak     104    │
│                                           │  Consist. 81%    │
│                                           │ ──────────────── │
│                                           │  Words    212    │
│                                           │  Chars    1,184  │
│                                           │  …               │
├───────────────────────────────────────────┴──────────────────┤
│  0:42 active · 1:10 elapsed                         ● live   │  ← footer status line
└──────────────────────────────────────────────────────────────┘
```
- Stats panel: fixed width 320px, 1px left border, scrolls on its own if needed.
- Group stats into three sections with small uppercase labels: **Speed**, **Precision**, **Content**, plus timing in the footer.

### Tablet (640–1023px)
Panel moves under the editor as a horizontal row of cards that scrolls sideways. Hero WPM stays visible as a sticky pill in the top-right of the header.

### Phone (< 640px)
Editor is full-screen. A compact stat bar (WPM · Accuracy · Words) is pinned above the keyboard. Tap it to open a bottom sheet with all stats. Use `visualViewport` to keep it above the on-screen keyboard. 16px side gutters, no horizontal page scroll.

---

## 5. Visual design

### 5.1 Tokens (`tokens.css`)
```css
:root {
  --bg:          #05070B;   /* near-black */
  --bg-elev:     #0A0E15;   /* panel */
  --line:        #141B27;   /* hairlines */
  --text:        #E7EDF6;
  --text-dim:    #7A889C;
  --text-faint:  #3A4556;
  --blue:        #2F7BFF;   /* primary accent */
  --blue-bright: #6FA8FF;   /* highlights, glow core */
  --blue-deep:   #0B2A66;   /* glow falloff */
  --blue-glow:   rgba(47,123,255,.35);
  --warn:        #FF5A6E;   /* only for a correction-rate spike flash */

  --font-ui:   "Inter", system-ui, sans-serif;
  --font-num:  "JetBrains Mono", ui-monospace, monospace;  /* tabular numerals */
  --font-edit: "Inter", system-ui, sans-serif;

  --r: 10px;
  --ease-out: cubic-bezier(.16, 1, .3, 1);      /* expo-out, main ease */
  --ease-spring: cubic-bezier(.34, 1.56, .64, 1);
  --dur-fast: 140ms; --dur: 280ms; --dur-slow: 700ms;
}
```
- Dark only. No light theme.
- Self-host fonts with `@fontsource/inter` and `@fontsource/jetbrains-mono` (only the weights in use: 400/500/600). Do not request Google Fonts at runtime.
- All numbers use `font-variant-numeric: tabular-nums` so they do not jitter.
- Editor text: 18px/1.7, `--text`. Placeholder `--text-faint`. Caret color `--blue-bright`.
- Hero WPM: 72px, weight 500, `--text`, with a faint blue text-shadow glow.
- Labels: 11px, uppercase, letter-spacing .12em, `--text-dim`.
- No shadows except blue glows. No gradients except the ambient background and the sparkline fill.

### 5.2 Signature animations (these must look great)

1. **Odometer numbers.** Each stat value is a set of digit columns that roll vertically to the new digit (`transform: translateY`, `--dur`, `--ease-out`). Each digit staggers 20 ms from right to left. Commas and decimals stay fixed. When a value first appears (from `—`), it fades and slides in from 6px below.
2. **Ambient glow.** A large blurred radial gradient (`--blue-deep` → transparent) sits behind the editor near the bottom-left. Its opacity (0.15 → 0.6) and scale (1 → 1.25) follow Live WPM, smoothed with a critically damped spring (no jumps). When idle, it slowly "breathes" (opacity ±0.05, 6 s cycle).
3. **Hero WPM pulse.** On each new 1 s sample where Live WPM rises, a thin `--blue` ring grows out from behind the hero number and fades (scale 0.9 → 1.4, opacity .5 → 0, 600 ms). Limit to once per second.
4. **Live sparkline.** An SVG path of `wpmSeries` with a 1.5px `--blue-bright` stroke and a vertical gradient fill (`--blue-glow` → transparent). New points slide in from the right, and the path reshapes smoothly. Interpolate between samples in rAF rather than replacing the path. A small glowing dot marks the latest point.
5. **Load sequence.** (~900 ms total, once.) Header fades in → editor border draws itself (stroke-dashoffset) → stat rows stagger in (40 ms each, 8px rise, fade) → caret starts blinking and the editor is focused.
6. **Caret focus line.** When the editor is focused, a 1px `--blue` line under the header grows from the center out to full width (`scaleX` 0 → 1). When focus leaves, it collapses back.
7. **Reset.** The text fades out with a slight blur (200 ms). All odometers roll down to `—`. The sparkline flattens to the baseline. The glow fades to idle. Then the editor refocuses.
8. **Correction flash.** If the correction rate over the last 10 s goes above 15%, the Accuracy value tints `--warn` for 400 ms, then eases back. This is subtle, and the only non-blue color.

Motion rules:
- Animate only `transform`, `opacity`, and `filter`. Never animate layout properties.
- Respect `prefers-reduced-motion: reduce`: no odometer roll (instant swap with a 120 ms crossfade), glow fixed at low opacity, no pulse ring, sparkline updates without interpolation.
- No animation may block or delay input.

### 5.3 Editor
- Native `<textarea>` (keeps undo, IME, accessibility, mobile keyboards). No border at rest. A focus state is shown only through animation #6.
- `spellcheck="false"`, `autocorrect="off"`, `autocapitalize="off"` (autocorrect would distort metrics).
- Placeholder: `Start typing…`
- Autofocus on load (after the load sequence).

### 5.4 Header and footer
- Header: small wordmark `typing.stats` (the dot is `--blue`). Ghost **Reset** button on the right (`--text-dim`, hover → `--text`, with a 1px `--line` border that turns `--blue` on hover).
- Footer: `0:42 active · 1:10 elapsed` on the left. Status on the right: a 6px dot that is `--blue` with a soft pulse while typing, or `--text-faint` with the text `idle` when idle.

---

## 6. Interaction and accessibility
- **Esc** (when the editor is focused) or the Reset button → reset. If the text is longer than 200 characters, the button needs a second click within 3 s to confirm (the label changes to `Confirm`). Do not use browser dialogs.
- Stats panel is `aria-live="polite"` with a summary sentence updated at most every 5 s. Do **not** announce every digit change. Odometer digit columns are `aria-hidden`, and each stat has a visually hidden real value.
- Contrast: all text meets WCAG AA against `--bg`.
- Fully usable with the keyboard. Focus rings are visible (2px `--blue` outline offset 2px) on the button and on the bottom-sheet toggle.

---

## 7. Firebase Hosting

`firebase.json`:
```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "cleanUrls": true,
    "headers": [
      { "source": "/assets/**", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
      { "source": "/index.html", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
      { "source": "**", "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Content-Security-Policy", "value": "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; script-src 'self'" }
      ]}
    ]
  }
}
```
`.firebaserc`: `{ "projects": { "default": "REPLACE_WITH_PROJECT_ID" } }`

npm scripts:
```json
{
  "dev": "vite",
  "build": "tsc --noEmit && vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "e2e": "playwright test",
  "deploy": "npm run build && firebase deploy --only hosting",
  "deploy:preview": "npm run build && firebase hosting:channel:deploy preview"
}
```
Do not add the Firebase JS SDK, because Hosting does not need it. Add a README section on deployment: `npm i -g firebase-tools`, `firebase login`, set the project ID, `npm run deploy`.

---

## 8. Testing

**Vitest (`stats.test.ts`), required cases:**
- 250 chars typed over exactly 60 s active, no deletes → net WPM 50, CPM 250, accuracy 100%.
- 300 typed, 30 corrected, 60 s → net WPM 54, gross 60, correction rate 10.0%.
- A 30 s pause in the middle of typing adds only 2 s (IDLE_CAP) to active time.
- Paste of 1,000 chars → words update, WPM/CPM/correction unchanged.
- Selection replace (select 5 chars, type 1) → corrected += 5, typed += 1.
- Empty or whitespace text → words 0, sentences 0, paragraphs 0, speed metrics null.
- Under 3 s active → speed metrics null.
- Consistency null with < 20 intervals. Perfectly even intervals → 100%.
- Sentence/paragraph/unique-word/longest-word counts on fixture text.

**Playwright (`smoke.spec.ts`):**
- Page loads, the editor is focused, and the stats show `—`.
- Type a fixed string with a key delay → words/chars are correct and WPM is non-null after 3 s.
- Press Backspace ×3 → backspaces = 3 and accuracy < 100%.
- Reset → editor is empty and the stats return to `—`.
- Viewport 375×812 → no horizontal scroll and the compact stat bar is visible.
- Emulate reduced motion → no console errors and the stats still update.

---

## 9. Acceptance criteria
- [ ] `npm run build` is clean with TS `strict: true` and no warnings.
- [ ] All Vitest and Playwright tests pass.
- [ ] Lighthouse (mobile): Performance ≥ 95, Accessibility ≥ 95, Best Practices 100.
- [ ] JS bundle ≤ 25 KB gzipped (excluding fonts).
- [ ] No dropped frames while typing quickly (Chrome Performance panel, 6× CPU throttle: input-to-paint < 16 ms).
- [ ] All 8 animations in §5.2 are implemented, and all respect reduced motion.
- [ ] Deploys with `npm run deploy` to Firebase Hosting, and the cache headers can be seen in the response.
- [ ] There are no external network requests at runtime.

## 10. Build order for the implementer
1. Scaffold Vite + TS, tokens, base layout (static).
2. `stats.ts` + Vitest suite (TDD).
3. `tracker.ts` → wire to the editor → plain-text stats rendering.
4. Odometer, sparkline, ambient glow, then the remaining animations.
5. Responsive layouts and the phone bottom sheet.
6. Accessibility pass, reduced-motion pass.
7. Playwright, Lighthouse, bundle check.
8. Firebase config + README + deploy.

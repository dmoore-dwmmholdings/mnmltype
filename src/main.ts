import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

import { appendEvent, computeContent, createLog, speedFromLog } from './engine/stats';
import { createTracker } from './engine/tracker';
import type { ContentStats, Stats } from './engine/types';
import { Ambient } from './ui/ambient';
import { bindFocusLine, clearEditor } from './ui/editor';
import { Panel } from './ui/panel';
import { animationLoop, debounce, frameScheduler, reducedMotion } from './util/raf';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const app = $('.app');
const editor = $<HTMLTextAreaElement>('#editor');
const resetBtn = $<HTMLButtonElement>('#reset');
const panelEl = $('#panel');
const bar = $<HTMLButtonElement>('#bar');
const scrim = $('#scrim');
const notice = $('#notice');
const sheetClose = $<HTMLButtonElement>('#sheet-close');
const status = $('#status');
const statusText = status.querySelector('.status-t')!;
const activeEls = document.querySelectorAll('.t-active');
const elapsedEls = document.querySelectorAll('.t-elapsed');

const panel = new Panel($('#panel-body'), $('#summary'), { pill: $('.pill'), bar });
const ambient = new Ambient($('.ambient'));

const LARGE_TEXT = 20_000;
const ANNOUNCE_MS = 5000;

let log = createLog();
let content: ContentStats = computeContent('');
let contentDirty = false;
let lastAnnounce = -Infinity;
let lastClock = '';

// ---- Render ----------------------------------------------------------------

const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const animate = animationLoop((dt, now) => {
  const a = panel.spark.step(dt, now);
  const b = ambient.step(dt);
  return a || b;
});

function render(now: number): void {
  if (contentDirty) {
    content = computeContent(editor.value);
    contentDirty = false;
  }
  const stats: Stats = { ...speedFromLog(log, now), ...content };
  panel.update(stats);

  if (panel.spark.update(stats.wpmSeries, stats.sampleCount, now)) {
    const n = stats.wpmSeries.length;
    if (n >= 2 && stats.wpmLive !== null && stats.wpmSeries[n - 1]! > stats.wpmSeries[n - 2]! + 0.5) panel.pulse();
  }
  ambient.setWpm(stats.wpmLive, stats.idle);
  animate();

  const clock = `${fmtTime(stats.activeMs)}|${fmtTime(stats.elapsedMs)}`;
  if (clock !== lastClock) {
    lastClock = clock;
    const [a, e] = clock.split('|');
    activeEls.forEach((el) => (el.textContent = a!));
    elapsedEls.forEach((el) => (el.textContent = e!));
  }
  const live = !stats.idle;
  if (status.classList.contains('is-live') !== live) {
    status.classList.toggle('is-live', live);
    app.classList.toggle('is-live', live);
    statusText.textContent = live ? 'live' : 'idle';
  }

  if (now - lastAnnounce >= ANNOUNCE_MS) {
    lastAnnounce = now;
    panel.announce(stats);
  }
}

const schedule = frameScheduler(render);

// ---- Input -----------------------------------------------------------------

const tracker = createTracker(editor, (ev) => {
  appendEvent(log, ev);
  schedule();
});

const refreshLarge = debounce(() => {
  contentDirty = true;
  schedule();
}, 100);

editor.addEventListener('input', () => {
  if (editor.value.length > LARGE_TEXT) {
    refreshLarge();
  } else {
    refreshLarge.cancel();
    contentDirty = true;
    schedule();
  }
});

setInterval(schedule, 250);
bindFocusLine(editor, app);

// ---- Reset -----------------------------------------------------------------

let armed = false;
let armTimer: ReturnType<typeof setTimeout> | undefined;
let clearing = false;

function disarm(): void {
  armed = false;
  clearTimeout(armTimer);
  resetBtn.textContent = 'Reset';
  resetBtn.classList.remove('is-confirm');
  notice.textContent = '';
}

function requestReset(): void {
  if (clearing) return;
  if (editor.value.length > 200 && !armed) {
    armed = true;
    resetBtn.textContent = 'Confirm';
    resetBtn.classList.add('is-confirm');
    notice.textContent = 'Press Reset or Escape again within 3 seconds to clear the text.';
    armTimer = setTimeout(disarm, 3000);
    return;
  }
  disarm();
  clearing = true;
  const snapshot = editor.value;
  editor.classList.add('is-clearing');
  setTimeout(
    () => {
      // Keep anything typed during the fade-out.
      const upTo = editor.value.startsWith(snapshot) ? snapshot.length : editor.value.length;
      tracker.suppress(() => clearEditor(editor, upTo));
      contentDirty = editor.value !== '';
      editor.classList.remove('is-clearing');
      log = createLog();
      content = computeContent('');
      lastAnnounce = -Infinity;
      panel.spark.flatten();
      setTimeout(() => {
        if (log.start === null) panel.spark.clear();
      }, 700);
      clearing = false;
      schedule();
      editor.focus({ preventScroll: true });
    },
    reducedMotion() ? 0 : 200,
  );
}

// Keep the editor focused on mouse clicks so the focus line doesn't collapse.
resetBtn.addEventListener('pointerdown', (e) => e.preventDefault());
resetBtn.addEventListener('click', requestReset);
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !e.isComposing) {
    e.preventDefault();
    requestReset();
  }
});

// ---- Phone: compact bar + bottom sheet -------------------------------------

function setSheet(open: boolean): void {
  panelEl.classList.toggle('is-open', open);
  if (open) {
    panelEl.setAttribute('role', 'dialog');
    panelEl.setAttribute('aria-modal', 'true');
    panelEl.setAttribute('aria-labelledby', 'sheet-title');
  } else {
    panelEl.removeAttribute('role');
    panelEl.removeAttribute('aria-modal');
    panelEl.removeAttribute('aria-labelledby');
  }
  for (const el of document.querySelectorAll<HTMLElement>('.hdr, .editor-wrap, .ftr, #bar')) el.inert = open;
  scrim.classList.toggle('is-open', open);
  bar.setAttribute('aria-expanded', String(open));
  if (open) sheetClose.focus({ preventScroll: true });
}

bar.addEventListener('click', () => setSheet(true));
sheetClose.addEventListener('click', () => {
  setSheet(false);
  bar.focus({ preventScroll: true });
});
scrim.addEventListener('click', () => setSheet(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && panelEl.classList.contains('is-open')) {
    setSheet(false);
    bar.focus({ preventScroll: true });
  }
});
matchMedia('(max-width: 639px)').addEventListener('change', (e) => {
  if (!e.matches) setSheet(false);
});

// Keep the bar above the on-screen keyboard.
const vv = window.visualViewport;
if (vv) {
  const place = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    bar.style.setProperty('--kb', `${Math.round(kb)}px`);
  };
  vv.addEventListener('resize', place);
  vv.addEventListener('scroll', place);
  place();
}

// ---- Load sequence: focus once the intro has played (#5) -------------------

schedule();
setTimeout(() => editor.focus({ preventScroll: true }), reducedMotion() ? 0 : 900);

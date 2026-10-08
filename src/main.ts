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
import { BlockCaret } from './ui/caret';
import { bindFocusLine, clearEditor } from './ui/editor';
import { fmtTime, Panel } from './ui/panel';
import { animationLoop, debounce, frameScheduler, reducedMotion } from './util/raf';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const app = $('.app');
const editor = $<HTMLTextAreaElement>('#editor');
const statusline = $('#statusline');
const drawer = $('#panel');
const statsToggle = $<HTMLButtonElement>('#stats-toggle');
const widthToggle = $<HTMLButtonElement>('#width-toggle');
const widthMenu = $('#width-menu');
const widthLabel = $('#width-label');
const resetBtns = document.querySelectorAll<HTMLButtonElement>('[data-reset]');
const scrim = $('#scrim');
const notice = $('#notice');
const sheetClose = $<HTMLButtonElement>('#sheet-close');
const status = $('#status');
const statusText = status.querySelector('.status-t')!;
const activeEls = document.querySelectorAll('.t-active');
const elapsedEls = document.querySelectorAll('.t-elapsed');

const panel = new Panel($('#panel-body'), statusline, $('#summary'));
const ambient = new Ambient($('.ambient'));
const caret = new BlockCaret(editor, $('.caret'));
const phone = matchMedia('(max-width: 639px)');

const LARGE_TEXT = 20_000;
const ANNOUNCE_MS = 5000;

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(`mnmltype.${k}`);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(`mnmltype.${k}`, v);
    } catch {
      /* storage unavailable: preference just isn't remembered */
    }
  },
};

let log = createLog();
let content: ContentStats = computeContent('');
let contentDirty = false;
let lastAnnounce = -Infinity;
let lastClock = '';

// ---- Render ----------------------------------------------------------------

const animate = animationLoop((dt, now) => {
  const a = panel.spark.step(dt, now);
  const b = panel.miniSpark.step(dt, now);
  const c = ambient.step(dt);
  return a || b || c;
});

function render(now: number): void {
  if (contentDirty) {
    content = computeContent(editor.value);
    contentDirty = false;
  }
  const stats: Stats = { ...speedFromLog(log, now), ...content };
  panel.update(stats);

  panel.miniSpark.update(stats.wpmSeries, stats.sampleCount, now);
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

// Mouse clicks on statusline controls keep the editor focused (keyboard focus still works).
statusline.addEventListener('pointerdown', (e) => {
  if (!phone.matches && (e.target as Element).closest('button')) e.preventDefault();
});

// ---- Reset -----------------------------------------------------------------

let armed = false;
let armTimer: ReturnType<typeof setTimeout> | undefined;
let clearing = false;

function setResetLabel(confirm: boolean): void {
  for (const b of resetBtns) {
    b.textContent = confirm ? 'confirm' : 'reset';
    b.classList.toggle('is-confirm', confirm);
  }
}

function disarm(): void {
  armed = false;
  clearTimeout(armTimer);
  setResetLabel(false);
  notice.textContent = '';
}

function requestReset(): void {
  if (clearing) return;
  if (editor.value.length > 200 && !armed) {
    armed = true;
    setResetLabel(true);
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
      panel.miniSpark.flatten();
      setTimeout(() => {
        if (log.start === null) {
          panel.spark.clear();
          panel.miniSpark.clear();
        }
      }, 700);
      clearing = false;
      schedule();
      caret.schedule();
      if (!drawer.classList.contains('is-sheet-open')) editor.focus({ preventScroll: true });
    },
    reducedMotion() ? 0 : 200,
  );
}

for (const b of resetBtns) b.addEventListener('click', requestReset);
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !e.isComposing) {
    e.preventDefault();
    if (!widthMenu.hasAttribute('hidden')) return; // Esc closes the menu instead
    requestReset();
  }
});

// ---- Column width ----------------------------------------------------------

const WIDTHS = ['full', 'wide', 'narrow'] as const;
type Width = (typeof WIDTHS)[number];

function setWidth(w: Width, animateChange = true): void {
  app.dataset.width = w;
  widthLabel.textContent = w;
  for (const b of widthMenu.querySelectorAll<HTMLButtonElement>('[data-w]')) {
    b.setAttribute('aria-pressed', String(b.dataset.w === w));
  }
  store.set('width', w);
  if (animateChange && !reducedMotion()) {
    editor.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 280, easing: 'ease-out' });
  }
}

function setMenu(open: boolean, focusToggle = false, focusItem = true): void {
  widthMenu.hidden = !open;
  widthToggle.setAttribute('aria-expanded', String(open));
  if (open) {
    if (focusItem) widthMenu.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
    if (!reducedMotion()) {
      widthMenu.animate(
        [
          { opacity: 0, transform: 'translateY(6px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 220, easing: 'cubic-bezier(.16, 1, .3, 1)' },
      );
    }
  } else if (focusToggle) {
    widthToggle.focus({ preventScroll: true });
  }
}

// Move focus into the menu only when it was opened from the keyboard (click detail 0).
widthToggle.addEventListener('click', (e) => setMenu(widthMenu.hasAttribute('hidden'), false, e.detail === 0));
widthMenu.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('[data-w]');
  if (!b) return;
  setWidth(b.dataset.w as Width);
  setMenu(false);
  editor.focus({ preventScroll: true });
});
widthMenu.addEventListener('keydown', (e) => {
  const items = [...widthMenu.querySelectorAll<HTMLButtonElement>('[data-w]')];
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  }
});
document.addEventListener('pointerdown', (e) => {
  if (!widthMenu.hidden && !(e.target as Element).closest('.sl-menu-wrap')) setMenu(false);
});

const saved = store.get('width');
setWidth(WIDTHS.includes(saved as Width) ? (saved as Width) : 'full', false);

// ---- Stats drawer (desktop/tablet) and bottom sheet (phone) ----------------

let sheetTimer: ReturnType<typeof setTimeout> | undefined;

function setDrawer(open: boolean, opts: { focus?: boolean; remember?: boolean } = {}): void {
  clearTimeout(sheetTimer);
  statsToggle.setAttribute('aria-expanded', String(open));

  if (phone.matches) {
    for (const el of document.querySelectorAll<HTMLElement>('.main, .sl')) el.inert = open;
    scrim.classList.toggle('is-open', open);
    if (open) {
      drawer.setAttribute('role', 'dialog');
      drawer.setAttribute('aria-modal', 'true');
      drawer.setAttribute('aria-labelledby', 'sheet-title');
      drawer.hidden = false;
      requestAnimationFrame(() => requestAnimationFrame(() => drawer.classList.add('is-sheet-open')));
      sheetClose.focus({ preventScroll: true });
    } else {
      drawer.removeAttribute('role');
      drawer.removeAttribute('aria-modal');
      drawer.removeAttribute('aria-labelledby');
      drawer.classList.remove('is-sheet-open');
      sheetTimer = setTimeout(() => (drawer.hidden = true), reducedMotion() ? 0 : 420);
      if (opts.focus !== false) statsToggle.focus({ preventScroll: true });
    }
    return;
  }

  drawer.hidden = !open;
  if (open) panel.reveal();
  if (opts.remember !== false) store.set('drawer', open ? '1' : '0');
  caret.schedule();
}

statsToggle.addEventListener('click', () => setDrawer(drawer.hasAttribute('hidden')));
sheetClose.addEventListener('click', () => setDrawer(false));
scrim.addEventListener('click', () => setDrawer(false));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!widthMenu.hidden) {
    e.preventDefault();
    setMenu(false, true);
  } else if (phone.matches && !drawer.hidden) {
    e.preventDefault();
    setDrawer(false);
  }
});
phone.addEventListener('change', () => {
  for (const el of document.querySelectorAll<HTMLElement>('.main, .sl')) el.inert = false;
  scrim.classList.remove('is-open');
  drawer.classList.remove('is-sheet-open');
  drawer.removeAttribute('role');
  drawer.removeAttribute('aria-modal');
  const open = !phone.matches && store.get('drawer') === '1';
  drawer.hidden = !open;
  statsToggle.setAttribute('aria-expanded', String(open));
});
if (!phone.matches && store.get('drawer') === '1') setDrawer(true, { remember: false });

// Keep the statusline above the on-screen keyboard.
const vv = window.visualViewport;
if (vv) {
  const place = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    statusline.style.setProperty('--kb', `${Math.round(kb)}px`);
  };
  vv.addEventListener('resize', place);
  vv.addEventListener('scroll', place);
  place();
}

// ---- Load sequence: focus once the intro has played (#5) -------------------

schedule();
setTimeout(() => editor.focus({ preventScroll: true }), reducedMotion() ? 0 : 900);

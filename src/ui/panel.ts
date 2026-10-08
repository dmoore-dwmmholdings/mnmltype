// Stats: statusline segments plus the full-width drawer. Updates odometers,
// runs the pulse and correction-flash effects.
import type { Stats } from '../engine/types';
import { reducedMotion } from '../util/raf';
import { DASH, Odometer } from './odometer';
import { Sparkline } from './sparkline';

const nf = new Intl.NumberFormat('en-US');
const int = (x: number | null) => (x === null ? DASH : nf.format(Math.round(x)));
const pct1 = (x: number | null) => (x === null ? DASH : `${(x * 100).toFixed(1)}%`);
const pct0 = (x: number | null) => (x === null ? DASH : `${Math.round(x * 100)}%`);
const dec1 = (x: number | null) => (x === null ? DASH : x.toFixed(1));
const truncate = (s: string, n = 18) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

type Row = { key: string; label: string; fmt: (s: Stats) => string; text?: boolean };
type Group = { id: string; title: string; rows: Row[] };

/** Drawer columns, each holding one or more titled groups. */
const COLUMNS: Group[][] = [
  [
    {
      id: 'speed',
      title: 'Speed',
      rows: [
        { key: 'gross', label: 'Gross WPM', fmt: (s) => int(s.wpmGross) },
        { key: 'live', label: 'Live WPM', fmt: (s) => int(s.wpmLive) },
        { key: 'peak', label: 'Peak WPM', fmt: (s) => int(s.wpmPeak) },
        { key: 'cpm', label: 'CPM', fmt: (s) => int(s.cpm) },
      ],
    },
  ],
  [
    {
      id: 'precision',
      title: 'Precision',
      rows: [
        { key: 'accuracy', label: 'Accuracy', fmt: (s) => pct1(s.accuracy) },
        { key: 'corrections', label: 'Correction rate', fmt: (s) => pct1(s.correctionRate) },
        { key: 'consistency', label: 'Consistency', fmt: (s) => pct0(s.consistency) },
        { key: 'keystrokes', label: 'Keystrokes', fmt: (s) => int(s.keystrokes) },
        { key: 'backspaces', label: 'Backspaces', fmt: (s) => int(s.backspaces) },
      ],
    },
  ],
  [
    {
      id: 'content',
      title: 'Content',
      rows: [
        { key: 'words', label: 'Words', fmt: (s) => int(s.words) },
        { key: 'chars', label: 'Characters', fmt: (s) => int(s.chars) },
        { key: 'charsNoSpace', label: 'Without spaces', fmt: (s) => int(s.charsNoSpace) },
        { key: 'sentences', label: 'Sentences', fmt: (s) => int(s.sentences) },
        { key: 'paragraphs', label: 'Paragraphs', fmt: (s) => int(s.paragraphs) },
      ],
    },
  ],
  [
    {
      id: 'vocab',
      title: 'Vocabulary',
      rows: [
        { key: 'uniqueWords', label: 'Unique words', fmt: (s) => int(s.uniqueWords) },
        { key: 'avgWordLen', label: 'Avg word length', fmt: (s) => dec1(s.avgWordLen) },
        { key: 'longest', label: 'Longest word', fmt: (s) => (s.longestWord ? truncate(s.longestWord) : DASH), text: true },
      ],
    },
    {
      id: 'time',
      title: 'Time',
      rows: [
        { key: 'active', label: 'Active', fmt: (s) => (s.keystrokes ? fmtTime(s.activeMs) : DASH) },
        { key: 'elapsed', label: 'Elapsed', fmt: (s) => (s.keystrokes ? fmtTime(s.elapsedMs) : DASH) },
      ],
    },
  ],
];

type Bound = { fmt: (s: Stats) => string; set: (v: string) => void; sr: HTMLElement; label: string; last: string };

const srText = (label: string, v: string) => {
  const val = v === DASH ? 'not available' : v;
  return label ? `${label}: ${val}` : val;
};

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
};

/** A text value that crossfades on change (used for the longest word). */
function textSwap(): { el: HTMLElement; set: (v: string) => void } {
  const el = h('span', 'swap');
  el.setAttribute('aria-hidden', 'true');
  el.textContent = DASH;
  return {
    el,
    set(v) {
      el.textContent = v;
      if (!reducedMotion()) el.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 200 });
    },
  };
}

export class Panel {
  readonly spark = new Sparkline({ width: 600, height: 72, padTop: 8, fluid: true });
  readonly miniSpark = new Sparkline({ width: 96, height: 18, padTop: 2, dotRoom: 4, className: 'spark-mini' });
  private bound: Bound[] = [];
  private ring!: HTMLElement;
  private wpmSeg: HTMLElement;
  private flashTargets: HTMLElement[] = [];
  private warnActive = false;
  private flashTimer: ReturnType<typeof setTimeout> | undefined;
  private cols: HTMLElement[] = [];

  constructor(
    root: HTMLElement,
    statusline: HTMLElement,
    private summary: HTMLElement,
  ) {
    for (const groups of COLUMNS) {
      const col = h('div', `col col-${groups[0]!.id}`);
      for (const g of groups) {
        const sec = h('section', `grp grp-${g.id}`);
        sec.setAttribute('aria-labelledby', `h-${g.id}`);
        const title = h('h3', 'label grp-title', g.title);
        title.id = `h-${g.id}`;
        sec.append(title);

        if (g.id === 'speed') {
          const hero = h('div', 'hero');
          const num = h('div', 'hero-num');
          this.ring = h('span', 'hero-ring');
          this.ring.setAttribute('aria-hidden', 'true');
          num.append(this.ring);
          const unit = h('span', 'hero-unit', 'wpm');
          unit.setAttribute('aria-hidden', 'true');
          const heroNum = h('div', 'hero-main');
          heroNum.append(num, unit);
          hero.append(heroNum);
          this.bindOdo(num, (s) => int(s.wpmNet), 'Net words per minute');
          sec.append(hero, this.spark.el);
        }

        // Speed's secondary values sit inline beside the hero number.
        const dl = h('dl', g.id === 'speed' ? 'rows rows-inline' : 'rows');
        for (const row of g.rows) {
          const r = h('div', `row row-${row.key}`);
          const dd = h('dd', 'row-v');
          r.append(h('dt', 'row-k', row.label), dd);
          dl.append(r);
          // The <dt> already names the value, so the hidden text holds only the value.
          if (row.text) this.bindText(dd, row.fmt);
          else this.bindOdo(dd, row.fmt, '');
          if (row.key === 'accuracy') this.flashTargets.push(dd);
        }
        if (g.id === 'speed') sec.querySelector('.hero')!.append(dl);
        else sec.append(dl);
        col.append(sec);
      }
      this.cols.push(col);
      root.append(col);
    }

    // Statusline segments.
    const v = (sel: string) => statusline.querySelector<HTMLElement>(`${sel} .sl-v`)!;
    this.wpmSeg = statusline.querySelector<HTMLElement>('.sl-wpm')!;
    this.bindOdo(v('.sl-wpm'), (s) => int(s.wpmNet), 'Net words per minute');
    this.bindOdo(v('.sl-acc'), (s) => pct1(s.accuracy), 'Accuracy');
    this.bindOdo(v('.sl-words'), (s) => int(s.words), 'Words');
    this.flashTargets.push(v('.sl-acc'));
    statusline.querySelector('.sl-spark')!.append(this.miniSpark.el);
  }

  private bindOdo(host: HTMLElement, fmt: (s: Stats) => string, label: string): void {
    const odo = new Odometer();
    const sr = h('span', 'sr-only', srText(label, DASH));
    host.append(odo.el, sr);
    this.bound.push({ fmt, set: (v) => odo.set(v), sr, label, last: DASH });
  }

  private bindText(host: HTMLElement, fmt: (s: Stats) => string): void {
    const t = textSwap();
    const sr = h('span', 'sr-only', srText('', DASH));
    host.append(t.el, sr);
    this.bound.push({ fmt, set: t.set, sr, label: '', last: DASH });
  }

  update(s: Stats): void {
    // Nothing typed and no text: every value reads as a dash.
    const empty = s.keystrokes === 0 && s.chars === 0;
    for (const b of this.bound) {
      const v = empty ? DASH : b.fmt(s);
      if (v === b.last) continue;
      b.last = v;
      b.set(v);
      b.sr.textContent = srText(b.label, v);
    }

    const warn = s.recentCorrectionRate !== null && s.recentCorrectionRate > 0.15;
    if (warn && !this.warnActive) this.flash();
    this.warnActive = warn;
  }

  /** Accuracy tints --warn for 400 ms, then eases back. */
  private flash(): void {
    clearTimeout(this.flashTimer);
    for (const el of this.flashTargets) el.classList.add('is-warn');
    this.flashTimer = setTimeout(() => {
      for (const el of this.flashTargets) el.classList.remove('is-warn');
    }, 400);
  }

  /** Live WPM rose: a ring grows out of the hero number and the WPM segment glows. */
  pulse(): void {
    if (reducedMotion()) return;
    const easing = 'cubic-bezier(.16, 1, .3, 1)';
    this.ring.animate(
      [
        { transform: 'translate(-50%, -50%) scale(.9)', opacity: 0.5 },
        { transform: 'translate(-50%, -50%) scale(1.4)', opacity: 0 },
      ],
      { duration: 600, easing },
    );
    this.wpmSeg.querySelector('.sl-glow')?.remove();
    const glow = h('span', 'sl-glow');
    this.wpmSeg.prepend(glow);
    glow.animate([{ opacity: 0.6 }, { opacity: 0 }], { duration: 600, easing }).finished.then(
      () => glow.remove(),
      () => glow.remove(),
    );
  }

  /** Stagger the drawer columns in when it opens. */
  reveal(): void {
    if (reducedMotion()) return;
    this.cols.forEach((col, i) =>
      col.animate(
        [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 420, delay: i * 40, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'backwards' },
      ),
    );
  }

  /** Summary sentence for the polite live region. Caller throttles to 5 s. */
  announce(s: Stats): void {
    if (s.words === 0) return;
    const parts: string[] = [];
    if (s.wpmNet !== null) parts.push(`${Math.round(s.wpmNet)} words per minute`);
    if (s.accuracy !== null) parts.push(`accuracy ${(s.accuracy * 100).toFixed(1)} percent`);
    parts.push(`${s.words} ${s.words === 1 ? 'word' : 'words'}`);
    const text = parts.join(', ') + '.';
    if (this.summary.textContent !== text) this.summary.textContent = text;
  }
}

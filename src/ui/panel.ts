// Stats panel: builds stat rows, updates odometers, handles pulse and flash effects.
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

type Row = { key: string; label: string; fmt: (s: Stats) => string; text?: boolean };
type Section = { id: string; title: string; rows: Row[] };

const SECTIONS: Section[] = [
  {
    id: 'speed',
    title: 'Speed',
    rows: [
      { key: 'cpm', label: 'CPM', fmt: (s) => int(s.cpm) },
      { key: 'peak', label: 'Peak WPM', fmt: (s) => int(s.wpmPeak) },
    ],
  },
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
  {
    id: 'content',
    title: 'Content',
    rows: [
      { key: 'words', label: 'Words', fmt: (s) => int(s.words) },
      { key: 'chars', label: 'Characters', fmt: (s) => int(s.chars) },
      { key: 'charsNoSpace', label: 'Without spaces', fmt: (s) => int(s.charsNoSpace) },
      { key: 'sentences', label: 'Sentences', fmt: (s) => int(s.sentences) },
      { key: 'paragraphs', label: 'Paragraphs', fmt: (s) => int(s.paragraphs) },
      { key: 'avgWordLen', label: 'Avg word length', fmt: (s) => dec1(s.avgWordLen) },
      { key: 'uniqueWords', label: 'Unique words', fmt: (s) => int(s.uniqueWords) },
      { key: 'longest', label: 'Longest word', fmt: (s) => (s.longestWord ? truncate(s.longestWord) : DASH), text: true },
    ],
  },
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
  readonly spark = new Sparkline();
  private bound: Bound[] = [];
  private ring!: HTMLElement;
  private flashTargets: HTMLElement[] = [];
  private warnActive = false;
  private flashTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    root: HTMLElement,
    private summary: HTMLElement,
    extras: { pill: HTMLElement; bar: HTMLElement },
  ) {
    let i = 0;
    const stagger = (el: HTMLElement) => el.style.setProperty('--i', String(i++));

    const speed = SECTIONS[0]!;
    const secEls: HTMLElement[] = [];
    for (const sec of SECTIONS) {
      const el = h('section', `sec sec-${sec.id}`);
      el.setAttribute('aria-labelledby', `h-${sec.id}`);
      const title = h('h2', 'label sec-title', sec.title);
      title.id = `h-${sec.id}`;
      stagger(title);
      title.classList.add('rise');
      el.append(title);

      if (sec === speed) {
        const hero = h('div', 'hero rise');
        stagger(hero);
        this.ring = h('span', 'hero-ring');
        this.ring.setAttribute('aria-hidden', 'true');
        const num = h('div', 'hero-num');
        const meta = h('div', 'hero-meta');
        const wpmK = h('span', 'label', 'WPM');
        wpmK.setAttribute('aria-hidden', 'true');
        meta.append(wpmK);
        const gross = h('span', 'hero-gross');
        const grossK = h('span', 'hero-gross-k', 'gross ');
        grossK.setAttribute('aria-hidden', 'true');
        gross.append(grossK);
        meta.append(gross);
        num.append(this.ring);
        hero.append(num, meta);
        this.bindOdo(num, 'hero', (s) => int(s.wpmNet), 'Net words per minute');
        this.bindOdo(gross, '', (s) => int(s.wpmGross), 'Gross words per minute');

        const sparkWrap = h('div', 'spark-wrap rise');
        stagger(sparkWrap);
        const cap = h('div', 'spark-cap');
        const capK = h('span', 'spark-k', 'live');
        capK.setAttribute('aria-hidden', 'true');
        const liveVal = h('span', 'spark-live');
        cap.append(capK, liveVal);
        this.bindOdo(liveVal, '', (s) => int(s.wpmLive), 'Live words per minute');
        sparkWrap.append(this.spark.el, cap);
        el.append(hero, sparkWrap);
      }

      const dl = h('dl', 'rows');
      for (const row of sec.rows) {
        const r = h('div', `row rise row-${row.key}`);
        stagger(r);
        const dd = h('dd', 'row-v');
        r.append(h('dt', 'row-k', row.label), dd);
        dl.append(r);
        // The <dt> already names the value, so the hidden text holds only the value.
        if (row.text) this.bindText(dd, row.fmt, '');
        else this.bindOdo(dd, '', row.fmt, '');
        if (row.key === 'accuracy') this.flashTargets.push(dd);
      }
      el.append(dl);
      secEls.push(el);
    }
    root.append(...secEls);

    // Header pill (tablet) and compact bar (phone).
    this.bindOdo(extras.pill.querySelector('.pill-v')!, '', (s) => int(s.wpmNet), 'Net words per minute');
    const barSlots = extras.bar.querySelectorAll<HTMLElement>('.bar-v');
    this.bindOdo(barSlots[0]!, '', (s) => int(s.wpmNet), 'Net words per minute');
    this.bindOdo(barSlots[1]!, '', (s) => pct1(s.accuracy), 'Accuracy');
    this.bindOdo(barSlots[2]!, '', (s) => int(s.words), 'Words');
    this.flashTargets.push(barSlots[1]!);
  }

  private bindOdo(host: HTMLElement, cls: string, fmt: (s: Stats) => string, label: string): Odometer {
    const odo = new Odometer(cls);
    const sr = h('span', 'sr-only', srText(label, DASH));
    host.append(odo.el, sr);
    this.bound.push({ fmt, set: (v) => odo.set(v), sr, label, last: DASH });
    return odo;
  }

  private bindText(host: HTMLElement, fmt: (s: Stats) => string, label: string): void {
    const t = textSwap();
    const sr = h('span', 'sr-only', srText(label, DASH));
    host.append(t.el, sr);
    this.bound.push({ fmt, set: t.set, sr, label, last: DASH });
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

  /** Ring that grows out from behind the hero number. */
  pulse(): void {
    if (reducedMotion()) return;
    this.ring.animate(
      [
        { transform: 'translate(-50%, -50%) scale(.9)', opacity: 0.5 },
        { transform: 'translate(-50%, -50%) scale(1.4)', opacity: 0 },
      ],
      { duration: 600, easing: 'cubic-bezier(.16, 1, .3, 1)' },
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

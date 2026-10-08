// Rolling-digit number display. Digits roll vertically; literals stay fixed.
import { reducedMotion } from '../util/raf';

export const DASH = '—';
const STAGGER_MS = 20;
const DUR_MS = 280;
const EASE = 'cubic-bezier(.16, 1, .3, 1)';
// Three laps of 0–9. Columns rest in the middle lap, so a carry (9→0) keeps
// rolling up into the next lap and a borrow (0→9) rolls down into the previous one.
const LAPS = 3;
const CELLS = LAPS * 10;
const REST = 10;

type Slot = { el: HTMLElement; ch: string; strip?: HTMLElement; cell: number; settle?: ReturnType<typeof setTimeout> };

const isDigit = (c: string) => c >= '0' && c <= '9';
const numeric = (s: string) => parseFloat(s.replace(/[^\d.]/g, ''));
const afterPaint = (fn: () => void) => requestAnimationFrame(() => requestAnimationFrame(fn));

function digitSlot(): Slot {
  const el = document.createElement('span');
  el.className = 'odo-d';
  const strip = document.createElement('span');
  strip.className = 'odo-strip odo-static';
  strip.textContent = '0123456789'.repeat(LAPS);
  el.append(strip);
  return { el, ch: '0', strip, cell: REST };
}

function literalSlot(ch: string): Slot {
  const el = document.createElement('span');
  el.className = 'odo-l';
  el.textContent = ch;
  return { el, ch, cell: 0 };
}

const place = (s: Slot, cell: number) => {
  s.cell = cell;
  s.strip!.style.transform = `translateY(${(-cell * 100) / CELLS}%)`;
};

/** Jump without animating, then re-enable transitions once that frame has painted. */
function snap(s: Slot, cell: number): void {
  s.strip!.classList.add('odo-static');
  place(s, cell);
  afterPaint(() => s.strip!.classList.remove('odo-static'));
}

/** Pick the cell showing digit `d` that rolls in the direction of the value change. */
function targetCell(from: number, d: number, up: boolean): number {
  const options = [d, d + 10, d + 20];
  if (up) return options.find((c) => c >= from) ?? d + 20;
  return [...options].reverse().find((c) => c <= from) ?? d;
}

export class Odometer {
  readonly el: HTMLElement;
  private inner: HTMLElement;
  private slots: Slot[] = [];
  private value = '';
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(className = '') {
    this.el = document.createElement('span');
    this.el.className = `odo ${className}`.trim();
    this.el.setAttribute('aria-hidden', 'true');
    this.inner = document.createElement('span');
    this.inner.className = 'odo-inner';
    this.el.append(this.inner);
    this.set(DASH, true);
  }

  set(next: string, instant = false): void {
    if (next === this.value) return;
    const prev = this.value;
    this.value = next;
    clearTimeout(this.timer);

    if (instant || reducedMotion()) {
      this.build(next, null);
      if (!instant) this.inner.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 120 });
      return;
    }

    if (next === DASH) {
      // Roll every digit down to 0, then swap to a dash.
      for (const s of this.slots) if (s.strip) this.roll(s, targetCell(s.cell, 0, false), 0);
      this.timer = setTimeout(() => {
        this.build(DASH, null);
        this.inner.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DUR_MS, easing: EASE });
      }, DUR_MS);
      return;
    }

    if (!/\d/.test(prev)) {
      this.build(next, null);
      this.inner.animate(
        [
          { opacity: 0, transform: 'translateY(6px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: DUR_MS, easing: EASE },
      );
      return;
    }

    this.build(next, numeric(next) >= numeric(prev));
  }

  private roll(s: Slot, cell: number, delay: number): void {
    clearTimeout(s.settle);
    s.strip!.style.transitionDelay = `${delay}ms`;
    place(s, cell);
    const rest = REST + (cell % 10);
    if (cell !== rest) s.settle = setTimeout(() => snap(s, rest), DUR_MS + delay + 40);
  }

  /**
   * Reconcile slots right-to-left so existing columns keep rolling from where
   * they are. `up` is the roll direction, or null to place digits without animating.
   */
  private build(text: string, up: boolean | null): void {
    const old = this.slots;
    const out: Slot[] = [];
    let digitIndex = 0;
    for (let i = text.length - 1, j = old.length - 1; i >= 0; i--, j--) {
      const ch = text[i]!;
      const digit = isDigit(ch);
      let s = j >= 0 ? old[j] : undefined;
      let fresh = false;
      if (!s || !!s.strip !== digit || (!digit && s.ch !== ch)) {
        s = digit ? digitSlot() : literalSlot(ch);
        fresh = true;
      }
      if (s.strip) {
        const d = +ch;
        const delay = digitIndex * STAGGER_MS;
        if (up === null) {
          clearTimeout(s.settle);
          snap(s, REST + d);
        } else if (fresh) {
          // New leading column: rolls up from 0.
          place(s, REST);
          afterPaint(() => {
            s!.strip!.classList.remove('odo-static');
            this.roll(s!, REST + +s!.ch, delay);
          });
        } else {
          this.roll(s, targetCell(s.cell, d, up), delay);
        }
        s.ch = ch;
        digitIndex++;
      }
      out.unshift(s);
    }
    this.slots = out;
    this.el.classList.toggle('is-empty', text === DASH);
    if (out.length !== old.length || out.some((s, k) => s !== old[k])) {
      this.inner.replaceChildren(...out.map((s) => s.el));
    }
  }
}

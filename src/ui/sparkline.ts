// Live WPM sparkline. Points slide in from the right; the curve eases between samples.
import { reducedMotion } from '../util/raf';

const NS = 'http://www.w3.org/2000/svg';
const W = 288;
const PW = W - 8; // plot width; leaves room for the dot's halo
const H = 64;
const PAD_TOP = 8;
const SLOTS = 60;
const MIN_SPAN = 10; // early in a session, stretch the few samples over at least this many slots
const SLIDE_MS = 700;

const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);

export class Sparkline {
  readonly el: SVGSVGElement;
  private line: SVGPathElement;
  private area: SVGPathElement;
  private dot: SVGGElement;
  private target: number[] = [];
  private shown: number[] = [];
  private count = 0; // total samples seen, to detect new ones
  private slideStart = -Infinity;
  private scale = 60;
  private span = MIN_SPAN;

  constructor() {
    this.el = svg('svg', {
      class: 'spark',
      viewBox: `0 0 ${W} ${H}`,
      'aria-hidden': 'true',
      focusable: 'false',
    });
    const defs = svg('defs', {});
    const grad = svg('linearGradient', { id: 'spark-fill', x1: '0', y1: '0', x2: '0', y2: '1' });
    grad.append(
      svg('stop', { offset: '0', class: 'spark-stop-a' }),
      svg('stop', { offset: '1', class: 'spark-stop-b' }),
    );
    const clip = svg('clipPath', { id: 'spark-clip' });
    clip.append(svg('rect', { x: '0', y: '-8', width: `${PW}`, height: `${H + 16}` }));
    defs.append(grad, clip);
    const plot = svg('g', { 'clip-path': 'url(#spark-clip)' });
    this.area = svg('path', { class: 'spark-area', fill: 'url(#spark-fill)' });
    this.line = svg('path', { class: 'spark-line' });
    this.dot = svg('g', { class: 'spark-dot' });
    this.dot.append(svg('circle', { class: 'spark-halo', r: '6' }), svg('circle', { class: 'spark-core', r: '2.5' }));
    const base = svg('line', { class: 'spark-base', x1: '0', x2: `${W}`, y1: `${H - 0.5}`, y2: `${H - 0.5}` });
    plot.append(this.area, this.line);
    this.el.append(defs, base, plot, this.dot);
    this.draw(0);
  }

  /** Feed the full series and total sample count. Returns true if a new sample arrived. */
  update(series: number[], total: number, now: number): boolean {
    const added = total - this.count;
    this.count = total;
    if (added <= 0) return false;
    this.target = series.slice(-SLOTS);
    // Keep displayed values aligned with the target array: shift out old ones, new ones start at the last value.
    const last = this.shown.at(-1) ?? 0;
    this.shown = this.shown.slice(Math.min(added, this.shown.length));
    while (this.shown.length < this.target.length) this.shown.push(last);
    this.shown = this.shown.slice(-this.target.length);
    this.slideStart = reducedMotion() ? -Infinity : now;
    return true;
  }

  /** Flatten to the baseline (reset). */
  flatten(): void {
    this.target = this.target.map(() => 0);
    this.count = 0;
    this.slideStart = -Infinity;
  }

  clear(): void {
    this.target = [];
    this.shown = [];
    this.count = 0;
    this.span = MIN_SPAN;
    this.draw(0);
  }

  /** Advance one frame. Returns true while still animating. */
  step(dt: number, now: number): boolean {
    const rm = reducedMotion();
    const k = rm ? 1 : 1 - Math.exp(-dt * 9);
    let moving = false;
    for (let i = 0; i < this.target.length; i++) {
      const d = this.target[i]! - (this.shown[i] ?? 0);
      if (Math.abs(d) > 0.05) moving = true;
      this.shown[i] = (this.shown[i] ?? 0) + d * k;
    }
    const peak = Math.max(60, ...this.target) * 1.15;
    const ds = peak - this.scale;
    if (Math.abs(ds) > 0.1) moving = true;
    this.scale += ds * k;
    const span = Math.min(SLOTS - 1, Math.max(MIN_SPAN, this.target.length));
    if (Math.abs(span - this.span) > 0.01) moving = true;
    this.span += (span - this.span) * k;

    const p = Math.min(1, (now - this.slideStart) / SLIDE_MS);
    if (p < 1) moving = true;
    this.draw(1 - easeOut(Math.max(0, p)));
    return moving;
  }

  /** `offset` in slots: 1 = drawn one step right of final position. */
  private draw(offset: number): void {
    const v = this.shown;
    const n = v.length;
    if (n < 2) {
      const y = H - 0.5;
      this.line.setAttribute('d', `M0 ${y}H${PW}`);
      this.area.setAttribute('d', '');
      this.dot.setAttribute('transform', `translate(${PW} ${y})`);
      this.dot.style.opacity = n ? '1' : '0';
      this.dot.classList.toggle('is-hidden', !n);
      this.el.classList.toggle('is-empty', !n);
      return;
    }
    const usable = H - PAD_TOP - 1;
    const dx = PW / this.span;
    const pts: [number, number][] = v.map((val, i) => [
      PW - (n - 1 - i - offset) * dx,
      H - 1 - (Math.max(0, val) / this.scale) * usable,
    ]);
    // Ease in from the baseline instead of starting with a vertical wall of fill.
    if (n < SLOTS) pts.unshift([pts[0]![0] - dx, H - 1]);
    // Catmull-Rom -> cubic Bézier for a smooth curve.
    const m = pts.length;
    let d = `M${pts[0]![0].toFixed(1)} ${pts[0]![1].toFixed(1)}`;
    for (let i = 0; i < m - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i]!;
      const p1 = pts[i]!;
      const p2 = pts[i + 1]!;
      const p3 = pts[i + 2] ?? p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    this.line.setAttribute('d', d);
    const lastPt = pts[m - 1]!;
    this.area.setAttribute('d', `${d}L${lastPt[0].toFixed(1)} ${H}L${pts[0]![0].toFixed(1)} ${H}Z`);
    this.dot.setAttribute('transform', `translate(${Math.min(lastPt[0], PW).toFixed(1)} ${lastPt[1].toFixed(1)})`);
    this.dot.style.opacity = '1';
    this.dot.classList.remove('is-hidden');
    this.el.classList.remove('is-empty');
  }
}

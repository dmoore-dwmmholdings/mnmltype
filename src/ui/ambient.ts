// Background glow whose intensity follows Live WPM through a critically damped spring.
import { reducedMotion } from '../util/raf';

const OMEGA = 3.2; // spring stiffness (rad/s); settles in ~1.5 s
const FULL_WPM = 120;

export class Ambient {
  private x = 0;
  private v = 0;
  private target = 0;

  constructor(private el: HTMLElement) {
    this.apply();
  }

  setWpm(wpm: number | null, idle: boolean): void {
    this.target = idle || wpm === null ? 0 : Math.min(1, wpm / FULL_WPM);
    this.el.classList.toggle('is-breathing', this.target === 0);
  }

  /** Returns true while still moving. */
  step(dt: number): boolean {
    if (reducedMotion()) {
      this.x = this.v = 0;
      this.apply();
      return false;
    }
    // x'' = ω²(target − x) − 2ωx'
    const a = OMEGA * OMEGA * (this.target - this.x) - 2 * OMEGA * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    this.apply();
    return Math.abs(this.target - this.x) > 0.001 || Math.abs(this.v) > 0.001;
  }

  private apply(): void {
    // 0.2 at rest so idle breathing (core opacity 1 → .5) swings 0.10–0.20 around 0.15.
    const opacity = 0.2 + 0.4 * this.x;
    const scale = 1 + 0.25 * this.x;
    this.el.style.opacity = opacity.toFixed(3);
    this.el.style.transform = `scale(${scale.toFixed(4)})`;
  }
}

/** Coalesce many schedule() calls into at most one callback per animation frame. */
export function frameScheduler(fn: (now: number) => void): () => void {
  let id = 0;
  return () => {
    if (id) return;
    id = requestAnimationFrame((now) => {
      id = 0;
      fn(now);
    });
  };
}

/**
 * Run `step` every frame while it returns true. Calling the returned function
 * restarts the loop if it has stopped. `dt` is in seconds, capped to avoid jumps
 * after a background tab.
 */
export function animationLoop(step: (dt: number, now: number) => boolean): () => void {
  let id = 0;
  let last = 0;
  const frame = (now: number) => {
    const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60;
    last = now;
    if (step(dt, now)) id = requestAnimationFrame(frame);
    else id = last = 0;
  };
  return () => {
    if (!id) id = requestAnimationFrame(frame);
  };
}

/** Debounce `fn` by `ms`. */
export function debounce(fn: () => void, ms: number): (() => void) & { cancel(): void } {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
export const reducedMotion = (): boolean => !!mq?.matches;
export const onReducedMotionChange = (fn: () => void): void => mq?.addEventListener('change', fn);

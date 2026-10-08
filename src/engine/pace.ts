// Pure: classifies live WPM against the session peak and its recent trend.

export type Pace = 'peak' | 'up' | 'down';

/** Live WPM within this many WPM of the peak counts as "at peak". */
export const PEAK_BAND = 5;
/** Changes smaller than this keep the previous direction, so the colour doesn't flicker. */
export const TREND_DEADBAND = 1;

/**
 * @param live current live WPM
 * @param peak session peak WPM (null until it exists)
 * @param ref live WPM about a second ago (null if unknown)
 * @param prev previous result, for hysteresis
 */
export function pace(live: number | null, peak: number | null, ref: number | null, prev: Pace | null): Pace | null {
  if (live === null) return null;
  if (peak === null || live >= peak - PEAK_BAND) return 'peak';
  const keep = prev === 'up' || prev === 'down' ? prev : 'down'; // leaving the peak band means slowing down
  if (ref === null) return keep;
  const d = live - ref;
  if (d > TREND_DEADBAND) return 'up';
  if (d < -TREND_DEADBAND) return 'down';
  return keep;
}

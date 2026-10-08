import { describe, expect, it } from 'vitest';
import { computeContent, computeStats, IDLE_CAP_MS } from '../src/engine/stats';
import type { KeyEvent } from '../src/engine/types';

const ins = (t: number, inserted = 1, deleted = 0): KeyEvent => ({ t, kind: 'insert', inserted, deleted });
const del = (t: number, deleted = 1): KeyEvent => ({ t, kind: 'delete', inserted: 0, deleted });

/** `count` insert events evenly spaced so the active time is exactly `ms`. */
function evenInserts(count: number, ms: number, sizes: (i: number) => number = () => 1): KeyEvent[] {
  const step = ms / (count - 1);
  return Array.from({ length: count }, (_, i) => ins(i * step, sizes(i)));
}

describe('speed metrics', () => {
  it('250 chars over 60 s, no deletes', () => {
    // 121 events at 500 ms = 60 s active; 10 + 120 * 2 = 250 chars.
    const events = evenInserts(121, 60_000, (i) => (i === 0 ? 10 : 2));
    const s = computeStats(events, 'x'.repeat(250), 60_000);
    expect(s.activeMs).toBe(60_000);
    expect(s.wpmNet).toBeCloseTo(50);
    expect(s.cpm).toBeCloseTo(250);
    expect(s.accuracy).toBe(1);
  });

  it('300 typed, 30 corrected, 60 s', () => {
    const events = evenInserts(121, 60_000, (i) => (i === 0 ? 60 : 2));
    events.push(del(60_000, 30)); // zero gap: active time unchanged
    const s = computeStats(events, '', 60_000);
    expect(s.wpmNet).toBeCloseTo(54);
    expect(s.wpmGross).toBeCloseTo(60);
    expect(s.correctionRate).toBeCloseTo(0.1);
    expect(s.backspaces).toBe(1);
    expect(s.keystrokes).toBe(122);
  });

  it('a 30 s pause adds only IDLE_CAP to active time', () => {
    const events = [ins(0), ins(1000), ins(31_000), ins(32_000)];
    const s = computeStats(events, 'abcd', 32_000);
    expect(s.activeMs).toBe(2000 + IDLE_CAP_MS);
    expect(s.elapsedMs).toBe(32_000);
  });

  it('paste updates words but not speed or corrections', () => {
    const typing = evenInserts(41, 10_000);
    const base = computeStats(typing, 'a'.repeat(41), 10_000);
    const pasted = 'word '.repeat(200);
    const withPaste = computeStats(
      [...typing, { t: 10_000, kind: 'paste', inserted: 1000, deleted: 0 }],
      'a'.repeat(41) + ' ' + pasted,
      10_000,
    );
    expect(withPaste.words).toBe(base.words + 200);
    expect(withPaste.wpmNet).toBe(base.wpmNet);
    expect(withPaste.cpm).toBe(base.cpm);
    expect(withPaste.correctionRate).toBe(base.correctionRate);
  });

  it('selection replace counts deleted chars as corrections', () => {
    const before = computeStats([ins(0, 10)], '', 0);
    const after = computeStats([ins(0, 10), ins(100, 1, 5)], '', 100);
    expect(after.correctionRate! * 11).toBeCloseTo(5);
    expect(before.correctionRate).toBe(0);
    expect(after.keystrokes).toBe(2);
  });

  it('empty or whitespace text gives zero counts and null speed', () => {
    for (const text of ['', '   \n\n  \t']) {
      const s = computeStats([], text, 1000);
      expect(s.words).toBe(0);
      expect(s.sentences).toBe(0);
      expect(s.paragraphs).toBe(0);
      expect(s.wpmNet).toBeNull();
      expect(s.wpmGross).toBeNull();
      expect(s.cpm).toBeNull();
      expect(s.wpmLive).toBeNull();
      expect(s.wpmPeak).toBeNull();
      expect(s.accuracy).toBeNull();
      expect(s.idle).toBe(true);
    }
  });

  it('speed metrics are null under 3 s active', () => {
    const s = computeStats(evenInserts(20, 2900), 'x'.repeat(20), 2900);
    expect(s.wpmNet).toBeNull();
    expect(s.cpm).toBeNull();
    expect(s.wpmLive).toBeNull();
    const ok = computeStats(evenInserts(20, 3000), 'x'.repeat(20), 3000);
    expect(ok.wpmNet).not.toBeNull();
  });

  it('consistency needs 20 intervals; even intervals give 100%', () => {
    expect(computeStats(evenInserts(20, 3800), '', 3800).consistency).toBeNull(); // 19 intervals
    expect(computeStats(evenInserts(21, 4000), '', 4000).consistency).toBe(1);
    const jittery = Array.from({ length: 30 }, (_, i) => ins(i * 200 + (i % 2) * 80));
    const c = computeStats(jittery, '', 6000).consistency!;
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThan(1);
  });

  it('never returns NaN or Infinity', () => {
    const s = computeStats([del(0, 3), ins(10, 0)], '', 10);
    for (const v of Object.values(s)) {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('samples live WPM every second, keeps 60, tracks peak after 5 s', () => {
    const events = evenInserts(601, 120_000); // 1 char / 200 ms = 60 WPM for 120 s
    const s = computeStats(events, '', 120_000);
    expect(s.wpmSeries).toHaveLength(60);
    expect(s.wpmSeries.at(-1)).toBeCloseTo(60, 0);
    expect(s.wpmLive).toBeCloseTo(60, 0);
    expect(s.wpmPeak).toBeGreaterThanOrEqual(59);
    expect(s.idle).toBe(false);
    expect(computeStats(events, '', 125_000).idle).toBe(true);
  });

  it('flags recent corrections', () => {
    const events = [...evenInserts(20, 3000), del(3100, 5)];
    expect(computeStats(events, '', 3100).recentCorrectionRate).toBeCloseTo(5 / 20);
  });
});

describe('content metrics', () => {
  const fixture = [
    'The quick brown fox jumps over the lazy dog. The dog sleeps!',
    '',
    'Extraordinarily, nothing happened... Did it?',
    '   ',
    '',
    'A trailing fragment without punctuation',
  ].join('\n');

  it('counts sentences, paragraphs, unique and longest words', () => {
    const c = computeContent(fixture);
    expect(c.sentences).toBe(5);
    expect(c.paragraphs).toBe(3);
    expect(c.words).toBe(22);
    // the(×3) and dog(×2) repeat: 22 tokens, 19 unique.
    expect(c.uniqueWords).toBe(19);
    expect(c.longestWord).toBe('Extraordinarily');
    expect(c.chars).toBe(fixture.length);
    expect(c.charsNoSpace).toBe(fixture.replace(/\s/g, '').length);
  });

  it('strips punctuation for average word length', () => {
    const c = computeContent('Hi, there! ok.');
    expect(c.avgWordLen).toBeCloseTo((2 + 5 + 2) / 3);
    expect(c.sentences).toBe(2);
  });

  it('counts single sentence without terminator', () => {
    expect(computeContent('hello world').sentences).toBe(1);
    expect(computeContent('...').sentences).toBe(0);
  });
});

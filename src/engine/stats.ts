// Pure stats engine. No DOM access: everything here is unit-testable.
import type { ContentStats, KeyEvent, SpeedStats, Stats } from './types';

export const IDLE_CAP_MS = 2000;
export const WINDOW_MS = 10_000;
export const MIN_ACTIVE_MS = 3000;
export const PEAK_MIN_ACTIVE_MS = 5000;
export const SAMPLE_MS = 1000;
export const SERIES_LEN = 60;
export const MIN_INTERVALS = 20;

type WindowEntry = { t: number; typed: number; corrected: number };

/**
 * Bounded event log: running totals plus a short window of recent typing
 * events. Memory stays constant however long the session runs.
 */
export type EventLog = {
  start: number | null;
  last: number | null;
  typed: number;
  corrected: number;
  keystrokes: number;
  backspaces: number;
  activeMs: number;
  // Welford running stats over inter-key intervals (gaps <= IDLE_CAP_MS).
  intervals: number;
  mean: number;
  m2: number;
  recent: WindowEntry[];
  head: number;
  nextSample: number;
  series: number[];
  peak: number | null;
};

export function createLog(): EventLog {
  return {
    start: null, last: null,
    typed: 0, corrected: 0, keystrokes: 0, backspaces: 0, activeMs: 0,
    intervals: 0, mean: 0, m2: 0,
    recent: [], head: 0,
    nextSample: 1, series: [], peak: null,
  };
}

function windowTotals(log: EventLog, at: number): { typed: number; corrected: number } {
  let typed = 0;
  let corrected = 0;
  const from = at - WINDOW_MS;
  for (let i = log.head; i < log.recent.length; i++) {
    const e = log.recent[i]!;
    if (e.t > from && e.t <= at) {
      typed += e.typed;
      corrected += e.corrected;
    }
  }
  return { typed, corrected };
}

function liveAt(log: EventLog, at: number): number {
  if (log.start === null) return 0;
  const span = Math.min(WINDOW_MS, at - log.start);
  if (span <= 0) return 0;
  const { typed, corrected } = windowTotals(log, at);
  return Math.max(0, (typed - corrected) / 5 / (span / 60_000));
}

function pushSample(log: EventLog, value: number): void {
  log.series.push(value);
  if (log.series.length > SERIES_LEN) log.series.shift();
}

/** Close every 1 s sample whose time is <= `to` (or < `to` when `strict`). */
function advance(log: EventLog, to: number, strict = false): void {
  if (log.start === null || log.last === null) return;
  for (;;) {
    const ts = log.start + log.nextSample * SAMPLE_MS;
    if (ts > to || (strict && ts === to)) return;
    if (ts - log.last > WINDOW_MS) {
      // Window is empty from here on: every remaining sample is 0.
      const pending = Math.floor((to - ts) / SAMPLE_MS) + 1;
      for (let i = 0; i < Math.min(pending, SERIES_LEN); i++) pushSample(log, 0);
      log.nextSample += pending;
      return;
    }
    const live = liveAt(log, ts);
    pushSample(log, live);
    if (log.activeMs >= PEAK_MIN_ACTIVE_MS) log.peak = Math.max(log.peak ?? 0, live);
    log.nextSample++;
  }
}

function prune(log: EventLog, before: number): void {
  while (log.head < log.recent.length && log.recent[log.head]!.t <= before) log.head++;
  if (log.head > 256) {
    log.recent = log.recent.slice(log.head);
    log.head = 0;
  }
}

/** Fold one event into the log. Paste, cut, undo, redo and other are ignored for speed. */
export function appendEvent(log: EventLog, ev: KeyEvent): void {
  if (ev.kind !== 'insert' && ev.kind !== 'delete') return;

  if (log.start === null || log.last === null) {
    if (ev.kind !== 'insert') return; // session starts on the first insert
    log.start = ev.t;
  } else {
    advance(log, ev.t, true); // a sample at exactly ev.t includes this event
    const gap = Math.max(0, ev.t - log.last);
    if (gap <= IDLE_CAP_MS) {
      log.intervals++;
      const d = gap - log.mean;
      log.mean += d / log.intervals;
      log.m2 += d * (gap - log.mean);
    }
    log.activeMs += Math.min(gap, IDLE_CAP_MS);
  }
  log.last = ev.t;

  log.keystrokes++;
  let typed = 0;
  let corrected = ev.deleted;
  if (ev.kind === 'insert') typed = ev.inserted;
  else log.backspaces++;
  log.typed += typed;
  log.corrected += corrected;

  log.recent.push({ t: ev.t, typed, corrected });
  prune(log, ev.t - WINDOW_MS);
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const finite = (x: number): number | null => (Number.isFinite(x) ? x : null);

export function speedFromLog(log: EventLog, now: number): SpeedStats {
  advance(log, now);
  const { activeMs, typed, corrected } = log;
  const ok = log.start !== null && activeMs >= MIN_ACTIVE_MS;
  const activeMin = activeMs / 60_000;

  const correctionRate = typed > 0 ? corrected / typed : null;
  const consistency =
    log.intervals >= MIN_INTERVALS && log.mean > 0
      ? clamp01(1 - Math.sqrt(log.m2 / log.intervals) / log.mean)
      : null;

  const recent = windowTotals(log, now);
  const recentCorrectionRate =
    recent.typed + recent.corrected >= 10 ? recent.corrected / Math.max(recent.typed, 1) : null;

  return {
    wpmNet: ok ? finite(Math.max(0, (typed - corrected) / 5 / activeMin)) : null,
    wpmGross: ok ? finite(typed / 5 / activeMin) : null,
    cpm: ok ? finite(Math.max(0, (typed - corrected) / activeMin)) : null,
    wpmLive: ok ? liveAt(log, now) : null,
    wpmPeak: ok ? log.peak : null,
    correctionRate,
    accuracy: correctionRate === null ? null : clamp01(1 - correctionRate),
    consistency,
    keystrokes: log.keystrokes,
    backspaces: log.backspaces,
    activeMs,
    elapsedMs: log.start === null ? 0 : Math.max(0, now - log.start),
    idle: log.last === null || now - log.last > IDLE_CAP_MS,
    wpmSeries: log.series.slice(),
    sampleCount: log.nextSample - 1,
    recentCorrectionRate,
  };
}

// ---- Content metrics ------------------------------------------------------

type Segmenter = { segment(s: string): Iterable<{ isWordLike?: boolean }> };
let segmenter: Segmenter | null | undefined;

function getSegmenter(): Segmenter | null {
  if (segmenter === undefined) {
    const I = Intl as unknown as { Segmenter?: new (l?: string, o?: object) => Segmenter };
    segmenter = I.Segmenter ? new I.Segmenter(undefined, { granularity: 'word' }) : null;
  }
  return segmenter;
}

const PUNCT = /[\p{P}\p{S}]/gu;
const HAS_WORD = /[\p{L}\p{N}]/u;

export function countWords(text: string): number {
  const seg = getSegmenter();
  if (seg) {
    let n = 0;
    for (const s of seg.segment(text)) if (s.isWordLike) n++;
    return n;
  }
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function computeContent(text: string): ContentStats {
  const sentenceMatches = (text.match(/[^.!?]+[.!?]+/g) ?? []).filter((m) => HAS_WORD.test(m));
  const lastEnd = text.search(/[.!?][^.!?]*$/);
  const tail = lastEnd === -1 ? text : text.slice(lastEnd + 1);
  const sentences = sentenceMatches.length + (HAS_WORD.test(tail) ? 1 : 0);

  const tokens = text
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(PUNCT, ''))
    .filter(Boolean);

  let total = 0;
  let longestWord = '';
  const unique = new Set<string>();
  for (const t of tokens) {
    total += t.length;
    if (t.length > longestWord.length) longestWord = t;
    unique.add(t.toLowerCase());
  }

  return {
    words: countWords(text),
    chars: text.length,
    charsNoSpace: text.replace(/\s/g, '').length,
    sentences,
    paragraphs: text.split(/\n\s*\n/).filter((b) => b.trim()).length,
    avgWordLen: tokens.length ? total / tokens.length : null,
    uniqueWords: unique.size,
    longestWord,
  };
}

/** Single entry point: event log + text -> Stats. */
export function computeStats(events: KeyEvent[], text: string, now: number): Stats {
  const log = createLog();
  for (const ev of events) appendEvent(log, ev);
  return { ...speedFromLog(log, now), ...computeContent(text) };
}

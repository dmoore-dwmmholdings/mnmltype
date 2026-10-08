export type KeyKind = 'insert' | 'delete' | 'paste' | 'cut' | 'undo' | 'redo' | 'other';

export type KeyEvent = {
  t: number; // performance.now()
  kind: KeyKind;
  inserted: number; // chars added
  deleted: number; // chars removed (includes selection replacement)
};

export type SpeedStats = {
  wpmNet: number | null;
  wpmGross: number | null;
  cpm: number | null;
  wpmLive: number | null;
  wpmPeak: number | null;
  correctionRate: number | null;
  accuracy: number | null;
  consistency: number | null;
  keystrokes: number;
  backspaces: number;
  activeMs: number;
  elapsedMs: number;
  idle: boolean;
  wpmSeries: number[]; // Live WPM sampled every 1 s, last 60 samples
  /** Total samples taken this session (series is capped; this is not). */
  sampleCount: number;
  /** Correction rate over the trailing 10 s window (drives the correction flash). */
  recentCorrectionRate: number | null;
};

export type ContentStats = {
  words: number;
  chars: number;
  charsNoSpace: number;
  sentences: number;
  paragraphs: number;
  avgWordLen: number | null;
  uniqueWords: number;
  longestWord: string;
};

export type Stats = SpeedStats & ContentStats;

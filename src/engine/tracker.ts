// Captures textarea input events and turns them into KeyEvents.
import type { KeyEvent, KeyKind } from './types';

export function classify(inputType: string): KeyKind {
  switch (inputType) {
    case 'insertText':
    case 'insertLineBreak':
    case 'insertParagraph':
    case 'insertCompositionText':
      return 'insert';
    case 'insertFromPaste':
    case 'insertFromPasteAsQuotation':
    case 'insertFromDrop':
      return 'paste';
    case 'deleteByCut':
    case 'deleteByDrag':
      return 'cut';
    case 'historyUndo':
      return 'undo';
    case 'historyRedo':
      return 'redo';
  }
  return inputType.startsWith('delete') ? 'delete' : 'other';
}

export type Tracker = {
  /** Ignore events while `fn` runs (used for programmatic clears). */
  suppress(fn: () => void): void;
  destroy(): void;
};

export function createTracker(el: HTMLTextAreaElement, onEvent: (ev: KeyEvent) => void): Tracker {
  let pending: { type: string; selLen: number; len: number } | null = null;
  let composing: { selLen: number } | null = null;
  let muted = false;

  const selLen = () => Math.abs(el.selectionEnd - el.selectionStart);

  const onBeforeInput = (e: Event) => {
    if (muted || composing) return;
    const ie = e as InputEvent;
    if (ie.isComposing || ie.inputType === 'insertCompositionText') return;
    pending = { type: ie.inputType, selLen: selLen(), len: el.value.length };
  };

  const onInput = (e: Event) => {
    if (muted || composing) return;
    const ie = e as InputEvent;
    if (ie.isComposing || ie.inputType === 'insertCompositionText') return;
    const p = pending ?? { type: ie.inputType ?? '', selLen: 0, len: el.value.length };
    pending = null;
    const kind = classify(p.type || ie.inputType || '');
    const delta = el.value.length - p.len;
    let inserted = 0;
    let deleted = 0;
    if (kind === 'delete' || kind === 'cut') {
      deleted = Math.max(0, -delta);
    } else {
      deleted = p.selLen;
      inserted = Math.max(0, delta + p.selLen);
    }
    if (inserted === 0 && deleted === 0 && kind !== 'undo' && kind !== 'redo') return;
    onEvent({ t: performance.now(), kind, inserted, deleted });
  };

  // IME: only the committed text counts, once, when composition ends.
  const onCompStart = () => {
    if (muted) return;
    composing = { selLen: selLen() };
  };
  const onCompEnd = (e: Event) => {
    const c = composing;
    composing = null;
    pending = null;
    if (muted || !c) return;
    const inserted = (e as CompositionEvent).data?.length ?? 0;
    if (inserted === 0 && c.selLen === 0) return;
    onEvent({ t: performance.now(), kind: 'insert', inserted, deleted: c.selLen });
  };

  el.addEventListener('beforeinput', onBeforeInput);
  el.addEventListener('input', onInput);
  el.addEventListener('compositionstart', onCompStart);
  el.addEventListener('compositionend', onCompEnd);

  return {
    suppress(fn) {
      muted = true;
      try {
        fn();
      } finally {
        muted = false;
        pending = null;
        composing = null;
      }
    },
    destroy() {
      el.removeEventListener('beforeinput', onBeforeInput);
      el.removeEventListener('input', onInput);
      el.removeEventListener('compositionstart', onCompStart);
      el.removeEventListener('compositionend', onCompEnd);
    },
  };
}

// Blue block caret drawn over a native <textarea>. The textarea keeps undo,
// IME, selection and accessibility; its own caret is made transparent.
// A hidden mirror element with identical text metrics finds the caret position.

const COPY = [
  'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontFeatureSettings', 'fontVariantNumeric',
  'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'tabSize', 'textIndent',
] as const;

const SOLID_MS = 600; // stay solid this long after each keystroke, then blink

export class BlockCaret {
  private mirror: HTMLDivElement;
  private marker: HTMLSpanElement;
  private glyph: HTMLSpanElement;
  private solidTimer: ReturnType<typeof setTimeout> | undefined;
  private frame = 0;
  private lastText = '';
  private lastPos = -1;

  constructor(
    private ta: HTMLTextAreaElement,
    private caret: HTMLElement,
  ) {
    this.mirror = document.createElement('div');
    this.mirror.className = 'caret-mirror';
    this.mirror.setAttribute('aria-hidden', 'true');
    this.marker = document.createElement('span');
    this.glyph = document.createElement('span');
    this.glyph.className = 'caret-glyph';
    caret.append(this.glyph);
    ta.parentElement!.append(this.mirror);
    this.syncStyles();

    const schedule = () => this.schedule();
    ta.addEventListener('input', () => {
      this.solid();
      schedule();
    });
    ta.addEventListener('scroll', schedule);
    ta.addEventListener('focus', schedule);
    document.addEventListener('selectionchange', () => {
      if (document.activeElement === ta) schedule();
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key.startsWith('Page')) this.solid();
    });
    ta.addEventListener('compositionstart', () => caret.classList.add('is-composing'));
    ta.addEventListener('compositionend', () => {
      caret.classList.remove('is-composing');
      schedule();
    });
    new ResizeObserver(() => {
      this.syncStyles();
      this.lastPos = -1;
      schedule();
    }).observe(ta);
    void document.fonts?.ready.then(() => {
      this.syncStyles();
      this.lastPos = -1;
      schedule();
    });
  }

  /** Solid while typing or moving; blinking resumes after a short pause. */
  private solid(): void {
    this.caret.classList.add('is-solid');
    clearTimeout(this.solidTimer);
    this.solidTimer = setTimeout(() => this.caret.classList.remove('is-solid'), SOLID_MS);
  }

  private syncStyles(): void {
    const cs = getComputedStyle(this.ta);
    const m = this.mirror.style;
    for (const k of COPY) m[k] = cs[k];
    // Wrap width must match the textarea's content box, which excludes its scrollbar.
    m.width = `${this.ta.clientWidth + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth)}px`;
    this.caret.style.font = cs.font;
    this.caret.style.letterSpacing = cs.letterSpacing;
  }

  schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.update();
    });
  }

  private update(): void {
    const { ta, caret } = this;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    caret.classList.toggle('is-hidden', start !== end);
    if (start !== end) return;

    const text = ta.value;
    if (text !== this.lastText || start !== this.lastPos) {
      this.lastText = text;
      this.lastPos = start;
      const next = text[start];
      this.mirror.textContent = text.slice(0, start);
      // A zero-width-safe marker: the next character, or a space at a line end.
      this.marker.textContent = next && next !== '\n' ? next : '​';
      this.mirror.append(this.marker);
      this.glyph.textContent = next && next !== '\n' && next !== ' ' && next !== '\t' ? next : '';
    }
    const top = this.marker.offsetTop + (this.marker.offsetHeight - caret.offsetHeight) / 2;
    const left = this.marker.offsetLeft;
    caret.style.transform = `translate(${left - ta.scrollLeft}px, ${top - ta.scrollTop}px)`;
    // Hide when scrolled out of the textarea's visible box.
    const y = top - ta.scrollTop;
    caret.classList.toggle('is-out', y < -caret.offsetHeight || y > ta.clientHeight);
  }
}

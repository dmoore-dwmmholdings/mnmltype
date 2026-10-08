// Editor helpers: focus state, clearing with undo support.

export function bindFocusLine(editor: HTMLTextAreaElement, app: HTMLElement): void {
  editor.addEventListener('focus', () => app.classList.add('is-focused'));
  editor.addEventListener('blur', () => app.classList.remove('is-focused'));
}

/**
 * Delete the first `upTo` characters (default: all). Uses execCommand when
 * possible so Ctrl+Z can restore the text.
 */
export function clearEditor(editor: HTMLTextAreaElement, upTo = editor.value.length): void {
  const rest = editor.value.slice(upTo);
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(0, upTo);
  let ok = false;
  try {
    ok = document.execCommand('delete');
  } catch {
    ok = false;
  }
  if (!ok || editor.value !== rest) editor.value = rest;
  editor.setSelectionRange(rest.length, rest.length);
  editor.scrollTop = 0;
}

import { expect, test, type Page } from '@playwright/test';

/** A stat's real value, from its visually hidden text. Rows are found by their <dt>. */
const stat = (page: Page, label: string) =>
  label === 'WPM'
    ? page.locator('.hero-num .sr-only')
    : page
        .locator('#panel-body .row')
        .filter({ has: page.getByText(label, { exact: true }) })
        .locator('.sr-only');

const value = async (page: Page, label: string) => (await stat(page, label).textContent()) ?? '';

const TEXT = 'The quick brown fox jumps over the lazy dog';

test.describe('desktop', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#editor')).toBeFocused();
  });

  test('loads focused with empty stats', async ({ page }) => {
    await expect(stat(page, 'WPM')).toHaveText('Net words per minute: not available');
    await expect(stat(page, 'Accuracy')).toHaveText('not available');
    await expect(page.locator('.hero-num .odo')).toHaveText('—');
  });

  test('typing updates content and speed stats', async ({ page }) => {
    await page.keyboard.type(TEXT, { delay: 80 }); // 43 chars × 80 ms ≈ 3.4 s
    await expect(stat(page, 'Words')).toHaveText('9');
    await expect(stat(page, 'Characters')).toHaveText(`${TEXT.length}`);
    await expect.poll(async () => (await value(page, 'WPM')).split(': ')[1]).toMatch(/^\d+$/);
    await expect(stat(page, 'Accuracy')).toHaveText('100.0%');
  });

  test('backspaces lower accuracy', async ({ page }) => {
    await page.keyboard.type(TEXT, { delay: 30 });
    for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace', { delay: 30 });
    await expect(stat(page, 'Backspaces')).toHaveText('3');
    const acc = parseFloat((await value(page, 'Accuracy')) ?? '100');
    expect(acc).toBeLessThan(100);
  });

  test('reset clears editor and stats', async ({ page }) => {
    await page.keyboard.type('hello world', { delay: 20 });
    await expect(stat(page, 'Words')).toHaveText('2');
    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(page.locator('#editor')).toHaveValue('');
    await expect(stat(page, 'Words')).toHaveText('not available');
    await expect(stat(page, 'Accuracy')).toHaveText('not available');
    await expect(stat(page, 'Keystrokes')).toHaveText('not available');
    await expect(page.locator('#editor')).toBeFocused();
  });

  test('long text needs a confirm click; Esc resets', async ({ page }) => {
    await page.locator('#editor').fill('x'.repeat(250));
    const btn = page.locator('#reset');
    await btn.click();
    await expect(btn).toHaveText('confirm');
    await expect(page.locator('#editor')).not.toHaveValue('');
    await btn.click();
    await expect(page.locator('#editor')).toHaveValue('');
    await expect(btn).toHaveText('reset');

    await page.keyboard.type('abc');
    await page.keyboard.press('Escape');
    await expect(page.locator('#editor')).toHaveValue('');
  });
});

test('phone: no horizontal scroll, statusline visible, sheet opens', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(page.locator('#statusline .sl-wpm')).toBeVisible();
  const bar = page.locator('#stats-toggle');
  await expect(bar).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.locator('#editor').click();
  await page.keyboard.type('one two three', { delay: 20 });
  await bar.click();
  await expect(bar).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#panel')).toBeInViewport();
  await expect(stat(page, 'Words')).toHaveText('3');
  await page.keyboard.press('Escape');
  await expect(bar).toHaveAttribute('aria-expanded', 'false');
});

test('reduced motion: no console errors, stats still update', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('#editor')).toBeFocused();
  await page.keyboard.type(TEXT, { delay: 80 });
  await expect(stat(page, 'Words')).toHaveText('9');
  await expect.poll(async () => (await value(page, 'WPM')).split(': ')[1]).toMatch(/^\d+$/);
  await page.locator('#reset').click();
  await expect(stat(page, 'Words')).toHaveText('not available');
  expect(errors).toEqual([]);
});

test('tablet: statusline shows WPM', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1000 });
  await page.goto('/');
  await expect(page.locator('#statusline .sl-wpm')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test('block caret follows the text and width menu narrows the column', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#editor')).toBeFocused();
  const caret = page.locator('.caret');
  await expect(caret).toBeVisible();
  const x0 = (await caret.boundingBox())!.x;
  await page.keyboard.type('hello', { delay: 20 });
  await expect.poll(async () => (await caret.boundingBox())!.x).toBeGreaterThan(x0 + 30);

  const editorBox = async () => (await page.locator('#editor').boundingBox())!.width;
  const full = await editorBox();
  await page.locator('#view-toggle').click();
  await page.locator('#view-menu [data-w="narrow"]').click();
  const narrow = page.locator('#view-menu [data-w="narrow"]');
  await expect(narrow).toHaveAttribute('aria-pressed', 'true');
  expect(await editorBox()).toBeLessThan(full);
  await page.reload();
  await expect(narrow).toHaveAttribute('aria-pressed', 'true');
});

test('live WPM tag follows the caret and can be switched off', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#editor')).toBeFocused();
  const tag = page.locator('.wpm-tag');
  await page.keyboard.type('the quick brown fox jumps over', { delay: 120 }); // ~3.6 s
  await expect(tag).not.toHaveClass(/is-empty/);
  await expect(tag).toBeVisible();
  const caretBox = (await page.locator('.caret').boundingBox())!;
  const tagBox = (await tag.boundingBox())!;
  expect(tagBox.y).toBeGreaterThan(caretBox.y + caretBox.height - 1);
  expect(Math.abs(tagBox.x - caretBox.x)).toBeLessThan(40);

  await page.locator('#view-toggle').click();
  const sw = page.locator('#view-menu [data-cursor-wpm]');
  await expect(sw).toHaveAttribute('aria-pressed', 'true');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-pressed', 'false');
  await expect(tag).toBeHidden();
});

test('stats drawer toggles from the statusline', async ({ page }) => {
  await page.goto('/');
  const toggle = page.locator('#stats-toggle');
  await toggle.click();
  await expect(page.locator('#panel')).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(page.locator('#panel')).toBeHidden();
});

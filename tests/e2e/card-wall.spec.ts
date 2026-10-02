import { expect, type Page, test } from '@playwright/test';

type FrameHarness = {
  pending: Map<number, FrameRequestCallback>;
  now: number;
  hidden: boolean;
};

declare global {
  interface Window {
    cardWallFrames: FrameHarness;
  }
}

async function step(page: Page, elapsed = 16) {
  return page.evaluate(delta => {
    const frames = window.cardWallFrames;
    frames.now += delta;
    const callbacks = [...frames.pending.values()];
    frames.pending.clear();
    callbacks.forEach(callback => callback(frames.now));
    return frames.pending.size;
  }, elapsed);
}

async function pending(page: Page) {
  return page.evaluate(() => window.cardWallFrames.pending.size);
}

async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate(value => {
    window.cardWallFrames.hidden = value;
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

async function pixels(page: Page) {
  return page.locator('.cw-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
}

test.beforeEach(async ({ page }) => {
  await page.route('**/thumbnails/**', route => route.fulfill({ status: 404, body: '' }));
  await page.addInitScript(() => {
    const frames: FrameHarness = { pending: new Map(), now: 0, hidden: false };
    window.cardWallFrames = frames;
    let id = 0;
    window.requestAnimationFrame = callback => {
      frames.pending.set(++id, callback);
      return id;
    };
    window.cancelAnimationFrame = handle => {
      frames.pending.delete(handle);
    };
    Object.defineProperty(document, 'hidden', { get: () => frames.hidden });
  });
});

async function mount(page: Page) {
  await page.goto('/tools/card-wall');
  await expect(page.locator('.cw-canvas')).toBeVisible();
  await expect(page.locator('.cw-loading')).toHaveCount(0);
}

test('paused card wall sleeps, redraws controls and resize, and restarts once @mobile', async ({ page }) => {
  await mount(page);
  expect(await step(page)).toBe(1);
  expect(await step(page)).toBe(1);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  expect(await step(page)).toBe(0);
  const paused = await pixels(page);
  expect(await step(page, 60_000)).toBe(0);
  expect(await pixels(page)).toBe(paused);

  await page.getByRole('tab', { name: 'Black', exact: true }).click();
  expect(await pending(page)).toBe(1);
  expect(await step(page)).toBe(0);
  expect(await pixels(page)).not.toBe(paused);

  const width = await page.locator('.cw-canvas').getAttribute('width');
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: Math.floor(viewport.width / 2), height: Math.floor(viewport.height / 2) });
  await expect(page.locator('.cw-canvas')).not.toHaveAttribute('width', width!);
  expect(await pending(page)).toBe(1);
  expect(await step(page)).toBe(0);

  const beforePlay = await pixels(page);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  expect(await pending(page)).toBe(1);
  expect(await step(page, 60_000)).toBe(1);
  expect(await pixels(page)).toBe(beforePlay);
  expect(await step(page, 100)).toBe(1);
  expect(await pixels(page)).not.toBe(beforePlay);
});

test('hidden card wall cancels frames and resumes without advancing hidden time @mobile', async ({ page }) => {
  await mount(page);
  await step(page);
  await step(page, 100);
  const visible = await pixels(page);
  await setHidden(page, true);
  expect(await pending(page)).toBe(0);
  expect(await step(page, 60_000)).toBe(0);
  expect(await pixels(page)).toBe(visible);

  await setHidden(page, false);
  expect(await pending(page)).toBe(1);
  expect(await step(page)).toBe(1);
  expect(await pixels(page)).toBe(visible);
  await step(page, 100);
  expect(await pixels(page)).not.toBe(visible);
});

test('hidden paused card wall defers changes until one visible redraw @mobile', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  expect(await step(page)).toBe(0);
  const visible = await pixels(page);
  await setHidden(page, true);
  await page.getByRole('tab', { name: 'Black', exact: true }).click();
  expect(await pending(page)).toBe(0);
  expect(await pixels(page)).toBe(visible);
  await setHidden(page, false);
  expect(await pending(page)).toBe(1);
  expect(await step(page)).toBe(0);
  expect(await pixels(page)).not.toBe(visible);
});

test('reduced motion paints once and navigation cancels the wall loop @mobile', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(page);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  expect(await step(page)).toBe(0);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  expect(await step(page)).toBe(1);
  await page.locator('.topnav').getByRole('link', { name: 'Archetypes', exact: true }).first().click();
  await expect(page.locator('.cw-canvas')).toHaveCount(0);
  expect(await step(page)).toBe(0);
  await setHidden(page, true);
  await setHidden(page, false);
  expect(await pending(page)).toBe(0);
});

test('a wall mounted hidden waits for visibility before its first frame @mobile', async ({ page }) => {
  await page.addInitScript(() => {
    window.cardWallFrames.hidden = true;
  });
  await mount(page);
  expect(await pending(page)).toBe(0);
  await setHidden(page, false);
  expect(await pending(page)).toBe(1);
  expect(await step(page)).toBe(1);
});

test('images arriving while paused trigger one redraw @mobile', async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route('**/thumbnails/**', async route => {
    await held;
    await route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="274" height="384"><rect width="274" height="384" fill="red"/></svg>'
    });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/tools/card-wall');
  await expect(page.locator('.cw-canvas')).toBeVisible();
  expect(await step(page)).toBe(0);
  const unloaded = await pixels(page);
  release();
  await expect(page.locator('.cw-loading')).toHaveCount(0);
  expect(await pending(page)).toBe(1);
  expect(await step(page)).toBe(0);
  expect(await pixels(page)).not.toBe(unloaded);
});

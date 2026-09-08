import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 360, height: 673 }, isMobile: true, hasTouch: true });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0.99; });
  await page.goto('/');
});

async function point(page, selector, x = 0, y = 0) {
  return page.locator(selector).evaluate((el, { x, y }) => {
    const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM());
    return { x: p.x, y: p.y };
  }, { x, y });
}

async function touch(client, type, points) {
  await client.send('Input.dispatchTouchEvent', { type, touchPoints: points });
}

test('zoom buttons preserve the pitch, enlarge the target, and allow precise dragging and panning', async ({ page, context }) => {
  const field = page.locator('#field');
  const path = await page.locator('#flight-path').getAttribute('d');
  const originalTarget = await point(page, '#target-handle');
  const originalSize = await page.locator('#target-handle circle').nth(1).boundingBox();
  await expect(page.getByRole('button', { name: 'Zoom out of field' })).toBeDisabled();
  await page.getByRole('button', { name: 'Zoom into field' }).tap();
  await expect(page.locator('#zoom-level')).toHaveText('150%');
  const enlarged = await page.locator('#target-handle circle').nth(1).boundingBox();
  expect(enlarged.width / originalSize.width).toBeCloseTo(1.5);
  const target = await point(page, '#target-handle');
  expect(target.x).toBeCloseTo(originalTarget.x);
  expect(target.y).toBeCloseTo(originalTarget.y);
  await expect(page.locator('#flight-path')).toHaveAttribute('d', path);

  const client = await context.newCDPSession(page);
  await touch(client, 'touchStart', [{ ...target, id: 1 }]);
  const destination = await point(page, '#target-plane', 508, 267);
  await touch(client, 'touchMove', [{ ...destination, id: 1 }]);
  await touch(client, 'touchEnd', []);
  const adjusted = await page.locator('#target-handle').evaluate(el => {
    const m = el.transform.baseVal.consolidate().matrix;
    return { x: m.e, y: m.f };
  });
  expect(adjusted.x).toBeCloseTo(508, 0);
  expect(adjusted.y).toBeCloseTo(267, 0);
  const adjustedPath = await page.locator('#flight-path').getAttribute('d');

  const ground = await point(page, '#field', 350, 180);
  const view = await field.getAttribute('viewBox');
  await touch(client, 'touchStart', [{ ...ground, id: 1 }]);
  await touch(client, 'touchMove', [{ x: ground.x + 15, y: ground.y - 5, id: 1 }]);
  await touch(client, 'touchEnd', []);
  await expect(field).not.toHaveAttribute('viewBox', view);
  await expect(page.locator('#flight-path')).toHaveAttribute('d', adjustedPath);
  for (const level of ['225%', '338%', '400%']) {
    await page.locator('#zoom-in').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#zoom-level')).toHaveText(level);
  }
  await expect(page.locator('#zoom-level')).toHaveText('400%');
  await expect(page.locator('#zoom-in')).toBeDisabled();
  await page.locator('#zoom-out').tap();
  await expect(page.locator('#zoom-level')).toHaveText('267%');
  await page.locator('#zoom-reset').focus();
  await page.keyboard.press('Enter');
  await expect(field).toHaveAttribute('viewBox', '0 0 1000 640');
  await expect(page.locator('#flight-path')).toHaveAttribute('d', adjustedPath);
  expect(await page.evaluate(() => [scrollX, scrollY, document.documentElement.scrollHeight])).toEqual([0, 0, 673]);
});

test('pinch replaces a handle drag, keeps its focal point, and never moves the pitch with the remaining finger', async ({ page, context }) => {
  const client = await context.newCDPSession(page);
  const field = page.locator('#field');
  const path = await page.locator('#flight-path').getAttribute('d');
  const start = await point(page, '#target-handle');
  const a = { x: start.x - 8, y: start.y, id: 1 };
  const b = { x: start.x - 88, y: start.y, id: 2 };
  await touch(client, 'touchStart', [{ ...start, id: 1 }]);
  await touch(client, 'touchMove', [a]);
  await expect(page.locator('#flight-path')).not.toHaveAttribute('d', path);
  await touch(client, 'touchStart', [a, b]);
  await expect(page.locator('#flight-path')).toHaveAttribute('d', path);
  const center = { x: (a.x + b.x) / 2, y: a.y };
  const focalPoint = await field.evaluate((el, center) => {
    const p = new DOMPoint(center.x, center.y).matrixTransform(el.getScreenCTM().inverse());
    return { x: p.x, y: p.y };
  }, center);
  const spread = [{ x: a.x + 30, y: a.y, id: 1 }, { x: b.x - 30, y: b.y, id: 2 }];
  await touch(client, 'touchMove', spread);
  await expect(page.locator('#zoom-level')).toHaveText('175%');
  const focalScreen = await point(page, '#field', focalPoint.x, focalPoint.y);
  expect(focalScreen.x).toBeCloseTo(center.x);
  expect(focalScreen.y).toBeCloseTo(center.y);
  await touch(client, 'touchEnd', [spread[0]]);
  const view = await field.getAttribute('viewBox');
  await touch(client, 'touchMove', [{ x: spread[0].x + 10, y: spread[0].y + 10, id: 1 }]);
  await touch(client, 'touchEnd', []);
  await expect(field).toHaveAttribute('viewBox', view);
  await expect(page.locator('#flight-path')).toHaveAttribute('d', path);

  // Cancellation clears both contacts, allowing normal play immediately afterwards.
  await touch(client, 'touchStart', [a, b]);
  await touch(client, 'touchCancel', []);
  await page.locator('#throw-button').tap();
  await expect(page.locator('#total-pitches')).toHaveText('1 PITCH');
  await expect(field).toHaveAttribute('viewBox', view);
  expect(await page.evaluate(() => [scrollX, scrollY, visualViewport.scale])).toEqual([0, 0, 1]);
});

test('zoom remains available through review and rotation, while replay restores the full field', async ({ page }) => {
  await page.locator('#zoom-in').tap();
  const view = await page.locator('#field').getAttribute('viewBox');
  for (let batter = 0; batter < 3; batter++) {
    for (let pitch = 0; pitch < 3; pitch++) {
      await page.locator('#throw-button').tap();
      await expect(page.locator('#ready-status')).not.toHaveText('IN FLIGHT');
    }
    await page.locator('#zoom-out').tap();
    await page.locator('#zoom-in').tap();
    await expect(page.locator('#field')).toHaveAttribute('viewBox', view);
    await page.locator('#next-batter').tap();
  }
  await expect(page.locator('.field-zoom')).toBeHidden();
  await page.locator('#play-again').tap();
  await expect(page.locator('#field')).toHaveAttribute('viewBox', '0 0 1000 640');
  await page.locator('#zoom-in').tap();
  await page.setViewportSize({ width: 740, height: 360 });
  await expect(page.locator('#field')).toHaveAttribute('viewBox', view);
  const box = await page.locator('.field-zoom').boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(360);
  expect(box.x + box.width).toBeLessThanOrEqual(740);
  await page.locator('#zoom-reset').tap();
  expect(await page.evaluate(() => [scrollX, scrollY, document.documentElement.scrollHeight])).toEqual([0, 0, 360]);
});

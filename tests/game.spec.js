import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0.375; });
});

async function setRandom(page, values, fallback = 0.99) {
  await page.evaluate(({ values, fallback }) => {
    let index = 0;
    Math.random = () => values[index++] ?? fallback;
  }, { values, fallback });
}

async function pitch(page, count = 1, advance = true) {
  for (let i = 0; i < count; i++) {
    await page.locator('#throw-button').click();
    await expect(page.locator('#ready-status')).not.toHaveText('IN FLIGHT');
    if (advance && await page.locator('#next-batter').isVisible()) await page.locator('#next-batter').click();
  }
}

test('first batter and restart sample height then hand from browser RNG', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    await context.addInitScript(() => {
      const values = [0.999, 0.499];
      Math.random = () => values.shift() ?? 0.375;
    });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5173');
    await expect(page.locator('#batter-height')).toHaveText('205 cm');
    await expect(page.locator('#batter-hand')).toHaveText('Right-handed batter');
    await setRandom(page, [0, 0.5, 0.123]);
    await page.locator('#pitcher-hand').selectOption('L');
    await expect(page.locator('#batter-height')).toHaveText('205 cm');
    await expect(page.locator('#batter-hand')).toHaveText('Right-handed batter');
    await page.locator('#restart-button').click();
    await expect(page.locator('#batter-height')).toHaveText('165 cm');
    await expect(page.locator('#batter-hand')).toHaveText('Left-handed batter');
    await expect(page.locator('#pitcher-hand')).toHaveValue('L');
    expect(await page.evaluate(() => Math.random())).toBe(0.123);
  } finally {
    await context.close();
  }
});

test('nine called strikes earn a Perfect Win, then replay resets', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await setRandom(page, []);
  await pitch(page, 9);
  await expect(page.locator('#end-title')).toHaveText('Perfect Win.');
  await expect(page.locator('#total-pitches')).toHaveText('9 PITCHES');
  await expect(page.locator('#outs')).toHaveAttribute('aria-label', '3 outs');
  await expect(page.locator('#throw-button')).toBeDisabled();
  await page.locator('#play-again').click();
  await expect(page.locator('#end-screen')).toBeHidden();
  await expect(page.locator('#total-pitches')).toHaveText('0 PITCHES');
  expect(errors).toEqual([]);
});

test('a single can lead to a Normal Win without a run', async ({ page }) => {
  await page.goto('/');
  await setRandom(page, [0, 0.99, 0.99, 0.1, 0.999, 0.5]);
  await pitch(page);
  await expect(page.locator('#hits')).toHaveText('1');
  await expect(page.locator('#base-1')).toHaveClass('occupied');
  await expect(page.locator('#batter-height')).toHaveText('205 cm');
  await expect(page.locator('#batter-hand')).toHaveText('Left-handed batter');
  await pitch(page, 9);
  await expect(page.locator('#end-title')).toHaveText('Normal Win.');
  await expect(page.locator('#runs')).toHaveText('0');
});

test('a home run does not end the inning', async ({ page }) => {
  await page.goto('/');
  await setRandom(page, [0, 0.99, 0.99, 0.99]);
  await pitch(page);
  await expect(page.locator('#runs')).toHaveText('1');
  await expect(page.locator('#end-screen')).toBeHidden();
  await expect(page.locator('#throw-button')).toBeEnabled();
  await pitch(page, 9);
  await expect(page.locator('#end-title')).toHaveText('Inning complete.');
  await expect(page.locator('#outs')).toHaveAttribute('aria-label', '3 outs');
});

test('target and bend controls preserve pitch type and release, with balls and walks', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await page.locator('#field').scrollIntoViewIfNeeded();
  const coordinates = await page.locator('#field').evaluate((svg) => {
    const matrix = svg.querySelector('#target-plane').getScreenCTM();
    return [{ x: 511, y: 264 }, { x: 600, y: 290 }].map((p) => {
      const point = new DOMPoint(p.x, p.y).matrixTransform(matrix);
      return { x: point.x, y: point.y };
    });
  });
  await page.mouse.move(coordinates[0].x, coordinates[0].y);
  await page.mouse.down();
  await page.mouse.move(coordinates[1].x, coordinates[1].y, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('#target-description')).toContainText('outside');
  await expect(page.locator('#release-handle')).toHaveAttribute('transform', 'translate(450 455)');
  const aimedTarget = await page.locator('#target-handle').getAttribute('transform');
  await page.locator('#bend-handle').focus();
  const beforeBend = await page.locator('#flight-path').getAttribute('d');
  await page.keyboard.press('ArrowRight');
  expect(await page.locator('#flight-path').getAttribute('d')).not.toBe(beforeBend);
  await expect(page.locator('#target-handle')).toHaveAttribute('transform', aimedTarget);
  const before = await page.locator('#flight-path').getAttribute('d');
  await page.locator('#spin').fill('-3000');
  await expect(page.locator('#spin-value')).toHaveText('-3,000');
  expect(await page.locator('#flight-path').getAttribute('d')).not.toBe(before);
  await expect(page.locator('[data-preset="fastball"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#target-handle').focus();
  const oldTarget = await page.locator('#target-handle').getAttribute('transform');
  await page.keyboard.press('ArrowLeft');
  expect(await page.locator('#target-handle').getAttribute('transform')).not.toBe(oldTarget);
  await setRandom(page, []);
  await pitch(page, 4);
  await expect(page.locator('#call-title')).toHaveText('Walk');
  await expect(page.locator('#base-1')).toHaveClass('occupied');
  await expect(page.locator('#balls')).toHaveAttribute('aria-label', '0 balls');
  await page.locator('[data-preset="curveball"]').click();
  await expect(page.locator('#speed')).toHaveValue('78');
  await expect(page.locator('#spin')).toHaveValue('-2400');
  const curve = await page.locator('#flight-path').getAttribute('d');
  const curveTarget = await page.locator('#target-handle').getAttribute('transform');
  await page.locator('#bend-handle').focus();
  await page.keyboard.press('Shift+ArrowDown');
  expect(await page.locator('#flight-path').getAttribute('d')).not.toBe(curve);
  await page.locator('#reset-path').click();
  await expect(page.locator('#flight-path')).toHaveAttribute('d', curve);
  await expect(page.locator('#target-handle')).toHaveAttribute('transform', curveTarget);
  await expect(page.locator('[data-preset="curveball"]')).toHaveAttribute('aria-pressed', 'true');
});

test('first-pitch foul preserves immaculate bid; two-strike foul ends it', async ({ page }) => {
  await page.goto('/');
  await setRandom(page, [0, 0.99, 0]);
  await pitch(page);
  await expect(page.locator('#perfect-status')).toContainText('9 pitches.');
  await pitch(page);
  await setRandom(page, [0, 0.99, 0]);
  await pitch(page);
  await expect(page.locator('#strikes')).toHaveAttribute('aria-label', '2 strikes');
  await expect(page.locator('#perfect-status')).toContainText('bid over');
});

test('mobile layout, help, touch target and bend controls, restart, and themes', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5173');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.locator('#help-button').click();
  await expect(page.locator('#help-dialog')).toBeVisible();
  await page.locator('#start-playing').click();
  await expect(page.locator('#help-dialog')).toBeHidden();
  await page.locator('#field').scrollIntoViewIfNeeded();
  const coords = await page.locator('#field').evaluate((svg) => {
    return [{ x: 511, y: 264 }, { x: 490, y: 280 }, { x: 470, y: 260 }].map((p) => {
      const result = new DOMPoint(p.x, p.y).matrixTransform(svg.querySelector('#target-plane').getScreenCTM());
      return { x: result.x, y: result.y };
    });
  });
  const client = await context.newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [coords[0]] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [coords[1]] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [coords[2]] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('#target-description')).toContainText('inside');
  await expect(page.locator('[data-preset="fastball"]')).toHaveAttribute('aria-pressed', 'true');
  const target = await page.locator('#target-handle').getAttribute('transform');
  const curve = await page.locator('#flight-path').getAttribute('d');
  const bendPoint = await page.locator('#bend-handle').evaluate((handle) => {
    const p = new DOMPoint(0, 0).matrixTransform(handle.getScreenCTM());
    return { x: p.x, y: p.y };
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [bendPoint] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bendPoint.x + 6, y: bendPoint.y - 4 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await page.locator('#flight-path').getAttribute('d')).not.toBe(curve);
  await expect(page.locator('#target-handle')).toHaveAttribute('transform', target);
  const releasePoint = await page.locator('#release-handle').evaluate((handle) => {
    const p = new DOMPoint(0, 0).matrixTransform(handle.getScreenCTM());
    return { x: p.x, y: p.y };
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [releasePoint] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: releasePoint.x + 10, y: releasePoint.y + 12 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('#release-handle')).not.toHaveAttribute('transform', 'translate(450 455)');
  await expect(page.locator('#target-handle')).toHaveAttribute('transform', target);
  await setRandom(page, []);
  await pitch(page);
  await page.locator('#restart-button').click();
  await expect(page.locator('#restart-dialog')).toBeVisible();
  await page.locator('#confirm-restart').click();
  await expect(page.locator('#total-pitches')).toHaveText('0 PITCHES');
  await page.locator('#theme-button').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'test-results/mobile-dark.png', fullPage: true });
  await page.locator('#theme-button').click();
  await page.screenshot({ path: 'test-results/mobile-light.png', fullPage: true });
  await context.close();
});

test('desktop presentation has no overflow or remote asset dependency', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const external = [];
  page.on('request', (request) => { if (!request.url().startsWith('http://127.0.0.1')) external.push(request.url()); });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  expect(external).toEqual([]);
});

test('Space throws once and controls lock during the animated flight', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await setRandom(page, []);
  await page.keyboard.press('Space');
  await expect(page.locator('#ready-status')).toHaveText('IN FLIGHT');
  await expect(page.locator('#throw-button')).toBeDisabled();
  await expect(page.locator('#speed')).toBeDisabled();
  await expect(page.locator('#pitcher-hand')).toBeDisabled();
  await page.keyboard.press('Space');
  await expect(page.locator('#ready-status')).toHaveText('READY');
  await expect(page.locator('#total-pitches')).toHaveText('1 PITCH');
  await expect(page.locator('#speed')).toBeEnabled();
  await expect(page.locator('#pitcher-hand')).toBeEnabled();
});

test('small phones keep all controls inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  const bounds = await page.locator('#throw-button').boundingBox();
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(740);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(740);
  await expect(page.locator('#throw-button')).toBeEnabled();
});

for (const viewport of [{ width: 320, height: 568 }, { width: 360, height: 673 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 740, height: 360 }, { width: 873, height: 360 }]) {
  test(`complete mobile inning without scrolling at ${viewport.width}x${viewport.height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.addInitScript(() => { Math.random = () => 0.99; });
    await page.goto('http://127.0.0.1:5173');
    const fits = async (selectors) => {
      expect(await page.evaluate(() => ({ x: scrollX, y: scrollY, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))).toEqual({ x: 0, y: 0, ...viewport });
      for (const selector of selectors) {
        const box = await page.locator(selector).boundingBox();
        expect(box, selector).not.toBeNull();
        expect(box.x, selector).toBeGreaterThanOrEqual(0);
        expect(box.y, selector).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, selector).toBeLessThanOrEqual(viewport.width);
        expect(box.y + box.height, selector).toBeLessThanOrEqual(viewport.height);
      }
    };
    // Tap screen coordinates so Playwright cannot silently scroll controls into view.
    const tap = async (selector) => {
      await fits([selector]);
      const box = await page.locator(selector).boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    };
    await fits(['#difficulty', '#pitcher-hand', '#pitcher-height', '#speed', '#spin', '#reset-path', '#throw-button', '.pitch-presets', '#field', '.field-zoom']);
    await page.locator('#difficulty').selectOption('relief');
    await page.locator('#pitcher-height').fill('210');
    await page.locator('#pitcher-hand').selectOption('L');
    await tap('[data-preset="curveball"]');
    await page.locator('#speed').fill('30');
    await page.locator('#spin').fill('-3000');
    const client = await context.newCDPSession(page);
    for (const id of ['release', 'bend', 'target']) {
      const handle = page.locator(`#${id}-handle`);
      const before = await handle.getAttribute('transform');
      const start = await handle.evaluate((el) => {
        const p = new DOMPoint(0, 0).matrixTransform(el.getScreenCTM());
        return { x: p.x, y: p.y };
      });
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x - 5, y: start.y + 3 }] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(handle).not.toHaveAttribute('transform', before);
      await fits(['#throw-button']);
    }
    await tap('#restart-button');
    await expect(page.locator('#pitcher-height')).toHaveValue('210');
    for (let batter = 0; batter < 3; batter++) {
      for (let count = 0; count < 3; count++) {
        await tap('#throw-button');
        await expect(page.locator('#pitcher-height')).toBeDisabled();
        await expect(page.locator('#ready-status')).not.toHaveText('IN FLIGHT');
      }
      await fits(['#next-batter', '#pitch-chart', '#field']);
      await tap('#next-batter');
    }
    await expect(page.locator('#end-title')).toHaveText('Perfect Win.');
    await fits(['#end-screen', '#play-again', '#history-button']);
    await tap('#history-button');
    await expect(page.locator('#history-dialog')).toBeVisible();
    await expect(page.locator('#results-table .result-pitch')).toHaveCount(9);
    await page.getByRole('button', { name: 'Back to game' }).click();
    await tap('#play-again');
    await fits(['#throw-button', '#speed', '#spin']);
    await expect(page.locator('#pitcher-height')).toBeEnabled();
    await context.close();
  });
}

test('CGSO finishes the top of the ninth with a 1-0 lead without a Save badge', async ({ page }) => {
  await page.goto('/');
  await page.locator('#difficulty').selectOption({ label: 'CGSO' });
  await expect(page.locator('#inning-name')).toHaveText('Top of the 9th');
  await expect(page.locator('#player-score')).toHaveText('1');
  await expect(page.locator('#opponent-score')).toHaveText('0');
  await setRandom(page, []);
  await pitch(page, 9);
  await expect(page.locator('#end-title')).toHaveText('Perfect Win.');
  await expect(page.locator('#end-save')).toBeHidden();
  await expect(page.locator('#end-detail')).toContainText('Complete-game shutout');
  await page.locator('#play-again').click();
  await expect(page.locator('#difficulty')).toHaveValue('cgso');
  await setRandom(page, [0, 0.99, 0.99, 0.99]);
  await pitch(page);
  await expect(page.locator('#opponent-score')).toHaveText('1');
  await expect(page.locator('#end-screen')).toBeHidden();
  await pitch(page, 9);
  await expect(page.locator('#end-title')).toHaveText('Inning complete.');
  await expect(page.locator('#end-detail')).toContainText('tying run');
  await expect(page.locator('#end-save')).toBeHidden();
});

test('relief normal and perfect wins both earn a Save and replay preserves the mode', async ({ page }) => {
  await page.goto('/');
  await page.locator('#difficulty').selectOption('relief');
  await expect(page.locator('#player-score')).toHaveText('4');
  await expect(page.locator('#opponent-score')).toHaveText('3');
  await expect(page.locator('#runs')).toHaveText('0');
  await expect(page.locator('#save-status')).toHaveText('Save opportunity');
  await setRandom(page, []);
  await pitch(page, 9);
  await expect(page.locator('#end-title')).toHaveText('Perfect Win.');
  await expect(page.locator('#end-save')).toHaveText('Save');
  await page.locator('#play-again').click();
  await expect(page.locator('#difficulty')).toHaveValue('relief');
  await expect(page.locator('#save-status')).toHaveText('Save opportunity');
  await setRandom(page, [0, 0.99, 0.99, 0.1]);
  await pitch(page, 10);
  await expect(page.locator('#end-title')).toHaveText('Normal Win.');
  await expect(page.locator('#end-save')).toHaveText('Save');
  await expect(page.locator('#opponent-score')).toHaveText('3');
  await page.locator('#difficulty').selectOption('exhibition');
  await expect(page.locator('#end-screen')).toBeHidden();
  await expect(page.locator('#save-status')).toBeHidden();
  await expect(page.locator('#player-score')).toHaveText('0');
  await expect(page.locator('#opponent-score')).toHaveText('0');
});

test('relief tying run is a Blown Save; play continues to three outs on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#difficulty').selectOption('relief');
  await setRandom(page, [0, 0.99, 0.99, 0.99]);
  await pitch(page);
  await expect(page.locator('#opponent-score')).toHaveText('4');
  await expect(page.locator('#save-status')).toHaveText('Blown Save');
  await expect(page.locator('#end-screen')).toBeHidden();
  await expect(page.locator('#throw-button')).toBeEnabled();
  await pitch(page, 9);
  await expect(page.locator('#end-title')).toHaveText('Inning complete.');
  await expect(page.locator('#end-save')).toHaveText('Blown Save');
  await expect(page.locator('#outs')).toHaveAttribute('aria-label', '3 outs');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.locator('#end-screen').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/relief-mobile.png', fullPage: true });
  await page.locator('#play-again').click();
  await expect(page.locator('#opponent-score')).toHaveText('3');
  await expect(page.locator('#save-status')).toHaveText('Save opportunity');
});

test('easy relief allows two runs for a Relief Win and blows the save on the third', async ({ page }) => {
  await page.goto('/');
  await page.locator('#difficulty').selectOption('relief-easy');
  await expect(page.locator('#player-score')).toHaveText('4');
  await expect(page.locator('#opponent-score')).toHaveText('1');
  await expect(page.locator('#save-status')).toHaveText('Save opportunity');
  await expect(page.locator('.objective')).toContainText('allow two runs total');

  const homeRun = [0, 0.99, 0.99, 0.99, 0.375, 0.375];
  await setRandom(page, homeRun);
  await pitch(page);
  await pitch(page, 9);
  await expect(page.locator('#end-title')).toHaveText('Relief Win.');
  await expect(page.locator('#end-save')).toHaveText('Save');
  await expect(page.locator('#end-detail')).toContainText('allowed 1 run, protected the lead, and earned the save');

  await page.locator('#play-again').click();
  await setRandom(page, [...homeRun, ...homeRun]);
  await pitch(page, 2);
  await expect(page.locator('#opponent-score')).toHaveText('3');
  await expect(page.locator('#save-status')).toHaveText('Save opportunity');
  await expect(page.locator('.objective')).toContainText('allow two runs total');
  await pitch(page, 9);
  await expect(page.locator('#end-title')).toHaveText('Relief Win.');
  await expect(page.locator('#end-save')).toHaveText('Save');
  await expect(page.locator('#end-detail')).toContainText('allowed 2 runs, protected the lead, and earned the save');

  await page.locator('#play-again').click();
  await expect(page.locator('#difficulty')).toHaveValue('relief-easy');
  await expect(page.locator('#opponent-score')).toHaveText('1');
  await setRandom(page, [...homeRun, ...homeRun, ...homeRun]);
  await pitch(page, 3);
  await expect(page.locator('#opponent-score')).toHaveText('4');
  await expect(page.locator('#save-status')).toHaveText('Blown Save');
  await expect(page.locator('#end-screen')).toBeHidden();
  await pitch(page, 9);
  await expect(page.locator('#end-title')).toHaveText('Inning complete.');
  await expect(page.locator('#end-save')).toHaveText('Blown Save');
  await expect(page.locator('#end-detail')).toContainText('tying run');
});

test('switching scenarios confirms a reset, cancel and Escape preserve the inning', async ({ page }) => {
  await page.goto('/');
  await setRandom(page, []);
  await pitch(page);
  await page.locator('#difficulty').selectOption('relief');
  await expect(page.locator('#restart-dialog')).toBeVisible();
  await page.locator('#cancel-restart').click();
  await expect(page.locator('#difficulty')).toHaveValue('exhibition');
  await expect(page.locator('#total-pitches')).toHaveText('1 PITCH');
  await page.locator('#difficulty').selectOption('cgso');
  await page.keyboard.press('Escape');
  await expect(page.locator('#difficulty')).toHaveValue('exhibition');
  await page.locator('#difficulty').selectOption('relief');
  await page.locator('#confirm-restart').click();
  await expect(page.locator('#difficulty')).toHaveValue('relief');
  await expect(page.locator('#total-pitches')).toHaveText('0 PITCHES');
  await expect(page.locator('#player-score')).toHaveText('4');
  await pitch(page);
  await page.locator('#restart-button').click();
  await page.locator('#confirm-restart').click();
  await expect(page.locator('#difficulty')).toHaveValue('relief');
  await expect(page.locator('#total-pitches')).toHaveText('0 PITCHES');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('#throw-button').click();
  await expect(page.locator('#difficulty')).toBeDisabled();
  await expect(page.locator('#ready-status')).toHaveText('READY');
  await expect(page.locator('#difficulty')).toBeEnabled();
});

test('empty field no longer draws, curve dragging reshapes, and cancelled drags restore the curve', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await page.locator('#field').scrollIntoViewIfNeeded();
  const original = await page.locator('#flight-path').getAttribute('d');
  const coords = await page.locator('#field').evaluate((svg) => [
    { x: 700, y: 430 }, { x: 750, y: 350 },
  ].map((p) => {
    const result = new DOMPoint(p.x, p.y).matrixTransform(svg.getScreenCTM());
    return { x: result.x, y: result.y };
  }));
  await page.mouse.move(coords[0].x, coords[0].y);
  await page.mouse.down();
  await page.mouse.move(coords[1].x, coords[1].y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#flight-path')).toHaveAttribute('d', original);
  const onCurve = await page.locator('#flight-path').evaluate((path) => {
    const p = path.getPointAtLength(path.getTotalLength() * 0.25);
    const result = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM());
    return { x: result.x, y: result.y };
  });
  await page.mouse.move(onCurve.x, onCurve.y);
  await page.mouse.down();
  await page.mouse.move(onCurve.x + 12, onCurve.y - 8, { steps: 5 });
  await page.mouse.up();
  expect(await page.locator('#flight-path').getAttribute('d')).not.toBe(original);
  const beforeCancel = await page.locator('#flight-path').getAttribute('d');
  const handle = await page.locator('#bend-handle').evaluate((el) => {
    const point = new DOMPoint(0, 0).matrixTransform(el.getScreenCTM());
    return { x: point.x, y: point.y };
  });
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x - 20, handle.y + 12, { steps: 5 });
  await page.locator('#field').dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  await expect(page.locator('#flight-path')).toHaveAttribute('d', beforeCancel);
});

test('release drag moves hand and flight origin, persists across pitch types, and resets with the inning', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await page.locator('#field').scrollIntoViewIfNeeded();
  const target = await page.locator('#target-handle').getAttribute('transform');
  const originalArm = await page.locator('#throwing-arm').getAttribute('d');
  const position = await page.locator('#release-handle').evaluate((handle) => {
    const p = new DOMPoint(0, 0).matrixTransform(handle.getScreenCTM());
    return { x: p.x, y: p.y };
  });
  await page.mouse.move(position.x, position.y);
  await page.mouse.down();
  await page.mouse.move(position.x + 35, position.y + 25, { steps: 10 });
  await page.mouse.up();
  const release = await page.locator('#release-handle').getAttribute('transform');
  expect(release).not.toBe('translate(450 455)');
  expect(await page.locator('#throwing-arm').getAttribute('d')).not.toBe(originalArm);
  await expect(page.locator('#target-handle')).toHaveAttribute('transform', target);
  const origin = await page.locator('#flight-path').evaluate((path) => {
    const p = path.getPointAtLength(0);
    const hand = document.querySelector('#throwing-hand');
    const projected = new DOMPoint(Number(hand.getAttribute('cx')), Number(hand.getAttribute('cy'))).matrixTransform(hand.getCTM()).matrixTransform(path.getCTM().inverse());
    return Math.hypot(p.x - projected.x, p.y - projected.y);
  });
  expect(origin).toBeLessThan(0.1);
  await page.locator('[data-preset="slider"]').click();
  await page.locator('#spin').fill('500');
  await page.locator('#reset-path').click();
  await expect(page.locator('#release-handle')).toHaveAttribute('transform', release);
  await expect(page.locator('#target-handle')).toHaveAttribute('transform', target);
  await page.locator('#release-handle').focus();
  await page.keyboard.press('Shift+ArrowUp');
  await expect(page.locator('#release-handle')).not.toHaveAttribute('transform', release);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await setRandom(page, []);
  await page.locator('#throw-button').click();
  await expect(page.locator('#release-handle')).toHaveAttribute('tabindex', '-1');
  await expect(page.locator('#ready-status')).toHaveText('READY');
  await expect(page.locator('#release-handle')).toHaveAttribute('tabindex', '0');
  await page.locator('#restart-button').click();
  await page.locator('#confirm-restart').click();
  await expect(page.locator('#release-handle')).toHaveAttribute('transform', 'translate(450 455)');
});

test('release is bounded to the arm area and cancelled drags restore the hand', async ({ page }) => {
  await page.goto('/');
  await page.locator('#release-handle').focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('Shift+ArrowRight');
  for (let i = 0; i < 20; i++) await page.keyboard.press('Shift+ArrowDown');
  await expect(page.locator('#release-handle')).toHaveAttribute('transform', 'translate(550 515)');
  await page.locator('#field').scrollIntoViewIfNeeded();
  const position = await page.locator('#release-handle').evaluate((handle) => {
    const p = new DOMPoint(0, 0).matrixTransform(handle.getScreenCTM());
    return { x: p.x, y: p.y };
  });
  await page.mouse.move(position.x, position.y);
  await page.mouse.down();
  await page.mouse.move(position.x - 30, position.y - 30, { steps: 5 });
  await page.locator('#field').dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  await expect(page.locator('#release-handle')).toHaveAttribute('transform', 'translate(550 515)');
  await expect(page.locator('#throwing-hand')).toHaveAttribute('cx', '550');
  await expect(page.locator('#throwing-hand')).toHaveAttribute('cy', '515');
});

test('pitcher height scales the body, release, bounds, and flight while keeping aim', async ({ page }) => {
  await page.goto('/');
  const aim = await page.locator('#target-handle').getAttribute('transform');
  const original = await page.locator('#flight-path').getAttribute('d');
  await page.locator('#pitcher-height').fill('210');
  await expect(page.locator('#pitcher-height-value')).toHaveText('210 cm');
  await expect(page.locator('#pitcher')).toHaveAttribute('transform', 'translate(0 580) scale(1 1.1666666666666667) translate(0 -580)');
  await expect(page.locator('#target-handle')).toHaveAttribute('transform', aim);
  expect(await page.locator('#flight-path').getAttribute('d')).not.toBe(original);
  const handMatches = await page.locator('#throwing-hand').evaluate((hand) => {
    const p = new DOMPoint(Number(hand.getAttribute('cx')), Number(hand.getAttribute('cy'))).matrixTransform(hand.getCTM());
    const release = new DOMPoint(0, 0).matrixTransform(document.querySelector('#release-handle').getCTM());
    return Math.hypot(p.x - release.x, p.y - release.y);
  });
  expect(handMatches).toBeLessThan(0.01);
  await page.locator('#release-handle').focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('Shift+ArrowUp');
  const y = await page.locator('#release-handle').evaluate((handle) => handle.transform.baseVal.consolidate().matrix.f);
  expect(y).toBeCloseTo(580 + (405 - 580) * 210 / 180);
  await page.locator('[data-preset="curveball"]').click();
  await expect(page.locator('#pitcher-height')).toHaveValue('210');
  await page.locator('#pitcher-height').fill('160');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await setRandom(page, []);
  await page.locator('#throw-button').click();
  await expect(page.locator('#pitcher-height')).toBeDisabled();
  await expect(page.locator('#ready-status')).toHaveText('READY');
  await expect(page.locator('#pitcher-height')).toBeDisabled();
  await expect(page.locator('#pitcher-height-status')).toBeVisible();
  await expect(page.locator('#pitcher-height-status')).toHaveText('Locked for this inning');
  await expect(page.locator('#pitcher-height')).toHaveCSS('cursor', 'not-allowed');
  await page.locator('#restart-button').click();
  await page.locator('#confirm-restart').click();
  await expect(page.locator('#pitcher-height')).toBeEnabled();
  await expect(page.locator('#pitcher-height-status')).toBeHidden();
  await expect(page.locator('#pitcher-height')).toHaveValue('160');
});

test('batter height and visible zone change between batters, not pitches, and drive calls', async ({ page }) => {
  await page.goto('/');
  // Three called strikes, a 165 cm/L batter, four balls, then a 198 cm/R batter.
  await setRandom(page, [0.99, 0.99, 0.99, 0, 0.5, 0.99, 0.99, 0.99, 0.99, 33 / 41, 0.499]);
  await expect(page.locator('#batter-height')).toHaveText('180 cm');
  await expect(page.locator('#strike-zone rect')).toHaveAttribute('y', '243');
  await expect(page.locator('#strike-zone rect')).toHaveAttribute('height', '90');
  await pitch(page, 2);
  await expect(page.locator('#batter-height')).toHaveText('180 cm');
  await pitch(page);
  await expect(page.locator('#batter-height')).toHaveText('165 cm');
  await expect(page.locator('#batter-hand')).toHaveText('Left-handed batter');
  await expect(page.locator('#batter-number')).toHaveText('BATTER 02');
  await expect(page.locator('#target-handle')).toHaveAttribute('transform', 'translate(511 264)');
  const alignment = await page.locator('#batter').evaluate((batter) => {
    const shoulder = new DOMPoint(402, 243).matrixTransform(batter.transform.baseVal.consolidate().matrix);
    const knees = new DOMPoint(402, 333).matrixTransform(batter.transform.baseVal.consolidate().matrix);
    const zone = document.querySelector('#strike-zone rect');
    return { shoulder: shoulder.y, knees: knees.y, y: Number(zone.getAttribute('y')), bottom: Number(zone.getAttribute('y')) + Number(zone.getAttribute('height')) };
  });
  expect(alignment.y).toBeCloseTo(alignment.shoulder);
  expect(alignment.bottom).toBeCloseTo(alignment.knees);
  await page.locator('#target-handle').focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowUp');
  await expect(page.locator('#target-handle')).toHaveAttribute('transform', 'translate(511 240)');
  await expect(page.locator('#target-description')).toContainText('outside');
  await pitch(page, 4);
  await expect(page.locator('#call-title')).toHaveText('Walk');
  await expect(page.locator('#batter-height')).toHaveText('198 cm');
  await expect(page.locator('#batter-hand')).toHaveText('Right-handed batter');
  await expect(page.locator('#target-description')).toContainText('inside');
  await pitch(page);
  await expect(page.locator('#call-title')).toHaveText('Called strike');
  await expect(page.locator('#batter-height')).toHaveText('198 cm');
});

test('slow curveballs gain an eephus arc without moving release or target and can be thrown', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-preset="curveball"]').click();
  const release = await page.locator('#release-handle').getAttribute('transform');
  const target = await page.locator('#target-handle').getAttribute('transform');
  const normalBend = await page.locator('#bend-handle').evaluate((el) => el.transform.baseVal.consolidate().matrix.f);
  await page.locator('#speed').fill('30');
  await expect(page.locator('#speed-help')).toContainText('Eephus range');
  const slowBend = await page.locator('#bend-handle').evaluate((el) => el.transform.baseVal.consolidate().matrix.f);
  expect(slowBend).toBeLessThan(normalBend - 150);
  await expect(page.locator('#release-handle')).toHaveAttribute('transform', release);
  await expect(page.locator('#target-handle')).toHaveAttribute('transform', target);
  await page.locator('#bend-handle').focus();
  await page.keyboard.press('Shift+ArrowUp');
  await page.screenshot({ path: 'test-results/eephus.png', fullPage: true });
  await setRandom(page, []);
  await pitch(page);
  await expect(page.locator('#call-title')).toHaveText('Called strike');
  await expect(page.locator('#pitch-log')).toContainText('30 MPH');
});

test('all pitches permit large downward bend adjustments and an upward finish', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  for (const type of ['fastball', 'curveball', 'slider']) {
    await page.locator(`[data-preset="${type}"]`).click();
    const minSpeed = type === 'curveball' ? '30' : '60';
    await page.locator('#speed').fill(minSpeed);
    const original = await page.locator('#flight-path').getAttribute('d');
    await page.locator('#bend-handle').focus();
    for (let i = 0; i < 20; i++) await page.keyboard.press('Shift+ArrowDown');
    const rises = await page.locator('#flight-path').evaluate((path) => {
      const length = path.getTotalLength();
      const end = path.getPointAtLength(length);
      const late = path.getPointAtLength(length * 0.85);
      // Remove the ground-axis slope when measuring vertical ride in the angled view.
      return late.y - 0.275 * late.x > end.y - 0.275 * end.x + 10;
    });
    expect(rises).toBe(true);
    await expect(page.locator(`[data-preset="${type}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#target-description')).toContainText('inside');
    await page.locator('#reset-path').click();
    await expect(page.locator('#flight-path')).toHaveAttribute('d', original);
    await expect(page.locator('#speed')).toHaveValue(minSpeed);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('velocity bounds and labels follow pitch type and allow both endpoints', async ({ page }) => {
  await page.goto('/');
  await setRandom(page, []);
  for (const [type, min, max, preset] of [['fastball', 60, 120, 92], ['slider', 60, 99, 86], ['curveball', 30, 90, 78]]) {
    await page.locator(`[data-preset="${type}"]`).click();
    await expect(page.locator('#speed')).toHaveAttribute('min', String(min));
    await expect(page.locator('#speed')).toHaveAttribute('max', String(max));
    await expect(page.locator('#speed')).toHaveValue(String(preset));
    await expect(page.locator('#speed-limits')).toContainText(String(min));
    await expect(page.locator('#speed-limits')).toContainText(String(max));
    for (const speed of [min, max]) {
      await page.locator('#speed').fill(String(speed));
      await expect(page.locator('#speed-value')).toHaveText(String(speed));
      await pitch(page);
      await expect(page.locator('#pitch-log')).toContainText(`${speed} MPH`);
    }
  }
});

test('angled projection aligns release, bend, target and flight in screen space', async ({ page }) => {
  await page.goto('/');
  await page.locator('#pitcher-height').fill('210');
  await page.locator('[data-preset="curveball"]').click();
  await page.locator('#speed').fill('30');
  const geometry = await page.locator('#field').evaluate((svg) => {
    const path = svg.querySelector('#flight-path');
    const screen = (point, element) => new DOMPoint(point.x, point.y).matrixTransform(element.getScreenCTM());
    const release = screen({ x: 0, y: 0 }, svg.querySelector('#release-handle'));
    const target = screen({ x: 0, y: 0 }, svg.querySelector('#target-handle'));
    const start = screen(path.getPointAtLength(0), path);
    const end = screen(path.getPointAtLength(path.getTotalLength()), path);
    const bend = screen({ x: 0, y: 0 }, svg.querySelector('#bend-handle'));
    let nearest = Infinity;
    for (let i = 0; i <= 500; i++) {
      const point = screen(path.getPointAtLength(path.getTotalLength() * i / 500), path);
      nearest = Math.min(nearest, Math.hypot(point.x - bend.x, point.y - bend.y));
    }
    return { startGap: Math.hypot(start.x - release.x, start.y - release.y), endGap: Math.hypot(end.x - target.x, end.y - target.y), bendGap: nearest, horizontalSeparation: target.x - release.x };
  });
  expect(geometry.startGap).toBeLessThan(0.1);
  expect(geometry.endGap).toBeLessThan(0.1);
  expect(geometry.bendGap).toBeLessThan(2);
  expect(geometry.horizontalSeparation).toBeGreaterThan(150);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await setRandom(page, []);
  await page.locator('#throw-button').click();
  await expect(page.locator('#moving-ball')).toHaveAttribute('visibility', 'visible');
  await expect(page.locator('#ready-status')).toHaveText('READY');
  const landingGap = await page.locator('#moving-ball').evaluate((ball) => {
    const end = new DOMPoint(0, 0).matrixTransform(ball.getScreenCTM());
    const target = new DOMPoint(0, 0).matrixTransform(document.querySelector('#target-handle').getScreenCTM());
    return Math.hypot(end.x - target.x, end.y - target.y);
  });
  expect(landingGap).toBeLessThan(0.1);
});

test('at-bat trails retain exact flights through adjustments and fouls, then clear on a new batter', async ({ page }) => {
  await page.goto('/');
  await setRandom(page, []);
  const first = await page.locator('#flight-path').getAttribute('d');
  await pitch(page);
  await expect(page.locator('.pitch-trail')).toHaveCount(1);
  await expect(page.locator('.pitch-trail path')).toHaveAttribute('d', first);
  await page.locator('[data-preset="curveball"]').click();
  await page.locator('#speed').fill('30');
  await expect(page.locator('.pitch-trail path')).toHaveAttribute('d', first);
  const second = await page.locator('#flight-path').getAttribute('d');
  await pitch(page);
  await expect(page.locator('.pitch-trail')).toHaveCount(2);
  await expect(page.locator('.pitch-trail path').nth(1)).toHaveAttribute('d', second);
  await setRandom(page, [0, 0.99, 0]);
  await pitch(page);
  await expect(page.locator('.pitch-trail')).toHaveCount(3);
  await expect(page.locator('.pitch-trail text').nth(2)).toHaveText('3F');
  await pitch(page);
  await expect(page.locator('#call-title')).toHaveText('Strikeout');
  await expect(page.locator('.pitch-trail')).toHaveCount(0);
  await pitch(page);
  await expect(page.locator('.pitch-trail text')).toHaveText('1S');
  await page.locator('#restart-button').click();
  await page.locator('#confirm-restart').click();
  await expect(page.locator('.pitch-trail')).toHaveCount(0);
});

test('hits and walks clear the previous at-bat trajectories', async ({ page }) => {
  await page.goto('/');
  await setRandom(page, []);
  await pitch(page);
  await setRandom(page, [0, 0.99, 0.99, 0.1]);
  await pitch(page);
  await expect(page.locator('#call-title')).toHaveText('Single');
  await expect(page.locator('.pitch-trail')).toHaveCount(0);
  await page.locator('#target-handle').focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('Shift+ArrowRight');
  await pitch(page, 3);
  await expect(page.locator('.pitch-trail')).toHaveCount(3);
  await pitch(page);
  await expect(page.locator('#call-title')).toHaveText('Walk');
  await expect(page.locator('.pitch-trail')).toHaveCount(0);
});

test('completed at-bats pause with every trail and the old zone until Next batter', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await setRandom(page, [0.99, 0.99, 0.99, 0, 0.5]);
  await pitch(page, 3, false);
  await expect(page.locator('#review-title')).toHaveText('Strikeout');
  await expect(page.locator('.pitch-trail')).toHaveCount(3);
  await expect(page.locator('#batter-height')).toHaveText('180 cm');
  await expect(page.locator('#batter-hand')).toHaveText('Right-handed batter');
  await expect(page.locator('#batter-number')).toHaveText('BATTER 01');
  await expect(page.locator('#strike-zone rect')).toHaveAttribute('height', '90');
  await expect(page.locator('#throw-button')).toBeDisabled();
  await expect(page.locator('#speed')).toBeDisabled();
  await expect(page.locator('#flight-path')).toBeHidden();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Space');
  await expect(page.locator('#total-pitches')).toHaveText('3 PITCHES');
  // The next batter was already sampled at resolution, not on leaving review.
  await setRandom(page, [0.99, 0.99, 0.99, 33 / 41, 0.499]);
  await page.locator('#next-batter').click();
  await expect(page.locator('.pitch-trail')).toHaveCount(0);
  await expect(page.locator('#batter-height')).toHaveText('165 cm');
  await expect(page.locator('#batter-hand')).toHaveText('Left-handed batter');
  await expect(page.locator('#throw-button')).toBeEnabled();
  await pitch(page, 3, false);
  await expect(page.locator('#batter-height')).toHaveText('165 cm');
  await expect(page.locator('#batter-hand')).toHaveText('Left-handed batter');
  await page.locator('#next-batter').click();
  await expect(page.locator('#batter-height')).toHaveText('198 cm');
  await expect(page.locator('#batter-hand')).toHaveText('Right-handed batter');
  await setRandom(page, [0.99, 0.99, 0.99, 0.123, 0.456]);
  await pitch(page, 3, false);
  await expect(page.locator('#next-batter')).toContainText('View results');
  await expect(page.locator('#end-screen')).toBeHidden();
  await expect(page.locator('.pitch-trail')).toHaveCount(3);
  await expect(page.locator('#batter-height')).toHaveText('198 cm');
  await expect(page.locator('#batter-hand')).toHaveText('Right-handed batter');
  await page.locator('#next-batter').click();
  await expect(page.locator('#end-title')).toHaveText('Perfect Win.');
  expect(await page.evaluate(() => [Math.random(), Math.random()])).toEqual([0.123, 0.456]);
  const groups = page.locator('#results-table .batter-group');
  await expect(groups.nth(0)).toContainText('180 cm / RHB');
  await expect(groups.nth(1)).toContainText('165 cm / LHB');
  await expect(groups.nth(2)).toContainText('198 cm / RHB');
});

test('a hit pauses for review and restarting during review restores pitching', async ({ page }) => {
  await page.goto('/');
  await setRandom(page, [0, 0.99, 0.99, 0.1, 0, 0.5]);
  await pitch(page, 1, false);
  await expect(page.locator('#review-title')).toHaveText('Single');
  await expect(page.locator('.pitch-trail')).toHaveCount(1);
  await expect(page.locator('#batter-height')).toHaveText('180 cm');
  await expect(page.locator('#batter-hand')).toHaveText('Right-handed batter');
  await setRandom(page, [33 / 41, 0.499]);
  await page.locator('#restart-button').click();
  await page.locator('#confirm-restart').click();
  await expect(page.locator('#at-bat-review')).toBeHidden();
  await expect(page.locator('.pitch-trail')).toHaveCount(0);
  await expect(page.locator('#throw-button')).toBeEnabled();
  await expect(page.locator('#batter-height')).toHaveText('198 cm');
  await expect(page.locator('#batter-hand')).toHaveText('Right-handed batter');
});

test('trail endpoints distinguish strikes, two-strike fouls, hits, balls and in-play outs', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.trail-legend')).toContainText('Foul with two strikes');
  await setRandom(page, [0, 0.99, 0]);
  await pitch(page);
  await expect(page.locator('.pitch-trail').last()).toHaveAttribute('data-result', 'strike');
  await expect(page.locator('.pitch-trail circle').last()).toHaveAttribute('fill', '#FF7F0E');
  await expect(page.locator('.chart-pitch circle').last()).toHaveAttribute('fill', '#FF7F0E');
  await setRandom(page, [0, 0.99, 0]);
  await pitch(page);
  await expect(page.locator('.pitch-trail').last()).toHaveAttribute('data-result', 'strike');
  await setRandom(page, [0, 0.99, 0]);
  await pitch(page);
  await expect(page.locator('.pitch-trail').last()).toHaveAttribute('data-result', 'two-strike-foul');
  await expect(page.locator('.pitch-trail circle').last()).toHaveAttribute('fill', '#2CA02C');
  await expect(page.locator('.chart-pitch circle').last()).toHaveAttribute('fill', '#2CA02C');
  await setRandom(page, [0, 0.99, 0.99, 0.99]);
  await pitch(page, 1, false);
  await expect(page.locator('.pitch-trail circle').last()).toHaveAttribute('fill', '#D62728');
  await expect(page.locator('.chart-pitch circle').last()).toHaveAttribute('fill', '#D62728');
  await expect(page.locator('.pitch-trail').last()).toHaveAttribute('aria-label', /Hit, Home run/);
  await page.locator('#next-batter').click();
  await page.locator('#target-handle').focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('Shift+ArrowRight');
  await setRandom(page, []);
  await pitch(page, 4, false);
  await expect(page.locator('.pitch-trail circle').last()).toHaveAttribute('fill', '#1F77B4');
  await expect(page.locator('.chart-pitch circle').last()).toHaveAttribute('fill', '#1F77B4');
  await expect(page.locator('.pitch-trail').last()).toHaveAttribute('aria-label', /Ball, Walk/);
  await page.locator('#next-batter').click();
  await setRandom(page, [0, 0, 0, 0.99, 0.5]);
  await pitch(page);
  await expect(page.locator('.pitch-trail').last()).toHaveAttribute('data-result', 'strike');
  await pitch(page, 1, false);
  await expect(page.locator('.pitch-trail circle').last()).toHaveAttribute('fill', '#9467BD');
  await expect(page.locator('.chart-pitch circle').last()).toHaveAttribute('fill', '#9467BD');
  await expect(page.locator('.pitch-trail').last()).toHaveAttribute('data-result', 'out');
  await expect(page.locator('#pitch-log .log-pitch').first()).toHaveAttribute('data-result', 'out');
  for (const entry of await page.locator('#pitch-log .log-pitch').all()) {
    const type = await entry.getAttribute('data-result');
    const colors = { strike: '#FF7F0E', ball: '#1F77B4', hit: '#D62728', 'two-strike-foul': '#2CA02C', out: '#9467BD' };
    await expect(entry.locator('.log-outcome')).toHaveAttribute('style', `--outcome-color:${colors[type]}`);
  }
});

test('pitch chart records true locations, retains review, and resets for each batter', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#chart-empty')).toBeVisible();
  await expect(page.locator('#chart-batter b')).toHaveText('RHB');
  const rightHandedPose = await page.locator('#chart-batter-icon').getAttribute('transform');
  const icon = await page.locator('#chart-batter-icon').boundingBox();
  const zone = await page.locator('#chart-zone').boundingBox();
  expect(icon.x + icon.width).toBeLessThan(zone.x);
  await setRandom(page, []);
  await pitch(page, 2);
  await expect(page.locator('.chart-pitch text')).toHaveText(['1', '2']);
  await expect(page.locator('#chart-sequence li')).toHaveText(['1', '2']);
  await expect(page.locator('.chart-pitch circle').first()).toHaveAttribute('cx', '511');
  await expect(page.locator('.chart-pitch circle').first()).toHaveAttribute('cy', '264');
  await page.locator('#target-handle').focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('Shift+ArrowRight');
  await pitch(page);
  await expect(page.locator('.chart-pitch circle').last()).toHaveAttribute('cx', '650');
  await expect(page.locator('#pitch-chart-plot')).toHaveAttribute('viewBox', '390 200 276 180');
  await page.locator('#target-handle').focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('Shift+ArrowLeft');
  await setRandom(page, [0.99, 0, 0.5]);
  await pitch(page, 1, false);
  await expect(page.locator('#review-title')).toHaveText('Strikeout');
  await expect(page.locator('.chart-pitch')).toHaveCount(4);
  await expect(page.locator('#chart-batter')).toHaveText('BATTER 01RHB');
  await expect(page.locator('#chart-batter')).toHaveAttribute('aria-label', 'Batter 1, right-handed batter');
  await expect(page.locator('#chart-batter-icon')).toHaveAttribute('transform', rightHandedPose);
  await expect(page.locator('#chart-zone')).toHaveAttribute('height', '90');
  await page.locator('#next-batter').click();
  await expect(page.locator('.chart-pitch')).toHaveCount(0);
  await expect(page.locator('#chart-batter')).toHaveText('BATTER 02LHB');
  await expect(page.locator('#chart-batter')).toHaveAttribute('aria-label', 'Batter 2, left-handed batter');
  await expect(page.locator('#chart-batter-icon')).toHaveAttribute('aria-label', 'Left-handed batter to the right of the strike zone');
  const leftHandedIcon = await page.locator('#chart-batter-icon').boundingBox();
  const newZone = await page.locator('#chart-zone').boundingBox();
  expect(leftHandedIcon.x).toBeGreaterThan(newZone.x + newZone.width);
  await expect(page.locator('#chart-zone')).toHaveAttribute('height', '82.5');
  await pitch(page);
  await expect(page.locator('.chart-pitch text')).toHaveText('1');
  await page.locator('#restart-button').click();
  await page.locator('#confirm-restart').click();
  await expect(page.locator('#chart-empty')).toBeVisible();
  await expect(page.locator('.chart-pitch')).toHaveCount(0);
  await expect(page.locator('#chart-batter')).toHaveText('BATTER 01LHB');
  await setRandom(page, []);
  await pitch(page, 9);
  await expect(page.locator('#pitch-chart')).toBeHidden();
});

test('pitch chart fits the upper-right field in both themes and on phones', async ({ page }) => {
  await page.goto('/');
  await setRandom(page, []);
  await pitch(page);
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
      const field = await page.locator('.field-wrap').boundingBox();
      const chart = await page.locator('#pitch-chart').boundingBox();
      expect(chart.x).toBeGreaterThan(field.x + field.width / 2);
      expect(chart.y - field.y).toBeLessThanOrEqual(12);
      expect(chart.x + chart.width).toBeLessThan(field.x + field.width);
      expect(chart.y + chart.height).toBeLessThan(field.y + field.height);
      const target = await page.locator('#target-handle .hit-area').boundingBox();
      await page.locator('.field-wrap').screenshot({ path: `test-results/pitch-chart-${width}-${theme}.png` });
      expect(chart.y + chart.height < target.y || chart.x > target.x + target.width).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
  }
});

test('results table includes every pitch grouped by batter and marks the first broken bid', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  for (let i = 0; i < 3; i++) {
    await setRandom(page, [0, 0.99, 0]);
    await pitch(page);
  }
  await setRandom(page, []);
  await pitch(page, 7);
  await expect(page.locator('#end-title')).toHaveText('Normal Win.');
  await expect(page.locator('#results-table tbody')).toHaveCount(3);
  await expect(page.locator('#results-table .result-pitch')).toHaveCount(10);
  await expect(page.locator('#results-table tbody').nth(0).locator('.result-pitch')).toHaveCount(4);
  await expect(page.locator('#results-table tbody').nth(1).locator('.result-pitch')).toHaveCount(3);
  await expect(page.locator('#bid-summary')).toContainText('pitch 3, batter 1: foul with two strikes');
  await expect(page.locator('#results-table .bid-ended')).toHaveCount(1);
  await expect(page.locator('#results-table .bid-ended')).toHaveAttribute('data-pitch', '3');
  await expect(page.locator('#results-table .bid-ended')).toContainText('0-2');
  await expect(page.locator('#results-table .result-pitch').first()).toContainText('Foul (strike)');
  await expect(page.locator('#results-table .result-pitch').last()).toContainText('Strikeout (called)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: 'test-results/results-table-mobile.png', fullPage: true });
  await page.locator('#play-again').click();
  await setRandom(page, []);
  await pitch(page, 9);
  await expect(page.locator('#results-table .result-pitch')).toHaveCount(9);
  await expect(page.locator('#results-table .bid-ended')).toHaveCount(0);
  await expect(page.locator('#bid-summary')).toContainText('Immaculate inning achieved');
});

test('results table keeps all batters and pitches in a long scored-on relief inning', async ({ page }) => {
  await page.goto('/');
  await page.locator('#difficulty').selectOption('relief');
  for (let i = 0; i < 10; i++) {
    await setRandom(page, [0, 0.99, 0.99, 0.99]);
    await pitch(page);
  }
  await setRandom(page, []);
  await pitch(page, 9);
  await expect(page.locator('#end-save')).toHaveText('Blown Save');
  await expect(page.locator('#results-table tbody')).toHaveCount(13);
  await expect(page.locator('#results-table .result-pitch')).toHaveCount(19);
  await expect(page.locator('#results-table tbody').last()).toContainText('Batter 13');
  await expect(page.locator('#bid-summary')).toContainText('pitch 1, batter 1: home run');
  await expect(page.locator('#results-table .result-pitch').last()).toHaveAttribute('data-pitch', '19');
});

test('desktop inning progress sits left of the field and pitch controls sit right', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  const left = await page.locator('.inning-strip').boundingBox();
  const field = await page.locator('.field-panel').boundingBox();
  const right = await page.locator('.pitch-panel').boundingBox();
  expect(left.x + left.width).toBeLessThan(field.x);
  expect(field.x + field.width).toBeLessThan(right.x);
  expect(left.y).toBeCloseTo(field.y);
  expect(right.y).toBeCloseTo(field.y);
  await setRandom(page, []);
  await pitch(page, 2);
  await expect(page.locator('.inning-strip #total-pitches')).toHaveText('2 PITCHES');
  await expect(page.locator('.inning-strip .log-pitch')).toHaveCount(2);
  await expect(page.locator('.inning-strip #perfect-dots .filled')).toHaveCount(2);
});

test('handedness mirrors release geometry and presets, survives resets, and fits small phones', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/');
  const selector = page.getByLabel('Pitcher handedness');
  const original = await page.locator('#flight-path').getAttribute('d');
  const target = await page.locator('#target-handle').getAttribute('transform');
  await selector.selectOption('L');
  await expect(page.locator('#platoon-matchup')).toHaveText('LHP vs RHB: Batter advantage');
  await expect(page.locator('#pitcher')).toHaveAttribute('aria-label', /^Left-handed/);
  await expect(page.locator('#release-handle')).toHaveAttribute('transform', 'translate(308 455)');
  await expect(page.locator('#spin')).toHaveValue('-1200');
  await expect(page.locator('#target-handle')).toHaveAttribute('transform', target);
  await selector.selectOption('R');
  await expect(page.locator('#flight-path')).toHaveAttribute('d', original);
  await selector.selectOption('L');
  await page.locator('#pitcher-height').fill('210');
  await page.locator('#release-handle').focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('Shift+ArrowLeft');
  const geometry = await page.locator('#field').evaluate((svg) => {
    const hand = svg.querySelector('#throwing-hand');
    const release = svg.querySelector('#release-handle');
    const path = svg.querySelector('#flight-path');
    const h = new DOMPoint(Number(hand.getAttribute('cx')), Number(hand.getAttribute('cy'))).matrixTransform(hand.getCTM());
    const r = new DOMPoint(0, 0).matrixTransform(release.getCTM());
    const start = path.getPointAtLength(0).matrixTransform(path.getCTM());
    return { x: release.transform.baseVal.consolidate().matrix.e, handGap: Math.hypot(h.x - r.x, h.y - r.y), flightGap: Math.hypot(start.x - r.x, start.y - r.y) };
  });
  expect(geometry.x).toBe(208);
  expect(geometry.handGap).toBeLessThan(0.01);
  expect(geometry.flightGap).toBeLessThan(0.1);
  await page.locator('[data-preset="curveball"]').click();
  await expect(page.locator('#spin')).toHaveValue('2400');
  await page.locator('#restart-button').click();
  await expect(selector).toHaveValue('L');
  await expect(page.locator('#release-handle')).toHaveAttribute('transform', /translate\(308 /);
  await page.locator('#difficulty').selectOption('relief');
  await expect(selector).toHaveValue('L');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await setRandom(page, []);
  await pitch(page, 3);
  await expect(page.locator('#batter-hand')).toHaveText('Left-handed batter');
  await expect(page.locator('#platoon-matchup')).toHaveText('LHP vs LHB: Pitcher advantage');
  await page.screenshot({ path: 'test-results/platoon-mobile.png', fullPage: true });
});

test('matchups affect throws and history keeps each hand through review and replay', async ({ page }) => {
  await page.goto('/');
  await page.locator('#speed').fill('65');
  await page.locator('#spin').fill('0');
  // A nearly straight pitch at zone center puts the base miss chance near 0.08.
  await page.locator('#target-handle').focus();
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowLeft');
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown');
  await page.locator('#bend-handle').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await setRandom(page, [0, 0.08, 0]);
  await pitch(page);
  await expect(page.locator('#call-title')).toHaveText('Swing and miss');
  await expect(page.locator('#batter-height')).toHaveText('180 cm');
  await expect(page.locator('#batter-hand')).toHaveText('Right-handed batter');
  const trail = await page.locator('.pitch-trail path').getAttribute('d');
  await setRandom(page, [0, 0.08, 0]);
  await page.locator('#pitcher-hand').selectOption('L');
  await expect(page.locator('.pitch-trail path')).toHaveAttribute('d', trail);
  await expect(page.locator('#batter-height')).toHaveText('180 cm');
  await expect(page.locator('#batter-hand')).toHaveText('Right-handed batter');
  await pitch(page);
  await expect(page.locator('#call-title')).toHaveText('Foul ball');
  await expect(page.locator('#batter-height')).toHaveText('180 cm');
  await expect(page.locator('#batter-hand')).toHaveText('Right-handed batter');
  await setRandom(page, [0.99, 0.999, 0.5]);
  await pitch(page, 1, false);
  await expect(page.locator('#pitcher-hand')).toBeDisabled();
  await expect(page.locator('#batter-height')).toHaveText('180 cm');
  await expect(page.locator('#batter-hand')).toHaveText('Right-handed batter');
  await expect(page.locator('#platoon-matchup')).toHaveText('LHP vs RHB: Batter advantage');
  await page.locator('#next-batter').click();
  await expect(page.locator('#batter-height')).toHaveText('205 cm');
  await expect(page.locator('#batter-hand')).toHaveText('Left-handed batter');
  await expect(page.locator('#batter')).toHaveAttribute('transform', /translate\(980 0\) scale\(-1 1\)/);
  await expect(page.locator('#platoon-matchup')).toHaveText('LHP vs LHB: Pitcher advantage');
  await pitch(page, 6);
  const rows = page.locator('#results-table .result-pitch');
  await expect(rows.nth(0)).toContainText('RHP vs RHB');
  await expect(rows.nth(1)).toContainText('LHP vs RHB');
  await expect(rows.nth(3)).toContainText('LHP vs LHB');
  await expect(page.locator('#pitcher-hand')).toBeDisabled();
  await setRandom(page, [0, 0.499]);
  await page.locator('#play-again').click();
  await expect(page.locator('#pitcher-hand')).toHaveValue('L');
  await expect(page.locator('#pitcher-hand')).toBeEnabled();
  await expect(page.locator('#batter-hand')).toHaveText('Right-handed batter');
  await expect(page.locator('#batter-height')).toHaveText('165 cm');
});

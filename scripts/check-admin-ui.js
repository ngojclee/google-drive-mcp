import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_BIN ? { executablePath: process.env.BROWSER_BIN } : {}) });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:17456/admin/');
  await page.locator('#workspace').waitFor({ state: 'visible' });
  for (const [width,height] of [[1440,1000],[390,844]]) {
    await page.setViewportSize({width,height});
    for (const tab of ['accounts','oauth','access','settings']) {
      await page.locator(`nav a[href="#${tab}"]`).click();
      await page.locator(`[data-page="${tab}"]`).waitFor({state:'visible'});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), `${tab} overflows ${width}`);
      await page.screenshot({path:`.tmp-test/admin-${tab}-${width}.png`,fullPage:true});
    }
  }
  await page.locator('#theme').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  assert.deepEqual(errors,[]);
  console.log('Admin UI: 4 tabs, desktop/mobile overflow, theme and console checks passed');
} finally { await browser.close(); }

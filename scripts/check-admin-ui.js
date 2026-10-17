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
  assert.ok(await page.locator('.app-brand img').evaluate(img=>img.complete && img.naturalWidth>0), 'Brand icon must render');
  await page.evaluate(()=>{document.documentElement.dataset.theme='light'});
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
  await page.screenshot({path:'.tmp-test/admin-dark-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'.tmp-test/admin-dark-desktop.png',fullPage:true});
  await page.locator('nav a[href="#access"]').click();
  await page.locator('#currentKey').fill('preview-current-not-a-real-secret');
  await page.locator('#replacementKey').fill('preview-replacement-not-a-real-secret');
  await page.locator('#rotateKey button').click();
  await page.locator('#rotationConfirm').waitFor({state:'visible'});
  await page.locator('#cancelRotation').click();
  await page.waitForFunction(()=>document.getElementById('replacementKey').value==='');
  assert.equal(await page.locator('#replacementKey').inputValue(),'');
  await page.route('**/admin/status',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'preview_unavailable'})}));
  await page.locator('#refresh').click();
  await page.locator('#accounts .error, #accounts tr.error').waitFor({state:'attached'});
  assert.match(await page.locator('#message').textContent(),/preview_unavailable/);
  await page.unroute('**/admin/status');
  await page.route('**/admin/status',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'admin_login_required'})}));
  await page.locator('#refresh').click();
  await page.locator('#login').waitFor({state:'visible'});
  assert.ok(await page.locator('#logout').isHidden());
  assert.ok(await page.locator('#nav').isHidden());
  assert.deepEqual(errors,[]);
  console.log('Admin UI: 4 tabs, icon, desktop/mobile, themes, rotation cancel, error and session-expiry checks passed');
} finally { await browser.close(); }

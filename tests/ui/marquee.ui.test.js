// Browser test: the sign-in exam ticker must scroll slowly enough to read.
// Run with:  npm run test:ui
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');
const { startServer } = require('../helpers');

let srv, browser;
test.before(async () => {
  srv = await startServer();
  const candidates = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean);
  const executablePath = candidates.find(p => fs.existsSync(p));
  browser = await chromium.launch(executablePath ? { executablePath } : {});
});
test.after(async () => { if(browser) await browser.close(); if(srv) srv.stop(); });

test('sign-in exam ticker scrolls at a calm, readable speed', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(srv.base + '/#login');
  await page.waitForSelector('.auth-marquee-track[data-tuned]', { state: 'attached' });
  await page.waitForTimeout(300);
  const pxPerSec = await page.evaluate(() => {
    const t = document.querySelector('.auth-marquee-track');
    return (t.scrollWidth / 2) / parseFloat(getComputedStyle(t).animationDuration);
  });
  assert.ok(pxPerSec > 0 && pxPerSec <= 60, 'ticker moves at ' + pxPerSec.toFixed(1) + 'px/s');
  await page.close();
});

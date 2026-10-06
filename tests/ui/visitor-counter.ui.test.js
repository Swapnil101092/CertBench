// Browser test: the home page shows the visitor counter card with real numbers.
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

test('home page shows total and today visitor counts, counting a browser once', async () => {
  srv.sql("INSERT INTO visit_daily (day, visitors) VALUES ('2020-01-01', 15107337)");
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(srv.base + '/');
  await page.waitForFunction(() => { const e = document.querySelector('[data-vc="total"]'); return e && /\d/.test(e.textContent); });
  assert.equal(await page.textContent('[data-vc="total"]'), '1,51,07,338');
  assert.equal(await page.textContent('[data-vc="today"]'), '1');
  // The card sits just above the footer.
  assert.ok(await page.evaluate(() => document.querySelector('.visitor-section').nextElementSibling.classList.contains('site-foot')));
  // Reloading in the same browser does not count again.
  await page.reload();
  await page.waitForFunction(() => { const e = document.querySelector('[data-vc="today"]'); return e && /\d/.test(e.textContent); });
  assert.equal(await page.textContent('[data-vc="today"]'), '1');
  await ctx.close();
});

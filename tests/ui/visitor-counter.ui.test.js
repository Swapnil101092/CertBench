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

test('admin can hide and show the home page visitor counter from Site settings', async () => {
  const { validUser } = require('../helpers');
  const a = validUser({ username: 'ui_visit_admin' });
  await srv.api('/auth/register', { method: 'POST', body: a });
  srv.sql('UPDATE users SET is_admin = 1 WHERE username = ?', 'ui_visit_admin');
  const l = await srv.api('/auth/login', { method: 'POST', body: { username: a.username, password: a.password } });
  const token = (await srv.api('/auth/verify-otp', { method: 'POST', body: { pendingToken: l.data.pendingToken, code: l.data.devOtp } })).data.token;

  const ctx = await browser.newContext();
  await ctx.addInitScript(t => { try{ localStorage.setItem('certbench-token', t); }catch(e){} }, token);
  const admin = await ctx.newPage();
  await admin.goto(srv.base + '/admin');
  await admin.getByRole('button', { name: 'Site settings' }).click();
  await admin.waitForSelector('#adm-visitors-toggle:not([disabled])');
  assert.equal(await admin.isChecked('#adm-visitors-toggle'), true, 'on by default');
  assert.match(await admin.textContent('#adm-visitors-stats'), /Total visitors: 1,51,07,338/);

  // Switch it off: the home page no longer shows the card.
  await admin.uncheck('#adm-visitors-toggle');
  await admin.waitForFunction(() => /hidden from the home page/.test(document.getElementById('adm-visitors-status').textContent));
  const visitorCtx = await browser.newContext();   // a signed-out visitor sees the home page
  const home = await visitorCtx.newPage();
  await home.goto(srv.base + '/');
  await home.waitForSelector('.landing-wrap .site-foot');
  await home.waitForTimeout(800);
  assert.equal(await home.locator('.visitor-section').count(), 0, 'card hidden');

  // Switch it back on: the card returns.
  await admin.check('#adm-visitors-toggle');
  await admin.waitForFunction(() => /now shown on the home page/.test(document.getElementById('adm-visitors-status').textContent));
  await home.reload();
  await home.waitForSelector('.visitor-section [data-vc="total"]');
  await visitorCtx.close();
  await ctx.close();
});

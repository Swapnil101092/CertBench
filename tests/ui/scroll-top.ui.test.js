// Browser test: opening a new screen starts at the top of the page, not where the last screen was scrolled to.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');
const { startServer, validUser } = require('../helpers');

let srv, browser;
test.before(async () => {
  srv = await startServer();
  const candidates = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean);
  const executablePath = candidates.find(p => fs.existsSync(p));
  browser = await chromium.launch(executablePath ? { executablePath } : {});
});
test.after(async () => { if(browser) await browser.close(); if(srv) srv.stop(); });

test('a practice-set page opens scrolled to the top', async () => {
  const u = validUser({ accountType: 'professional' });
  const token = (await srv.signUp(u)).data.token;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 700 } });
  await ctx.addInitScript(t => { try{ localStorage.setItem('certbench-token', t); }catch(e){} }, token);
  const page = await ctx.newPage();
  await page.goto(srv.base + '/');
  await page.waitForSelector('.cert-name');
  // A free exam far down the list, so the page has to scroll to reach it.
  const btn = page.locator('button:has-text("Choose a practice set")').last();
  await btn.scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => window.scrollY) > 200);
  await btn.click();
  await page.waitForSelector('.back-link');
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  await ctx.close();
});

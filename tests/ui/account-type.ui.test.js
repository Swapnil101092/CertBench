// Browser test: Students and IT Professionals. The home page can show one group; sign-up asks which you
// are; older accounts are asked once; the account menu switches type and the exam list follows.
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

test('home page: "Show exams for" hides the other group and pre-selects the sign-up choice', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(srv.base + '/');
  await page.waitForSelector('.audience-switch');
  assert.equal(await page.locator('#exams').count(), 1);
  assert.equal(await page.locator('#jee').count(), 1);

  await page.click('.audience-opt:has-text("Students")');
  assert.equal(await page.locator('#exams').count(), 0);
  assert.equal(await page.locator('#jee').count(), 1);
  await page.click('.audience-opt:has-text("IT Professionals")');
  assert.equal(await page.locator('#exams').count(), 1);
  assert.equal(await page.locator('#jee').count(), 0);

  // Same browser, sign-up page (the site opens it in a new tab): IT Professional is already picked; it can be changed.
  await page.close();
  const reg = await ctx.newPage();
  await reg.goto(srv.base + '/#register');
  await reg.waitForSelector('.type-option');
  assert.equal(await reg.getAttribute('.type-option[data-type="professional"]', 'aria-checked'), 'true');
  await reg.click('.type-option[data-type="student"]');
  assert.equal(await reg.getAttribute('.type-option[data-type="student"]', 'aria-checked'), 'true');
  assert.equal(await reg.getAttribute('.type-option[data-type="professional"]', 'aria-checked'), 'false');
  await ctx.close();
});

test('sign-up: the account type is required', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(srv.base + '/#register');
  await page.waitForSelector('.type-option');
  await page.click('button[type="submit"]');
  assert.match(await page.textContent('#reg-type-error'), /Student or IT Professional/);
  await page.close();
});

test('older account: asked once, then sees only its own exams, and can switch from the menu', async () => {
  const u = validUser();
  await srv.signUp(u);           // no account type, like accounts made before the split
  const token = (await srv.api('/auth/login', { method: 'POST', body: { username: u.username, password: u.password } })).data.token;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(t => { try{ localStorage.setItem('certbench-token', t); }catch(e){} }, token);
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  await page.goto(srv.base + '/');
  await page.waitForSelector('.type-prompt');
  await page.click('.type-prompt .type-option[data-type="professional"]');
  await page.waitForSelector('.type-prompt', { state: 'detached' });
  await page.waitForSelector('.audience-note');
  assert.match(await page.textContent('.audience-note'), /IT Professionals/);
  assert.equal(await page.locator('.audience-note button').count(), 0);   // switch only in the account menu
  let names = (await page.locator('.cert-name').allTextContents()).join(' | ');
  assert.doesNotMatch(names, /VITEEE/);
  assert.match(names, /Azure/);

  await page.click('.user-chip');
  assert.match(await page.textContent('.account-head'), /IT Professional account/);
  await page.click('.account-item:has-text("Switch to Student")');
  await page.waitForFunction(() => /Students/.test((document.querySelector('.audience-note') || {}).textContent || ''));
  names = (await page.locator('.cert-name').allTextContents()).join(' | ');
  assert.match(names, /VITEEE/);
  assert.doesNotMatch(names, /Azure/);

  // Reload: no prompt any more.
  await page.reload();
  await page.waitForSelector('.audience-note');
  assert.equal(await page.locator('.type-prompt').count(), 0);
  await ctx.close();
});

// Browser test: the signed-in top bar is just the avatar; its menu holds Admin, Cart, My results, theme and Sign out.
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

async function signedInPage(viewport, opts){
  const u = validUser();
  await srv.signUp(u);
  if(opts && opts.admin) srv.sql('UPDATE users SET is_admin = 1 WHERE username = ?', u.username);
  const token = (await srv.api('/auth/login', { method: 'POST', body: { username: u.username, password: u.password } })).data.token;
  const ctx = await browser.newContext({ viewport, hasTouch: !!(opts && opts.touch), isMobile: !!(opts && opts.touch) });
  await ctx.addInitScript(t => { try{ localStorage.setItem('certbench-token', t); }catch(e){} }, token);
  const page = await ctx.newPage();
  await page.goto(srv.base + '/');
  await page.waitForSelector('h1:has-text("Choose a mock exam")');
  return { page, ctx, u };
}

test('account menu: closed at first, opens on click, has every link, closes on Escape and outside click', async () => {
  const { page, ctx, u } = await signedInPage({ width: 1280, height: 900 }, { admin: true });
  assert.equal(await page.isVisible('.account-menu'), false);
  assert.equal(await page.locator('.topbar-right > *').count(), 1, 'only the avatar is in the top bar');

  await page.click('.user-chip');
  assert.equal(await page.isVisible('.account-menu'), true);
  assert.equal(await page.getAttribute('.user-chip', 'aria-expanded'), 'true');
  const items = (await page.locator('.account-item').allTextContents()).map(s => s.trim());
  assert.deepEqual(items, ['Admin', 'Cart', 'My results', 'Light mode', 'Sign out']);
  assert.match(await page.textContent('.account-head'), new RegExp(u.email.replace(/[.]/g, '\\.')));

  await page.keyboard.press('Escape');
  assert.equal(await page.isVisible('.account-menu'), false);
  await page.click('.user-chip');
  await page.mouse.click(600, 600);   // somewhere outside the menu (and away from the avatar)
  await page.mouse.move(600, 600);
  assert.equal(await page.isVisible('.account-menu'), false);

  // Hovering the avatar also opens it on a computer with a mouse.
  await page.hover('.user-chip');
  assert.equal(await page.isVisible('.account-menu'), true);

  // Picking an item runs it and closes the menu.
  await page.click('.account-item:has-text("My results")');
  await page.mouse.move(600, 600);
  await page.waitForSelector('h1:has-text("My results")');
  assert.equal(await page.isVisible('.account-menu'), false);
  await ctx.close();
});

test('account menu: works by tapping on a phone, and Sign out signs out', async () => {
  const { page, ctx } = await signedInPage({ width: 390, height: 844 }, { touch: true });
  await page.tap('.user-chip');
  assert.equal(await page.isVisible('.account-menu'), true);
  const box = await page.locator('.account-menu').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390, 'the menu fits on the screen');
  assert.equal(await page.locator('.account-item:has-text("Admin")').count(), 0, 'no Admin link for students');
  await page.tap('.account-item:has-text("Sign out")');
  await page.waitForSelector('.user-chip', { state: 'detached' });
  await ctx.close();
});

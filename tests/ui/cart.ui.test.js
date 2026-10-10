// Browser test: add several certificates to the cart and pay for them together (dev mode).
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

test('cart: add two paid certificates, see the total, pay once, both unlock', async () => {
  const u = validUser();
  await srv.signUp(u);
  const token = (await srv.api('/auth/login', { method: 'POST', body: { username: u.username, password: u.password } })).data.token;
  const exams = (await srv.api('/exams', { token })).data.exams;
  const [a, b] = exams;
  srv.sql('UPDATE exams SET price_inr_paise = 19900 WHERE slug = ?', a.slug);
  srv.sql('UPDATE exams SET price_inr_paise = 29900 WHERE slug = ?', b.slug);

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(t => { try{ localStorage.setItem('certbench-token', t); }catch(e){} }, token);
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  await page.goto(srv.base + '/');
  await page.waitForSelector('h1:has-text("Choose a mock exam")');

  const card = (name) => page.locator('.cert-card', { has: page.locator('.cert-name', { hasText: name }) });
  await card(a.name).locator('.cart-toggle').click();
  await card(b.name).locator('.cart-toggle').click();
  assert.match(await card(a.name).locator('.cart-toggle').textContent(), /In cart/);
  assert.equal((await page.textContent('.cart-btn .cart-count')).trim(), '2');
  assert.match(await page.textContent('.cart-bar'), /2 certificates.*₹498/);

  // Removing and re-adding toggles; the cart survives a reload.
  await card(b.name).locator('.cart-toggle').click();
  assert.equal((await page.textContent('.cart-btn .cart-count')).trim(), '1');
  await card(b.name).locator('.cart-toggle').click();
  await page.reload();
  await page.waitForSelector('.cart-btn .cart-count');
  assert.equal((await page.textContent('.cart-btn .cart-count')).trim(), '2');

  await page.click('.cart-btn');
  await page.waitForSelector('h1:has-text("Your cart")');
  assert.equal(await page.locator('.cart-item').count(), 2);
  assert.match(await page.textContent('.cart-sum-total'), /₹498/);
  await page.click('.cart-pay');
  await page.waitForSelector('.cart-notice');
  assert.match(await page.textContent('.cart-notice'), /Unlocked 2 certificates/);
  assert.match(await page.textContent('.cart-empty'), /cart is empty/);
  assert.equal(await page.locator('.cart-btn .cart-count').count(), 0);

  await page.click('button:has-text("Browse certificates")');
  assert.match(await card(a.name).textContent(), /Enrolled/);
  assert.match(await card(b.name).textContent(), /Enrolled/);
  assert.equal(await card(a.name).locator('.cart-toggle').count(), 0, 'bought exams cannot be added again');
  await ctx.close();
});

// Browser test: hiding Contact us in Site settings removes the panel and its menu links; hiding one detail removes just that card.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');
const { startServer, validUser } = require('../helpers');

let srv, browser, token;
test.before(async () => {
  srv = await startServer();
  const candidates = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean);
  const executablePath = candidates.find(p => fs.existsSync(p));
  browser = await chromium.launch(executablePath ? { executablePath } : {});
  const u = validUser();
  await srv.signUp(u);
  srv.sql('UPDATE users SET is_admin = 1 WHERE username = ?', u.username);
  token = (await srv.api('/auth/login', { method: 'POST', body: { username: u.username, password: u.password } })).data.token;
});
test.after(async () => { if(browser) await browser.close(); if(srv) srv.stop(); });

async function home(){
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(srv.base + '/');
  await page.waitForSelector('#about');
  await page.waitForTimeout(500);   // settings load after the first paint
  return page;
}

test('contact visibility: admin switches control the home page', async () => {
  // Turn things off from the admin panel itself.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(t => { try{ localStorage.setItem('certbench-token', t); }catch(e){} }, token);
  const admin = await ctx.newPage();
  await admin.goto(srv.base + '/admin.html');
  await admin.click('button:has-text("Site settings")');
  await admin.uncheck('label:has-text("Show the address") input');
  await admin.click('button:has-text("Save settings")');
  await admin.waitForSelector('text=Saved.');

  let page = await home();
  assert.equal(await page.locator('.contact-panel').count(), 1);
  const labels = await page.locator('.contact-card h3').allTextContents();
  assert.deepEqual(labels, ['Phone', 'E-mail Address']);
  await page.close();

  await admin.uncheck('label:has-text("Show the Contact us panel") input');
  await admin.click('button:has-text("Save settings")');
  await admin.waitForSelector('text=Saved.', { state: 'attached' });
  await admin.waitForTimeout(300);
  page = await home();
  assert.equal(await page.locator('.contact-panel').count(), 0);
  assert.equal(await page.locator('.landing-nav button:has-text("Contact")').count(), 0);
  assert.equal(await page.locator('.site-foot button:has-text("Contact")').count(), 0);
  assert.equal(await page.locator('.about-wrap.about-wrap-solo').count(), 1);
  await page.close();
  await ctx.close();
});

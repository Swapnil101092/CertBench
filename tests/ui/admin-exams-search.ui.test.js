// Browser test: the admin Certificates list has a search box that filters by name, slug or badge.
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

test('admin certificates: search filters the list, shows a count, and an empty message', async () => {
  const u = validUser();
  await srv.signUp(u);
  srv.sql('UPDATE users SET is_admin = 1 WHERE username = ?', u.username);
  const token = (await srv.api('/auth/login', { method: 'POST', body: { username: u.username, password: u.password } })).data.token;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(t => { try{ localStorage.setItem('certbench-token', t); }catch(e){} }, token);
  const page = await ctx.newPage();
  await page.goto(srv.base + '/admin.html');
  await page.click('button:has-text("Certificates")');
  await page.waitForSelector('.adm-exams-table');
  const rows = () => page.locator('.adm-exams-table tbody tr');
  const all = await rows().count();
  assert.ok(all >= 8, String(all));
  assert.equal(await page.textContent('.adm-toolbar .adm-hint'), all + ' total');

  await page.fill('.adm-search', 'vit');                 // badge "VIT"
  assert.equal(await rows().count(), 1);
  assert.match(await rows().first().textContent(), /VITEEE/);
  assert.equal(await page.textContent('.adm-toolbar .adm-hint'), '1 of ' + all);

  await page.fill('.adm-search', 'k8s');        // slug
  assert.match(await rows().first().textContent(), /Kubernetes/);

  await page.fill('.adm-search', 'cloud');               // name, case-insensitive
  assert.ok(await rows().count() >= 2);

  await page.fill('.adm-search', 'zzzz');
  assert.equal(await rows().count(), 1);
  assert.match(await rows().first().textContent(), /No certificates match “zzzz”/);

  // The search is kept after opening a certificate and coming back.
  await page.fill('.adm-search', 'aws');
  const awsRows = await rows().count();
  await rows().first().locator('button:has-text("Manage")').click();
  await page.waitForSelector('.adm-exams-table', { state: 'detached' });
  await page.click('button:has-text("Certificates")');
  await page.waitForSelector('.adm-exams-table');
  assert.equal(await page.inputValue('.adm-search'), 'aws');
  assert.equal(await rows().count(), awsRows);
  await ctx.close();
});

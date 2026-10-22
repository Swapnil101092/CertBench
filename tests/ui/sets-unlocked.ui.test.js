// Browser test: the admin "Open all practice sets" switch unlocks every set for students.
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

test('admin opens all VITEEE sets; a student then sees no locked sets', async () => {
  const a = validUser();
  await srv.signUp(a);
  srv.sql('UPDATE users SET is_admin = 1 WHERE username = ?', a.username);
  const adminToken = (await srv.api('/auth/login', { method: 'POST', body: { username: a.username, password: a.password } })).data.token;

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(t => { try{ localStorage.setItem('certbench-token', t); }catch(e){} }, adminToken);
  const page = await ctx.newPage();
  await page.goto(srv.base + '/admin');
  await page.click('button:has-text("Certificates")');
  await page.locator('tr', { hasText: 'VITEEE' }).locator('button:has-text("Manage")').click();
  const box = page.locator('label.adm-check:has-text("Open all practice sets") input');
  await box.waitFor();
  assert.equal(await box.isChecked(), false);
  await box.check();
  if(process.env.SHOT) await page.locator('.adm-field:has(label.adm-check:has-text("Open all practice sets"))').screenshot({ path: process.env.SHOT });
  await page.click('button:has-text("Save changes")');
  await page.waitForSelector('text=Saved.');
  await ctx.close();

  const student = (await srv.signUp(validUser({ accountType: 'student' }))).data.token;
  await srv.api('/payments/enroll', { method: 'POST', token: student, body: { examSlug: 'viteee' } });
  const sets = (await srv.api('/exams/viteee/sets', { token: student })).data.sets;
  assert.ok(sets.every(s => !s.locked));
});

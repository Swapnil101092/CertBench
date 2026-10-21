// Browser test: the Content-Security-Policy blocks nothing the site itself uses (home, exam list, an exam with images, admin).
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

async function watchedPage(token){
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(t => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', e => window.__cspViolations.push(e.violatedDirective + ' ' + e.blockedURI));
    if(t) try{ localStorage.setItem('certbench-token', t); }catch(e){}
  }, token || null);
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  return { ctx, page };
}
const violations = (page) => page.evaluate(() => window.__cspViolations);

test('home page, exam list and an exam with images load with no CSP violations', async () => {
  let { ctx, page } = await watchedPage();
  await page.goto(srv.base + '/');
  await page.waitForLoadState('networkidle');
  assert.deepEqual(await violations(page), []);
  await ctx.close();

  const u = validUser({ accountType: 'student' });
  const token = (await srv.signUp(u)).data.token;
  ({ ctx, page } = await watchedPage(token));
  await page.goto(srv.base + '/');
  await page.waitForSelector('.cert-name');
  // VITEEE questions include images, served as data: URLs.
  await srv.api('/payments/enroll', { method: 'POST', token, body: { examSlug: 'viteee' } });
  const start = await srv.api('/exams/viteee/start', { method: 'POST', token, body: { setNumber: 1 } });
  assert.equal(start.status, 200);
  const img = start.data.questions.find(q => q.image).image;
  await page.evaluate(src => new Promise((ok, bad) => { const i = new Image(); i.onload = ok; i.onerror = bad; i.src = src; document.body.appendChild(i); }), img);
  assert.deepEqual(await violations(page), []);
  await ctx.close();
});

test('admin page loads with no CSP violations', async () => {
  const u = validUser();
  await srv.signUp(u);
  srv.sql('UPDATE users SET is_admin = 1 WHERE username = ?', u.username);
  const token = (await srv.api('/auth/login', { method: 'POST', body: { username: u.username, password: u.password } })).data.token;
  const { ctx, page } = await watchedPage(token);
  await page.goto(srv.base + '/admin');
  await page.waitForLoadState('networkidle');
  assert.deepEqual(await violations(page), []);
  await ctx.close();
});

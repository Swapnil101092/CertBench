// Browser end-to-end tests for the registration form (Playwright, headless Chromium).
// Run with:  npm run test:ui
// Needs a Chromium build: set CHROMIUM_PATH, or install one with `npx playwright install chromium`.
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

async function openRegister(){
  const page = await browser.newPage();
  await page.goto(srv.base + '/#register');
  await page.waitForSelector('#reg-name');
  return page;
}
const err = (page, id) => page.locator(`#${id}-error`).textContent();

test('username with numbers shows an inline error on blur', async () => {
  const page = await openRegister();
  await page.fill('#reg-username', 'john123');
  await page.locator('#reg-username').blur();
  assert.match(await err(page, 'reg-username'), /cannot contain numbers/i);
  assert.equal(await page.getAttribute('#reg-username', 'aria-invalid'), 'true');
  // Fixing it clears the error live.
  await page.fill('#reg-username', 'john');
  assert.equal(await err(page, 'reg-username'), '');
  await page.close();
});

test('submitting an empty form flags every field and sends nothing', async () => {
  const page = await openRegister();
  let calls = 0; page.on('request', r => { if(r.url().includes('/api/auth/register')) calls++; });
  await page.click('button[type=submit]');
  for(const id of ['reg-name', 'reg-email', 'reg-mobile', 'reg-username', 'reg-password', 'reg-confirm']){
    assert.notEqual(await err(page, id), '', id + ' should show an error');
  }
  assert.equal(await page.evaluate(() => document.activeElement.id), 'reg-name', 'focus moves to the first bad field');
  assert.equal(calls, 0);
  await page.close();
});

test('invalid values: each field shows its own message', async () => {
  const page = await openRegister();
  await page.fill('#reg-name', 'John2');
  await page.fill('#reg-email', 'john..doe@example.com');
  await page.fill('#reg-mobile', '5876543210');
  await page.fill('#reg-username', 'admin');
  await page.fill('#reg-password', 'abc12345');
  await page.fill('#reg-confirm', 'abc12346');
  await page.click('button[type=submit]');
  assert.match(await err(page, 'reg-name'), /letters/i);
  assert.match(await err(page, 'reg-email'), /valid email/i);
  assert.match(await err(page, 'reg-mobile'), /6, 7, 8, or 9/);
  assert.match(await err(page, 'reg-username'), /reserved/i);
  assert.match(await err(page, 'reg-password'), /uppercase/i);
  assert.match(await err(page, 'reg-confirm'), /do not match/i);
  await page.close();
});

test('mobile field keeps digits only, max 10', async () => {
  const page = await openRegister();
  await page.type('#reg-mobile', '98ab76-543 21099');
  assert.equal(await page.inputValue('#reg-mobile'), '9876543210');
  await page.close();
});

test('password checklist ticks off rules as you type', async () => {
  const page = await openRegister();
  const okCount = () => page.locator('.pw-checklist li.ok').count();
  assert.equal(await okCount(), 0);
  await page.fill('#reg-password', 'abc');
  assert.equal(await okCount(), 2); // lowercase + no spaces
  await page.fill('#reg-password', 'Abcdef1!');
  assert.equal(await okCount(), 6);
  await page.close();
});

test('E2E: register -> verify email + mobile codes -> signed in -> duplicate rejected -> password-only sign in', async () => {
  const user = { name: 'Ui Tester', email: 'ui.tester@example.com', mobile: '9812345670', username: 'ui_tester', password: 'Ui#Tester9' };
  let page = await openRegister();
  for(const [k, v] of Object.entries(user)) await page.fill('#reg-' + k, v);
  await page.fill('#reg-confirm', user.password);
  await page.click('button[type=submit]');

  // Step 2: one box per code; on this test server the codes are shown on screen.
  await page.waitForSelector('#reg-email-code');
  assert.match(await page.textContent('h1'), /Verify your email and mobile/);
  assert.match(await page.textContent('.login-card .sub'), /\+91 98\*{6}70/);
  const emailCode = (await page.textContent('#dev-email-code')).trim();
  const mobileCode = (await page.textContent('#dev-mobile-code')).trim();
  // Resend is held back for 30 seconds.
  assert.equal(await page.isDisabled('.reg-resend-btn[data-channel="mobile"]'), true);
  assert.match(await page.textContent('.reg-resend-btn[data-channel="mobile"]'), /Resend in \d+s/);

  // A wrong mobile code is flagged on that box only.
  await page.fill('#reg-email-code', emailCode);
  await page.fill('#reg-mobile-code', mobileCode === '123456' ? '654321' : '123456');
  await page.click('button:has-text("Verify and create account")');
  await page.waitForFunction(() => document.getElementById('reg-mobile-code-error').textContent.length > 0);
  assert.match(await page.textContent('#reg-mobile-code-error'), /doesn’t match/);
  assert.equal(await page.textContent('#reg-email-code-error'), '');

  await page.fill('#reg-mobile-code', mobileCode);
  await page.click('button:has-text("Verify and create account")');
  await page.waitForSelector('h1:has-text("Choose a mock exam")');   // signed in straight away
  await page.close();

  // Same username again: server says it's taken, shown on the username field, typed values kept.
  page = await openRegister();
  for(const [k, v] of Object.entries({ ...user, email: 'other@example.com', mobile: '9812345671' })) await page.fill('#reg-' + k, v);
  await page.fill('#reg-confirm', user.password);
  await page.click('button[type=submit]');
  await page.waitForFunction(() => document.getElementById('reg-username-error').textContent.length > 0);
  assert.match(await err(page, 'reg-username'), /already taken/i);
  assert.equal(await page.inputValue('#reg-name'), 'Ui Tester', 'typed values survive the server error');
  assert.equal(await page.inputValue('#reg-email'), 'other@example.com');
  await page.close();

  // Sign in: username + password only, no code screen.
  page = await browser.newPage();
  await page.goto(srv.base + '/#login');
  await page.waitForSelector('#username');
  await page.fill('#username', user.username);
  await page.fill('#password', user.password);
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('h1:has-text("Choose a mock exam")');
  await page.close();
});

test('verify step: "Change your details" goes back to the form with everything still filled in', async () => {
  const page = await openRegister();
  const user = { name: 'Back Tester', email: 'back.tester@example.com', mobile: '9812345699', username: 'back_tester', password: 'Back#Tester9' };
  for(const [k, v] of Object.entries(user)) await page.fill('#reg-' + k, v);
  await page.fill('#reg-confirm', user.password);
  await page.click('button[type=submit]');
  await page.waitForSelector('#reg-email-code');
  await page.click('button:has-text("Change your details")');
  await page.waitForSelector('#reg-name');
  assert.equal(await page.inputValue('#reg-email'), user.email);
  assert.equal(await page.inputValue('#reg-mobile'), user.mobile);
  await page.close();
});

test('eye icon shows and hides passwords on sign-up and sign-in', async () => {
  const page = await openRegister();
  for(const id of ['reg-password', 'reg-confirm']){
    const toggle = page.locator(`button.pw-toggle[aria-controls="${id}"]`);
    assert.equal(await page.getAttribute('#' + id, 'type'), 'password');
    await toggle.click();
    assert.equal(await page.getAttribute('#' + id, 'type'), 'text');
    assert.equal(await toggle.getAttribute('aria-label'), 'Hide password');
    await toggle.click();
    assert.equal(await page.getAttribute('#' + id, 'type'), 'password');
  }
  await page.goto(srv.base + '/#login');
  await page.reload();
  await page.waitForSelector('#password');
  await page.fill('#password', 'Secret#1');
  await page.click('button.pw-toggle[aria-controls="password"]');
  assert.equal(await page.getAttribute('#password', 'type'), 'text');
  assert.equal(await page.inputValue('#password'), 'Secret#1');
  await page.close();
});

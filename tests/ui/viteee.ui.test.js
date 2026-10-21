// Browser test: a sectioned exam (VITEEE) runs one timed section at a time, moves on when a section's
// time runs out, shows question images, and reports a score per section.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const { chromium } = require('playwright-core');
const { startServer, validUser } = require('../helpers');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let srv, browser;
test.before(async () => {
  srv = await startServer();
  const candidates = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean);
  const executablePath = candidates.find(p => fs.existsSync(p));
  browser = await chromium.launch(executablePath ? { executablePath } : {});
});
test.after(async () => { if(browser) await browser.close(); if(srv) srv.stop(); });

test('viteee: sections one at a time, timer moves on, image shown, per-section results', async () => {
  const u = validUser({ accountType: 'student' });
  await srv.signUp(u);
  const token = (await srv.api('/auth/login', { method: 'POST', body: { username: u.username, password: u.password } })).data.token;
  srv.sql("UPDATE exams SET price_inr_paise = 0 WHERE slug = 'viteee'");
  // Give the first Physics question of set 1 an image.
  srv.sql(`UPDATE questions SET image_mime = 'image/png', image_data = ? WHERE id = (
    SELECT q.id FROM questions q JOIN exams e ON e.id = q.exam_id WHERE e.slug = 'viteee' AND q.set_number = 1 AND q.section = 'Physics' ORDER BY q.seq LIMIT 1)`,
    Buffer.from(PNG, 'base64'));

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(t => { try{ localStorage.setItem('certbench-token', t); }catch(e){} }, token);
  const page = await ctx.newPage();
  await page.clock.install();
  page.on('dialog', d => d.accept());
  await page.goto(srv.base + '/');
  await page.waitForSelector('h1:has-text("Choose a mock exam")');

  const card = page.locator('.cert-card', { has: page.locator('.cert-name', { hasText: 'VITEEE' }) });
  assert.match(await card.textContent(), /4 timed sections/);
  await card.locator('button.btn-primary').click();
  await page.waitForSelector('.sections-info');
  assert.match(await page.textContent('.sections-list'), /Mathematics · 40 questions · 50 min/);
  await page.locator('.set-card').first().locator('button').click();

  // Mathematics: 40 questions, 50:00 on its own clock.
  await page.waitForSelector('.section-strip');
  assert.equal(await page.locator('.question-sidebar .palette-item').count(), 40);
  assert.match(await page.textContent('.timer'), /Mathematics\s*50:00/);
  assert.match(await page.textContent('.q-index'), /MATHEMATICS · QUESTION 1 OF 40/);
  await page.locator('.option').first().click();

  // Time runs out: Physics starts by itself and Mathematics can't be reopened.
  await page.clock.runFor(50 * 60 * 1000 + 1000);
  await page.waitForSelector('.section-notice');
  assert.match(await page.textContent('.section-notice'), /Time is up for Mathematics\. Physics has started/);
  assert.equal(await page.locator('.question-sidebar .palette-item').count(), 25);
  assert.match(await page.textContent('.section-step.done'), /Mathematics/);
  assert.equal(await page.locator('.question-panel img.q-image').count(), 1, 'image question is shown');

  // Finish Physics early from the review screen.
  await page.click('.question-sidebar .btn-ghost');
  await page.click('button:has-text("Finish section & start Chemistry")');
  await page.waitForSelector('.section-step.current:has-text("Chemistry")');
  assert.match(await page.textContent('.timer'), /Chemistry\s*30:00/);

  await page.click('.question-sidebar .btn-ghost');
  await page.click('button:has-text("Finish section & start Aptitude & English")');
  await page.waitForSelector('.section-step.current:has-text("Aptitude & English")');
  assert.equal(await page.locator('.question-sidebar .palette-item').count(), 10);

  // The last section's clock ending submits the exam.
  await page.clock.runFor(10 * 60 * 1000 + 1000);
  await page.waitForSelector('.section-scores');
  const scores = await page.textContent('.section-scores');
  assert.match(scores, /Mathematics.*\/ 40 correct/);
  assert.match(scores, /Physics0 \/ 25 correct/);
  assert.equal(await page.locator('.review-section-head').count(), 4);
  // The built-in bank has 7 diagram questions per set; the Physics one above may be one of them.
  const withImage = new DatabaseSync(srv.dbPath).prepare(`SELECT COUNT(*) AS n FROM questions q JOIN exams e ON e.id = q.exam_id
    WHERE e.slug = 'viteee' AND q.set_number = 1 AND q.image_data IS NOT NULL`).get().n;
  assert.ok(withImage === 7 || withImage === 8, String(withImage));
  assert.equal(await page.locator('.review-item img.q-image').count(), withImage);
  await ctx.close();
});

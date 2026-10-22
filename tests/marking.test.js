// VITEEE uses the real marking scheme (+4 correct, -1 wrong, 0 unanswered); IT exams keep percentage scoring.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { startServer, validUser } = require('./helpers');
const Marking = require('../src/marking');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(() => srv.stop());

function correctIndexes(ids){
  const d = new DatabaseSync(srv.dbPath, { readOnly: true });
  try{ return Object.fromEntries(ids.map(id => [id, d.prepare('SELECT correct_index FROM questions WHERE id = ?').get(id).correct_index])); }
  finally{ d.close(); }
}

test('Marking.score: +4 / -1 / 0, score % never below 0', () => {
  const m = Marking.VITEEE;
  const d = (c, s) => ({ isCorrect: c, selectedIndex: s });
  const r = Marking.score(m, [d(true, 0), d(true, 1), d(false, 2), d(false, null)]);
  assert.deepEqual([r.correctCount, r.wrongCount, r.unansweredCount, r.marks, r.maxMarks, r.scorePct], [2, 1, 1, 7, 16, 44]);
  assert.equal(Marking.score(m, [d(false, 1), d(false, 2)]).marks, -2);
  assert.equal(Marking.score(m, [d(false, 1), d(false, 2)]).scorePct, 0);
  assert.equal(Marking.score(null, [d(true, 0), d(false, 1)]).marks, null);
  assert.equal(Marking.score(null, [d(true, 0), d(false, 1)]).scorePct, 50);
  assert.equal(Marking.parse('{"correct":0,"wrong":-1,"unanswered":0}'), null);
  assert.equal(Marking.parse('nonsense'), null);
});

test('a VITEEE attempt is graded +4 / -1 / 0, and the result and history show the marks', async () => {
  const token = (await srv.signUp(validUser({ accountType: 'student' }))).data.token;
  const list = (await srv.api('/exams', { token })).data.exams;
  assert.deepEqual(list.find(e => e.slug === 'viteee').marking, { correct: 4, wrong: -1, unanswered: 0 });
  await srv.api('/payments/enroll', { method: 'POST', token, body: { examSlug: 'viteee' } });
  const sets = await srv.api('/exams/viteee/sets', { token });
  assert.deepEqual(sets.data.exam.marking, { correct: 4, wrong: -1, unanswered: 0 });

  const start = await srv.api('/exams/viteee/start', { method: 'POST', token, body: { setNumber: 1 } });
  assert.equal(start.status, 200);
  const qs = start.data.questions;
  const key = correctIndexes(qs.map(q => q.id));
  // 60 right, 20 wrong, 20 left blank (plus one junk answer, which counts as blank, not wrong).
  const answers = {};
  qs.slice(0, 60).forEach(q => { answers[q.id] = key[q.id]; });
  qs.slice(60, 80).forEach(q => { answers[q.id] = (key[q.id] + 1) % 4; });
  answers[qs[80].id] = 'x';
  const r = (await srv.api(`/exams/attempts/${start.data.attemptId}/submit`, { method: 'POST', token, body: { answers } })).data;
  assert.equal(r.total, 100);
  assert.deepEqual([r.correctCount, r.wrongCount, r.unansweredCount], [60, 20, 20]);
  assert.equal(r.marks, 60 * 4 - 20);
  assert.equal(r.maxMarks, 400);
  assert.equal(r.scorePct, 55);
  assert.equal(r.passed, true);                    // pass mark 50% of the marks
  assert.equal(r.sections.reduce((t, s) => t + s.marks, 0), r.marks);
  assert.equal(r.sections.reduce((t, s) => t + s.maxMarks, 0), 400);

  const again = (await srv.api(`/exams/attempts/${start.data.attemptId}`, { token })).data;
  assert.deepEqual([again.marks, again.maxMarks, again.wrongCount, again.scorePct], [220, 400, 20, 55]);
  const mine = (await srv.api('/exams/attempts/mine', { token })).data.attempts[0];
  assert.deepEqual([mine.marks, mine.maxMarks], [220, 400]);
});

test('lots of wrong answers can fail VITEEE even with many correct', async () => {
  const token = (await srv.signUp(validUser({ accountType: 'student' }))).data.token;
  await srv.api('/payments/enroll', { method: 'POST', token, body: { examSlug: 'viteee' } });
  const start = await srv.api('/exams/viteee/start', { method: 'POST', token, body: { setNumber: 1 } });
  const qs = start.data.questions;
  const key = correctIndexes(qs.map(q => q.id));
  const answers = {};
  qs.forEach((q, i) => { answers[q.id] = i < 55 ? key[q.id] : (key[q.id] + 1) % 4; });   // 55 right, 45 wrong
  const r = (await srv.api(`/exams/attempts/${start.data.attemptId}/submit`, { method: 'POST', token, body: { answers } })).data;
  assert.equal(r.marks, 55 * 4 - 45);              // 175 / 400 = 44%
  assert.equal(r.passed, false);
});

test('IT exams keep plain percentage scoring', async () => {
  const token = (await srv.signUp(validUser({ accountType: 'professional' }))).data.token;
  const free = (await srv.api('/exams', { token })).data.exams.find(e => !(e.price_inr_paise > 0));
  assert.equal(free.marking, null);
  const start = await srv.api(`/exams/${free.slug}/start`, { method: 'POST', token, body: { setNumber: 1 } });
  const qs = start.data.questions;
  const key = correctIndexes(qs.map(q => q.id));
  const answers = {};
  qs.slice(0, 3).forEach(q => { answers[q.id] = (key[q.id] + 1) % 4; });
  const r = (await srv.api(`/exams/attempts/${start.data.attemptId}/submit`, { method: 'POST', token, body: { answers } })).data;
  assert.equal(r.marks, null);
  assert.equal(r.marking, null);
  assert.equal(r.scorePct, 0);
});

test('an existing database gets the VITEEE scheme on upgrade', async () => {
  // A database from before marking schemes: no marking columns at all.
  srv.sql('ALTER TABLE exams DROP COLUMN marking');
  for(const c of ['marking', 'marks', 'max_marks']) srv.sql(`ALTER TABLE attempts DROP COLUMN ${c}`);
  await srv.restart();
  const token = (await srv.signUp(validUser({ accountType: 'student' }))).data.token;
  const list = (await srv.api('/exams', { token })).data.exams;
  assert.deepEqual(list.find(e => e.slug === 'viteee').marking, Marking.VITEEE);
  // Results from before the upgrade still load, as percentage scores.
  const old = (await srv.api('/exams/attempts/mine', { token })).data;
  assert.ok(Array.isArray(old.attempts));
});

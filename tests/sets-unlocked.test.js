// Admins can open every practice set of a certificate, so Set 1 doesn't have to be passed first.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, validUser } = require('./helpers');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(() => srv.stop());

async function admin(){
  const u = validUser();
  await srv.signUp(u);
  srv.sql('UPDATE users SET is_admin = 1 WHERE username = ?', u.username);
  return (await srv.api('/auth/login', { method: 'POST', body: { username: u.username, password: u.password } })).data.token;
}
// The certificate as the admin form would send it back, with one change.
async function saveExam(token, exam, change){
  const body = { name: exam.name, description: exam.description, shortLabel: exam.shortLabel, color: exam.color,
    durationMinutes: exam.durationMinutes, passPct: exam.passPct, priceInr: exam.priceInr, sections: exam.sections,
    audience: exam.audience, ...change };
  return srv.api(`/admin/exams/${exam.id}`, { method: 'PUT', token, body });
}

test('sets are locked in order by default, and the admin switch opens them all', async () => {
  const adminToken = await admin();
  const user = (await srv.signUp(validUser({ accountType: 'professional' }))).data.token;
  const exams = (await srv.api('/admin/exams', { token: adminToken })).data.exams;
  const exam = exams.find(e => e.priceInr === 0 && e.audience === 'professional');
  assert.equal(exam.setsUnlocked, false);

  const locked = (await srv.api(`/exams/${exam.slug}/sets`, { token: user })).data.sets;
  assert.deepEqual(locked.map(s => s.locked), [false, true, true, true, true]);
  assert.equal((await srv.api(`/exams/${exam.slug}/start`, { method: 'POST', token: user, body: { setNumber: 3 } })).status, 423);

  const saved = await saveExam(adminToken, exam, { setsUnlocked: true });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.exam.setsUnlocked, true);
  const open = (await srv.api(`/exams/${exam.slug}/sets`, { token: user })).data.sets;
  assert.deepEqual(open.map(s => s.locked), [false, false, false, false, false]);
  assert.equal((await srv.api(`/exams/${exam.slug}/start`, { method: 'POST', token: user, body: { setNumber: 3 } })).status, 200);

  // Saving the form without the field leaves it as it was; switching it off locks again.
  assert.equal((await saveExam(adminToken, exam, {})).data.exam.setsUnlocked, true);
  assert.equal((await saveExam(adminToken, exam, { setsUnlocked: 'yes' })).status, 400);
  assert.equal((await saveExam(adminToken, exam, { setsUnlocked: false })).data.exam.setsUnlocked, false);
  assert.equal((await srv.api(`/exams/${exam.slug}/start`, { method: 'POST', token: user, body: { setNumber: 3 } })).status, 423);
});

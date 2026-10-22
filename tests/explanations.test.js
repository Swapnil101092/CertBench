// Answer explanations: why the correct answer is right, shown with each answer on the results page.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { startServer, validUser } = require('./helpers');
const { BANKS } = require('../src/banks/sectioned');
const Explanations = require('../src/explanations');

let srv, admin, student;
const query = (sql, ...params) => { const d = new DatabaseSync(srv.dbPath); try{ return d.prepare(sql).all(...params); } finally { d.close(); } };
async function login(u){ return (await srv.api('/auth/login', { method: 'POST', body: { username: u.username, password: u.password } })).data.token; }

test.before(async () => {
  srv = await startServer();
  const a = validUser({ username: 'why_admin' });
  await srv.signUp(a);
  srv.sql('UPDATE users SET is_admin = 1 WHERE username = ?', a.username);
  admin = await login(a);
  const s = validUser({ username: 'why_student' });
  await srv.signUp(s);
  student = await login(s);
  srv.sql("UPDATE exams SET price_inr_paise = 0 WHERE slug = 'viteee'");   // skip payment in these tests
});
test.after(() => srv && srv.stop());

test('every VITEEE question has a built-in explanation, keyed by its exact text', () => {
  const bank = BANKS.find(b => b.slug === 'viteee');
  const texts = Object.values(bank.sectionPools).flat().map(q => q[0]);
  const why = Explanations.forSlug('viteee');
  assert.equal(why.size, texts.length);
  for(const t of texts) assert.ok(why.get(t) && why.get(t).length >= 20, `explanation for: ${t}`);
  assert.equal(query("SELECT COUNT(*) AS n FROM questions q JOIN exams e ON e.id = q.exam_id WHERE e.slug = 'viteee' AND (q.explanation IS NULL OR q.explanation = '')")[0].n, 0);
});

test('results include the explanation for every answer, but the exam itself never sends it', async () => {
  const start = await srv.api('/exams/viteee/start', { method: 'POST', token: student, body: { setNumber: 1 } });
  assert.equal(start.status, 200);
  assert.ok(start.data.questions.every(q => !('explanation' in q)));
  const first = start.data.questions[0];
  const sub = await srv.api(`/exams/attempts/${start.data.attemptId}/submit`, { method: 'POST', token: student, body: { answers: { [first.id]: 0 } } });
  assert.equal(sub.status, 200);
  assert.ok(sub.data.detail.every(d => typeof d.explanation === 'string' && d.explanation.length > 0));
  const again = await srv.api(`/exams/attempts/${start.data.attemptId}`, { token: student });
  assert.deepEqual(again.data.detail.map(d => d.explanation), sub.data.detail.map(d => d.explanation));
});

test('a database seeded before the explanations existed gets them on the next start; admin edits are kept', async () => {
  const [one, two] = query("SELECT q.id FROM questions q JOIN exams e ON e.id = q.exam_id WHERE e.slug = 'viteee' ORDER BY q.id LIMIT 2");
  srv.sql("UPDATE questions SET explanation = NULL WHERE exam_id = (SELECT id FROM exams WHERE slug = 'viteee')");
  srv.sql("UPDATE questions SET explanation = '' WHERE id = ?", one.id);           // cleared in the admin panel
  srv.sql("UPDATE questions SET explanation = 'My own words.' WHERE id = ?", two.id);
  await srv.restart();
  const rows = query("SELECT q.id, q.explanation FROM questions q JOIN exams e ON e.id = q.exam_id WHERE e.slug = 'viteee'");
  assert.equal(rows.find(r => r.id === one.id).explanation, '');
  assert.equal(rows.find(r => r.id === two.id).explanation, 'My own words.');
  assert.ok(rows.filter(r => r.id !== one.id && r.id !== two.id).every(r => r.explanation && r.explanation.length >= 20));
});

test('admins can write, change and clear explanations, and import them from CSV', async () => {
  const exam = (await srv.api('/admin/exams', { token: admin })).data.exams.find(e => !e.sections);
  const add = await srv.api(`/admin/exams/${exam.id}/questions`, { method: 'POST', token: admin, body: {
    text: 'Which planet is known as the Red Planet?', options: ['Mars', 'Venus', 'Jupiter', 'Saturn'], correctIndex: 0, set: 1,
    explanation: '  Iron oxide (rust) on its surface makes Mars look red.  ' } });
  assert.equal(add.status, 201);
  const list = async () => (await srv.api(`/admin/exams/${exam.id}/questions`, { token: admin })).data.questions;
  const q = (await list()).find(x => x.text.startsWith('Which planet is known'));
  assert.equal(q.explanation, 'Iron oxide (rust) on its surface makes Mars look red.');

  const edit = (body) => srv.api(`/admin/questions/${q.id}`, { method: 'PUT', token: admin, body: { text: q.text, options: q.options, correctIndex: 0, ...body } });
  assert.equal((await edit({})).status, 200);                                     // left out = unchanged
  assert.equal((await list()).find(x => x.id === q.id).explanation, q.explanation);
  assert.equal((await edit({ explanation: 'x'.repeat(1001) })).status, 400);
  assert.equal((await edit({ explanation: 7 })).status, 400);
  assert.equal((await edit({ explanation: '' })).status, 200);
  assert.equal((await list()).find(x => x.id === q.id).explanation, '');

  const csv = 'question,option_a,option_b,option_c,option_d,correct,explanation\n' +
    '"What is the boiling point of water at sea level?","100 °C","90 °C","80 °C","120 °C",A,"At 1 atm, water boils at 100 °C."\n' +
    '"Which gas do plants take in for photosynthesis?","Carbon dioxide","Oxygen","Nitrogen","Helium",A,\n';
  const imp = await srv.api(`/admin/exams/${exam.id}/import`, { method: 'POST', token: admin, body: { csv, target: 2 } });
  assert.equal(imp.status, 200, JSON.stringify(imp.data));
  const after = await list();
  assert.equal(after.find(x => x.text.startsWith('What is the boiling')).explanation, 'At 1 atm, water boils at 100 °C.');
  assert.equal(after.find(x => x.text.startsWith('Which gas do plants')).explanation, '');
});

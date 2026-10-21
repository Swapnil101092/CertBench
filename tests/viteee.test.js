// VITEEE: one certificate split into timed sections, and questions that are (or include) an image.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { startServer, validUser } = require('./helpers');
const { META, BANKS } = require('../src/banks/sectioned');

// A real 1x1 PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
// Maths answers differ by signs and symbols (π/3 vs −π/3), so compare options as typed (like the admin panel does).
const norm = s => String(s).trim().toLowerCase();

let srv, admin, student;
test.before(async () => {
  srv = await startServer();
  const a = validUser({ username: 'vit_admin' });
  await srv.signUp(a);
  srv.sql('UPDATE users SET is_admin = 1 WHERE username = ?', a.username);
  admin = (await srv.api('/auth/login', { method: 'POST', body: { username: a.username, password: a.password } })).data.token;
  const s = validUser({ username: 'vit_student' });
  await srv.signUp(s);
  student = (await srv.api('/auth/login', { method: 'POST', body: { username: s.username, password: s.password } })).data.token;
  srv.sql("UPDATE exams SET price_inr_paise = 0 WHERE slug = 'viteee'");   // skip payment in these tests
});
test.after(() => srv && srv.stop());

test('viteee bank: well-formed, unique questions in every pool, enough for two full papers', () => {
  const bank = BANKS.find(b => b.slug === 'viteee');
  assert.deepEqual(bank.sections.map(s => [s.name, s.questions, s.minutes]),
    [['Mathematics', 40, 50], ['Physics', 25, 30], ['Chemistry', 25, 30], ['Aptitude & English', 10, 10]]);
  assert.equal(bank.duration_minutes, 120);
  const seen = new Set();
  for(const s of bank.seedSections){
    for(const part of (s.parts || [{ pool: s.name, questions: s.questions }])){
      const pool = bank.sectionPools[part.pool];
      assert.ok(pool && pool.length >= part.questions * 2, `${part.pool}: at least two sets' worth of unique questions`);
      pool.forEach((q, i) => {
        const where = `${part.pool} #${i + 1}`;
        assert.equal(q.length, 6, where);
        assert.equal(q[5], 0, where);
        assert.ok(q[0].length >= 10 && q[0].length <= 500, where);
        q.slice(1, 5).forEach(o => assert.ok(typeof o === 'string' && o.trim() && o.length <= 200, where));
        assert.equal(new Set(q.slice(1, 5).map(norm)).size, 4, `${where}: options are distinct`);
        assert.ok(!seen.has(norm(q[0])), `${where}: duplicate question`);
        seen.add(norm(q[0]));
      });
    }
  }
  assert.ok(META[0].short_label.length <= 4);
});

test('viteee: seeded as 5 sets of 100, section by section, 5 Aptitude + 5 English each', () => {
  const db = new DatabaseSync(srv.dbPath);
  try{
    const exam = db.prepare("SELECT * FROM exams WHERE slug = 'viteee'").get();
    assert.ok(exam);
    assert.equal(exam.duration_minutes, 120);
    for(let set = 1; set <= 5; set++){
      const rows = db.prepare('SELECT section, COUNT(*) AS n FROM questions WHERE exam_id = ? AND set_number = ? GROUP BY section').all(exam.id, set);
      assert.deepEqual(Object.fromEntries(rows.map(r => [r.section, r.n])), { Mathematics: 40, Physics: 25, Chemistry: 25, 'Aptitude & English': 10 }, 'set ' + set);
    }
    // Sets 1 and 2 share no questions.
    const shared = db.prepare('SELECT COUNT(*) AS n FROM questions a JOIN questions b ON a.text = b.text WHERE a.exam_id = ? AND b.exam_id = ? AND a.set_number = 1 AND b.set_number = 2').get(exam.id, exam.id).n;
    assert.equal(shared, 0);
  } finally { db.close(); }
});

test('viteee: start returns the sections in order with their timers, and questions grouped by section', async () => {
  const sets = await srv.api('/exams/viteee/sets', { token: student });
  assert.equal(sets.status, 200);
  assert.equal(sets.data.exam.sections.length, 4);
  const r = await srv.api('/exams/viteee/start', { method: 'POST', token: student, body: { setNumber: 1 } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.sections, [
    { name: 'Mathematics', minutes: 50, questionCount: 40 },
    { name: 'Physics', minutes: 30, questionCount: 25 },
    { name: 'Chemistry', minutes: 30, questionCount: 25 },
    { name: 'Aptitude & English', minutes: 10, questionCount: 10 }
  ]);
  assert.equal(r.data.questions.length, 100);
  const order = r.data.questions.map(q => q.section);
  assert.equal(order.slice(0, 40).every(s => s === 'Mathematics'), true);
  assert.equal(order.slice(90).every(s => s === 'Aptitude & English'), true);

  // Answer every Physics question right (using the answer key from the database), submit, and check the breakdown.
  const db = new DatabaseSync(srv.dbPath);
  const answers = {};
  try{
    for(const q of r.data.questions.filter(q => q.section === 'Physics')){
      answers[q.id] = db.prepare('SELECT correct_index FROM questions WHERE id = ?').get(q.id).correct_index;
    }
  } finally { db.close(); }
  const sub = await srv.api(`/exams/attempts/${r.data.attemptId}/submit`, { method: 'POST', token: student, body: { answers } });
  assert.equal(sub.status, 200);
  assert.equal(sub.data.correctCount, 25);
  assert.deepEqual(sub.data.sections.map(s => [s.name, s.correct, s.total]),
    [['Mathematics', 0, 40], ['Physics', 25, 25], ['Chemistry', 0, 25], ['Aptitude & English', 0, 10]]);
  assert.equal(sub.data.detail[40].section, 'Physics');
  const again = await srv.api(`/exams/attempts/${r.data.attemptId}`, { token: student });
  assert.deepEqual(again.data.sections, sub.data.sections);
});

test('admin: add an image question to a section; students get the image, short text is fine with an image', async () => {
  const exam = (await srv.api('/admin/exams', { token: admin })).data.exams.find(e => e.slug === 'viteee');
  assert.equal(exam.sections.length, 4);
  assert.deepEqual(exam.sectionCounts[0], { name: 'Mathematics', sets: [40, 40, 40, 40, 40] });

  const noSection = await srv.api(`/admin/exams/${exam.id}/questions`, { method: 'POST', token: admin,
    body: { text: 'Which graph is shown?', options: ['a', 'b', 'c', 'd'], correctIndex: 0, set: 1 } });
  assert.equal(noSection.status, 400);
  assert.match(noSection.data.error, /section/i);

  const tooShort = await srv.api(`/admin/exams/${exam.id}/questions`, { method: 'POST', token: admin,
    body: { text: 'Fig?', section: 'Physics', options: ['a', 'b', 'c', 'd'], correctIndex: 0, set: 1 } });
  assert.equal(tooShort.status, 400, 'short text without an image is rejected');

  const bad = await srv.api(`/admin/exams/${exam.id}/questions`, { method: 'POST', token: admin,
    body: { text: 'Fig?', section: 'Physics', options: ['a', 'b', 'c', 'd'], correctIndex: 0, set: 1, image: 'data:image/png;base64,aGVsbG8=' } });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /JPEG, PNG or WebP/);

  const ok = await srv.api(`/admin/exams/${exam.id}/questions`, { method: 'POST', token: admin,
    body: { text: 'Fig?', section: 'physics', options: ['1 N', '2 N', '3 N', '4 N'], correctIndex: 2, set: 1, image: PNG } });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));

  const list = (await srv.api(`/admin/exams/${exam.id}/questions`, { token: admin })).data.questions;
  const mine = list.find(q => q.text === 'Fig?');
  assert.equal(mine.section, 'Physics');
  assert.equal(mine.hasImage, true);
  const img = await srv.api(`/admin/questions/${mine.id}/image`, { token: admin });
  assert.equal(img.data.image, PNG);

  // Editing without sending `image` keeps it; sending null removes it (and then the short text is no longer allowed).
  const keep = await srv.api(`/admin/questions/${mine.id}`, { method: 'PUT', token: admin, body: { text: 'Fig 1?', section: 'Physics', options: ['1 N', '2 N', '3 N', '4 N'], correctIndex: 2 } });
  assert.equal(keep.status, 200);
  assert.equal((await srv.api(`/admin/questions/${mine.id}/image`, { token: admin })).data.image, PNG);
  const drop = await srv.api(`/admin/questions/${mine.id}`, { method: 'PUT', token: admin, body: { text: 'Fig 1?', section: 'Physics', options: ['1 N', '2 N', '3 N', '4 N'], correctIndex: 2, image: null } });
  assert.equal(drop.status, 400);

  // A student starting set 1 sees it inside the Physics section, with the picture.
  const start = await srv.api('/exams/viteee/start', { method: 'POST', token: student, body: { setNumber: 1 } });
  const q = start.data.questions.find(x => x.id === mine.id);
  assert.equal(q.section, 'Physics');
  assert.equal(q.image, PNG);
  assert.equal(start.data.sections[1].questionCount, 26);
  assert.ok(start.data.questions.slice(40, 66).some(x => x.id === mine.id));
});

test('admin: sections on any certificate; renaming a section moves its questions; the time limit is the total', async () => {
  const create = await srv.api('/admin/exams', { method: 'POST', token: admin, body: {
    slug: 'mini-mock', name: 'Mini mock', description: 'A small sectioned mock exam.', shortLabel: 'MM', color: '#123456',
    durationMinutes: 60, passPct: 50, priceInr: 0,
    sections: [{ name: 'Part A', questions: 2, minutes: 5 }, { name: 'Part B', questions: 2, minutes: 7 }] } });
  assert.equal(create.status, 201, JSON.stringify(create.data));
  assert.equal(create.data.exam.durationMinutes, 12);
  const id = create.data.exam.id;

  const dupName = await srv.api('/admin/exams/' + id, { method: 'PUT', token: admin, body: {
    name: 'Mini mock', description: 'A small sectioned mock exam.', shortLabel: 'MM', color: '#123456', passPct: 50, priceInr: 0,
    sections: [{ name: 'Same', questions: 1, minutes: 5 }, { name: 'same', questions: 1, minutes: 5 }] } });
  assert.equal(dupName.status, 400);
  assert.ok(dupName.data.fields.sections);

  await srv.api(`/admin/exams/${id}/questions`, { method: 'POST', token: admin, body: { text: 'Question in part B?', section: 'Part B', options: ['w', 'x', 'y', 'z'], correctIndex: 0, set: 1 } });
  const rename = await srv.api('/admin/exams/' + id, { method: 'PUT', token: admin, body: {
    name: 'Mini mock', description: 'A small sectioned mock exam.', shortLabel: 'MM', color: '#123456', passPct: 50, priceInr: 0,
    sections: [{ name: 'Part A', questions: 2, minutes: 5 }, { name: 'Reading', questions: 2, minutes: 10 }] } });
  assert.equal(rename.status, 200);
  assert.equal(rename.data.exam.durationMinutes, 15);
  const qs = (await srv.api(`/admin/exams/${id}/questions`, { token: admin })).data.questions;
  assert.equal(qs[0].section, 'Reading');

  // CSV import with a section column.
  const csv = 'question,option_a,option_b,option_c,option_d,correct,section\n"First imported question?",a,b,c,d,A,Part A\n"Second imported question?",a,b,c,d,B,nowhere\n';
  const imp = await srv.api(`/admin/exams/${id}/import`, { method: 'POST', token: admin, body: { csv, target: 1 } });
  assert.equal(imp.status, 400);
  assert.match(imp.data.rowErrors[0].message, /section/i);
  const imp2 = await srv.api(`/admin/exams/${id}/import`, { method: 'POST', token: admin, body: { csv: csv.replace('nowhere', 'reading'), target: 1 } });
  assert.equal(imp2.status, 200, JSON.stringify(imp2.data));

  // Turning sections off brings back the single time limit.
  const off = await srv.api('/admin/exams/' + id, { method: 'PUT', token: admin, body: {
    name: 'Mini mock', description: 'A small sectioned mock exam.', shortLabel: 'MM', color: '#123456', durationMinutes: 30, passPct: 50, priceInr: 0, sections: null } });
  assert.equal(off.status, 200);
  assert.equal(off.data.exam.sections, null);
  assert.equal(off.data.exam.durationMinutes, 30);
});

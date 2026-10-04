// The built-in certification banks in src/banks/, and how they reach a database on start.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { startServer } = require('./helpers');
const { META } = require('../src/banks');

const BANK_DIR = path.join(__dirname, '..', 'src', 'banks');
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

test('banks: every exam has 150 well-formed, unique questions', () => {
  const jsonFiles = fs.readdirSync(BANK_DIR).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')).sort();
  assert.deepEqual(jsonFiles, META.map(m => m.slug).sort(), 'one questions file per exam, none orphaned');
  assert.equal(new Set(META.map(m => m.slug)).size, META.length, 'slugs are unique');
  assert.equal(new Set(META.map(m => m.short_label)).size, META.length, 'badges are unique');
  for(const m of META){
    // Same limits the admin panel enforces, so every built-in exam stays editable there.
    assert.match(m.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.match(m.short_label, /^[A-Za-z0-9+#.]{1,4}$/, m.slug);
    assert.ok(m.name.length >= 3 && m.name.length <= 80, m.slug);
    assert.ok(m.description.length >= 10 && m.description.length <= 300, m.slug);
    const qs = require(path.join(BANK_DIR, m.slug + '.json'));
    assert.equal(qs.length, 150, `${m.slug} has 150 questions`);
    const seen = new Set();
    qs.forEach((q, i) => {
      const where = `${m.slug} #${i + 1}`;
      assert.equal(q.length, 6, where);
      assert.equal(q[5], 0, where);
      assert.ok(q[0].length >= 10 && q[0].length <= 500, where);
      q.slice(1, 5).forEach(o => assert.ok(typeof o === 'string' && o.trim() && o.length <= 200, where));
      assert.equal(new Set(q.slice(1, 5).map(norm)).size, 4, `${where}: options are distinct`);
      assert.ok(!seen.has(norm(q[0])), `${where}: duplicate question`);
      seen.add(norm(q[0]));
    });
  }
});

test('banks: a fresh database gets every exam as 5 sets of 30 with no repeats', async () => {
  const srv = await startServer();
  try{
    const db = new DatabaseSync(srv.dbPath);
    try{
      for(const m of META){
        const exam = db.prepare('SELECT id FROM exams WHERE slug = ?').get(m.slug);
        assert.ok(exam, `${m.slug} was seeded`);
        const sets = db.prepare('SELECT set_number, COUNT(*) AS n FROM questions WHERE exam_id = ? GROUP BY set_number ORDER BY set_number').all(exam.id);
        assert.deepEqual(sets.map(s => [s.set_number, s.n]), [[1, 30], [2, 30], [3, 30], [4, 30], [5, 30]], m.slug);
        const distinct = db.prepare('SELECT COUNT(DISTINCT text) AS n FROM questions WHERE exam_id = ?').get(exam.id).n;
        assert.equal(distinct, 150, `${m.slug}: no question repeats across sets`);
      }
    } finally { db.close(); }
    const r = await srv.api('/exams');
    assert.equal(r.status, 200);
    const slugs = (r.data.exams || r.data).map(e => e.slug);
    for(const m of META) assert.ok(slugs.includes(m.slug), `${m.slug} is listed`);
  } finally { srv.stop(); }
});

test('banks: an existing database gets new exams once, and deleted exams stay deleted', async () => {
  const srv = await startServer();
  try{
    const count = () => { const d = new DatabaseSync(srv.dbPath); try{ return d.prepare('SELECT slug FROM exams').all().map(r => r.slug); } finally { d.close(); } };
    // Make it look like a database from before src/banks existed, whose admin later deleted GCP.
    srv.sql("DELETE FROM settings WHERE name = 'builtin_exams_offered'");
    for(const m of META) srv.sql('DELETE FROM exams WHERE slug = ?', m.slug);
    srv.sql("DELETE FROM exams WHERE slug = 'gcp'");
    assert.equal(count().length, 5);

    await srv.restart();
    let slugs = count();
    for(const m of META) assert.ok(slugs.includes(m.slug), `${m.slug} added on the next start`);
    assert.ok(!slugs.includes('gcp'), 'an exam the admin deleted is not brought back');

    // Deleting one of the new exams afterwards also sticks.
    srv.sql('DELETE FROM exams WHERE slug = ?', META[0].slug);
    await srv.restart();
    slugs = count();
    assert.ok(!slugs.includes(META[0].slug));
    assert.equal(slugs.length, 5 + META.length - 1);
  } finally { srv.stop(); }
});

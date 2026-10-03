const express = require('express');
const db = require('../db');
const bcrypt = require('bcryptjs');
const { requireAdmin, isAdminUser, adminEmailList, adminEmailsActive, countActiveUsers, ACTIVE_WINDOW_MINUTES } = require('../auth');
const V = require('../validation');
const { parseCsv, toQuestionRows } = require('../csv');
const settings = require('../settings');
const reviews = require('../reviews');
const photos = require('../photos');

const router = express.Router();
router.use(requireAdmin);          // every route below needs a logged-in admin (checked in the database each time)

const SET_COUNT = 5;
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;

function audit(req, action, detail){
  db.prepare('INSERT INTO admin_audit (user_id, username, action, detail) VALUES (?, ?, ?, ?)')
    .run(req.adminUser.id, req.adminUser.username, action, String(detail || '').slice(0, 300));
}
function toId(v){
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}
function fail(res, status, error, extra){
  return res.status(status).json(Object.assign({ error }, extra || {}));
}

// ---------------------------------------------------------------- certificates (exams)

function describeExams(onlyId){
  const exams = onlyId
    ? db.prepare('SELECT * FROM exams WHERE id = ?').all(onlyId)
    : db.prepare('SELECT * FROM exams ORDER BY id').all();
  const setRows = db.prepare('SELECT exam_id, set_number, COUNT(*) AS c FROM questions WHERE active = 1 GROUP BY exam_id, set_number').all();
  const paidRows = db.prepare("SELECT exam_id, COUNT(*) AS c FROM enrollments WHERE status = 'paid' AND amount_paise > 0 GROUP BY exam_id").all();
  const attemptRows = db.prepare('SELECT exam_id, COUNT(*) AS c FROM attempts WHERE finished_at IS NOT NULL GROUP BY exam_id').all();
  return exams.map(e => {
    const setCounts = Array.from({ length: SET_COUNT }, (_, i) => {
      const r = setRows.find(x => x.exam_id === e.id && x.set_number === i + 1);
      return r ? r.c : 0;
    });
    const paid = paidRows.find(x => x.exam_id === e.id);
    const att = attemptRows.find(x => x.exam_id === e.id);
    return {
      id: e.id, slug: e.slug, name: e.name, description: e.description,
      shortLabel: e.short_label, color: e.color,
      durationMinutes: e.duration_minutes, passPct: e.pass_pct,
      priceInr: e.price_inr_paise / 100,
      active: !!e.active, source: e.source,
      setCounts, totalQuestions: setCounts.reduce((a, b) => a + b, 0),
      paidEnrollments: paid ? paid.c : 0, attempts: att ? att.c : 0
    };
  });
}

function validateExam(body, creating){
  const errors = {};
  const v = {};
  const b = body || {};
  const str = (x) => (typeof x === 'string' ? x.trim() : '');

  if(creating){
    const slug = str(b.slug).toLowerCase();
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 2 || slug.length > 40){
      errors.slug = 'Use 2-40 lowercase letters, numbers and single hyphens (e.g. "azure-ai-900").';
    } else if(db.prepare('SELECT 1 FROM exams WHERE slug = ?').get(slug)){
      errors.slug = 'That short name is already used by another certificate.';
    } else v.slug = slug;
  }
  const name = str(b.name);
  if(name.length < 3 || name.length > 80 || CONTROL_RE.test(name)) errors.name = 'Name must be 3-80 characters.';
  else v.name = name;

  const description = str(b.description);
  if(description.length < 10 || description.length > 300 || CONTROL_RE.test(description)) errors.description = 'Description must be 10-300 characters.';
  else v.description = description;

  const shortLabel = str(b.shortLabel);
  if(!/^[A-Za-z0-9+#.]{1,4}$/.test(shortLabel)) errors.shortLabel = 'Badge text must be 1-4 letters/numbers (it has to fit a small badge), e.g. "AZ".';
  else v.short_label = shortLabel;

  const color = str(b.color);
  if(!/^#[0-9a-fA-F]{6}$/.test(color)) errors.color = 'Pick a colour like #22c9a3.';
  else v.color = color.toLowerCase();

  const dur = b.durationMinutes;
  if(!Number.isInteger(dur) || dur < 5 || dur > 300) errors.durationMinutes = 'Time limit must be a whole number of minutes, 5-300.';
  else v.duration_minutes = dur;

  const pass = b.passPct;
  if(!Number.isInteger(pass) || pass < 1 || pass > 100) errors.passPct = 'Pass mark must be a whole number, 1-100.';
  else v.pass_pct = pass;

  const price = b.priceInr;
  if(typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 100000 || Math.abs(price * 100 - Math.round(price * 100)) > 1e-6){
    errors.priceInr = 'Price must be 0 (free) up to 100000, with at most 2 decimals.';
  } else v.price_inr_paise = Math.round(price * 100);

  return { errors, values: v };
}

router.get('/exams', (req, res) => {
  res.json({ exams: describeExams() });
});

router.get('/exams/:id', (req, res) => {
  const id = toId(req.params.id);
  const list = id ? describeExams(id) : [];
  if(!list.length) return fail(res, 404, 'Certificate not found.');
  res.json({ exam: list[0] });
});

router.post('/exams', (req, res) => {
  const { errors, values } = validateExam(req.body, true);
  if(Object.keys(errors).length) return fail(res, 400, 'Please fix the highlighted fields.', { fields: errors });
  // New certificates start hidden ("draft") until they have questions and you publish them.
  const info = db.prepare(`
    INSERT INTO exams (slug, name, description, duration_minutes, pass_pct, color, short_label, price_inr_paise, active, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'admin')
  `).run(values.slug, values.name, values.description, values.duration_minutes, values.pass_pct, values.color, values.short_label, values.price_inr_paise);
  audit(req, 'exam.create', `${values.slug} ("${values.name}")`);
  res.status(201).json({ exam: describeExams(info.lastInsertRowid)[0] });
});

router.put('/exams/:id', (req, res) => {
  const id = toId(req.params.id);
  const exam = id && db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
  if(!exam) return fail(res, 404, 'Certificate not found.');
  if(req.body && req.body.slug !== undefined && String(req.body.slug).toLowerCase() !== exam.slug){
    return fail(res, 400, 'The short name (slug) cannot be changed after a certificate is created.', { fields: { slug: 'Cannot be changed.' } });
  }
  const { errors, values } = validateExam(req.body, false);
  if(Object.keys(errors).length) return fail(res, 400, 'Please fix the highlighted fields.', { fields: errors });
  db.prepare(`
    UPDATE exams SET name = ?, description = ?, duration_minutes = ?, pass_pct = ?, color = ?, short_label = ?, price_inr_paise = ?, source = 'admin'
    WHERE id = ?
  `).run(values.name, values.description, values.duration_minutes, values.pass_pct, values.color, values.short_label, values.price_inr_paise, id);
  audit(req, 'exam.update', `${exam.slug}`);
  res.json({ exam: describeExams(id)[0] });
});

router.post('/exams/:id/publish', (req, res) => {
  const id = toId(req.params.id);
  const exam = id && describeExams(id)[0];
  if(!exam) return fail(res, 404, 'Certificate not found.');
  if(typeof (req.body || {}).active !== 'boolean') return fail(res, 400, 'Send { "active": true } or { "active": false }.');
  const active = req.body.active;
  if(active){
    const emptySets = exam.setCounts.map((c, i) => (c === 0 ? i + 1 : null)).filter(Boolean);
    if(emptySets.length){
      return fail(res, 400, `Every set needs at least one question before students can see this certificate. Empty: Set ${emptySets.join(', Set ')}.`, { emptySets });
    }
  }
  db.prepare("UPDATE exams SET active = ?, source = 'admin' WHERE id = ?").run(active ? 1 : 0, id);
  audit(req, active ? 'exam.publish' : 'exam.hide', exam.slug);
  res.json({ exam: describeExams(id)[0] });
});

router.delete('/exams/:id', (req, res) => {
  const id = toId(req.params.id);
  const exam = id && describeExams(id)[0];
  if(!exam) return fail(res, 404, 'Certificate not found.');
  const confirmName = typeof (req.body || {}).confirmName === 'string' ? req.body.confirmName.trim() : '';
  if(confirmName !== exam.name) return fail(res, 400, 'Type the certificate name exactly to confirm deletion.');
  if(exam.paidEnrollments > 0){
    return fail(res, 409, `${exam.paidEnrollments} student(s) have paid for this certificate, so it can't be deleted. Use "Hide" instead: students lose access while it's hidden, and all their payment and result records are kept.`, { paidEnrollments: exam.paidEnrollments });
  }
  // Cascades to its questions, attempts and enrollments (none of the enrollments are paid).
  db.prepare('DELETE FROM exams WHERE id = ?').run(id);
  audit(req, 'exam.delete', `${exam.slug} ("${exam.name}"), ${exam.totalQuestions} questions, ${exam.attempts} attempts`);
  res.json({ deleted: true });
});

// ---------------------------------------------------------------- questions

function validateQuestion(q){
  const text = typeof q.text === 'string' ? q.text.trim() : '';
  if(text.length < 10 || text.length > 500) return { error: 'The question must be 10-500 characters.' };
  if(CONTROL_RE.test(text)) return { error: 'The question contains characters that are not allowed.' };
  if(!Array.isArray(q.options) || q.options.length !== 4) return { error: 'Provide exactly 4 answer options.' };
  const options = q.options.map(o => (typeof o === 'string' ? o.trim() : ''));
  if(options.some(o => !o || o.length > 200 || CONTROL_RE.test(o))) return { error: 'Each answer option must be 1-200 characters.' };
  if(new Set(options.map(o => o.toLowerCase())).size !== 4) return { error: 'The 4 answer options must all be different.' };
  if(!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3) return { error: 'Choose which option is the correct answer.' };
  return { clean: { text, options, correctIndex: q.correctIndex } };
}

function setCountsFor(examId){
  const counts = Array(SET_COUNT).fill(0);
  for(const r of db.prepare('SELECT set_number, COUNT(*) AS c FROM questions WHERE exam_id = ? AND active = 1 GROUP BY set_number').all(examId)){
    if(r.set_number >= 1 && r.set_number <= SET_COUNT) counts[r.set_number - 1] = r.c;
  }
  return counts;
}
function leastFullSet(counts){
  let best = 0;
  for(let i = 1; i < counts.length; i++) if(counts[i] < counts[best]) best = i;
  return best + 1;
}
function insertQuestion(examId, setNumber, clean){
  const seq = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM questions WHERE exam_id = ? AND set_number = ?').get(examId, setNumber).n;
  db.prepare(`
    INSERT INTO questions (exam_id, set_number, seq, text, option_a, option_b, option_c, option_d, correct_index, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(examId, setNumber, seq, clean.text, clean.options[0], clean.options[1], clean.options[2], clean.options[3], clean.correctIndex);
}
function markAdminManaged(examId){
  db.prepare("UPDATE exams SET source = 'admin' WHERE id = ?").run(examId);
}

router.get('/exams/:id/questions', (req, res) => {
  const id = toId(req.params.id);
  if(!id || !db.prepare('SELECT 1 FROM exams WHERE id = ?').get(id)) return fail(res, 404, 'Certificate not found.');
  const rows = db.prepare('SELECT * FROM questions WHERE exam_id = ? AND active = 1 ORDER BY set_number, seq').all(id);
  const setsByText = new Map();
  for(const r of rows){
    const k = r.text.trim().toLowerCase();
    if(!setsByText.has(k)) setsByText.set(k, []);
    setsByText.get(k).push(r.set_number);
  }
  res.json({
    questions: rows.map(r => ({
      id: r.id, set: r.set_number, seq: r.seq, text: r.text,
      options: [r.option_a, r.option_b, r.option_c, r.option_d], correctIndex: r.correct_index,
      alsoInSets: [...new Set(setsByText.get(r.text.trim().toLowerCase()).filter(s => s !== r.set_number))]
    }))
  });
});

router.post('/exams/:id/questions', (req, res) => {
  const id = toId(req.params.id);
  const exam = id && db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
  if(!exam) return fail(res, 404, 'Certificate not found.');
  const { error, clean } = validateQuestion(req.body || {});
  if(error) return fail(res, 400, error);

  const counts = setCountsFor(id);
  let setNumber;
  const wanted = (req.body || {}).set;
  if(wanted === 'auto' || wanted === undefined) setNumber = leastFullSet(counts);
  else if(Number.isInteger(wanted) && wanted >= 1 && wanted <= SET_COUNT) setNumber = wanted;
  else return fail(res, 400, `Choose a set from 1 to ${SET_COUNT}, or "auto".`);

  const dup = db.prepare('SELECT 1 FROM questions WHERE exam_id = ? AND set_number = ? AND active = 1 AND lower(trim(text)) = ?')
    .get(id, setNumber, clean.text.toLowerCase());
  if(dup) return fail(res, 400, `Set ${setNumber} already contains this exact question.`);

  insertQuestion(id, setNumber, clean);
  markAdminManaged(id);
  audit(req, 'question.add', `${exam.slug} set ${setNumber}`);
  res.status(201).json({ added: true, set: setNumber });
});

router.put('/questions/:id', (req, res) => {
  const id = toId(req.params.id);
  const row = id && db.prepare('SELECT * FROM questions WHERE id = ? AND active = 1').get(id);
  if(!row) return fail(res, 404, 'Question not found.');
  const { error, clean } = validateQuestion(req.body || {});
  if(error) return fail(res, 400, error);

  const oldKey = row.text.trim().toLowerCase();
  const targets = (req.body || {}).applyToCopies
    ? db.prepare('SELECT * FROM questions WHERE exam_id = ? AND active = 1 AND lower(trim(text)) = ?').all(row.exam_id, oldKey)
    : [row];
  const targetIds = targets.map(t => t.id);
  const newKey = clean.text.toLowerCase();
  for(const t of targets){
    const clash = db.prepare('SELECT id FROM questions WHERE exam_id = ? AND set_number = ? AND active = 1 AND lower(trim(text)) = ?')
      .all(row.exam_id, t.set_number, newKey).find(r => !targetIds.includes(r.id));
    if(clash) return fail(res, 400, `Set ${t.set_number} already contains a question with this exact text.`);
  }
  db.transaction(() => {
    const up = db.prepare('UPDATE questions SET text = ?, option_a = ?, option_b = ?, option_c = ?, option_d = ?, correct_index = ? WHERE id = ?');
    for(const t of targets) up.run(clean.text, clean.options[0], clean.options[1], clean.options[2], clean.options[3], clean.correctIndex, t.id);
  })();
  markAdminManaged(row.exam_id);
  audit(req, 'question.edit', `#${id}${targets.length > 1 ? ` (+${targets.length - 1} copies)` : ''}`);
  res.json({ updated: targets.length });
});

router.delete('/questions/:id', (req, res) => {
  const id = toId(req.params.id);
  const row = id && db.prepare('SELECT * FROM questions WHERE id = ? AND active = 1').get(id);
  if(!row) return fail(res, 404, 'Question not found.');
  const everywhere = req.query.everywhere === '1';
  const targets = everywhere
    ? db.prepare('SELECT id FROM questions WHERE exam_id = ? AND active = 1 AND lower(trim(text)) = ?').all(row.exam_id, row.text.trim().toLowerCase())
    : [row];
  // "Deleted" questions are switched off, not erased, so results and in-progress attempts that used them keep working.
  const off = db.prepare('UPDATE questions SET active = 0 WHERE id = ?');
  db.transaction(() => { for(const t of targets) off.run(t.id); })();
  markAdminManaged(row.exam_id);
  audit(req, 'question.delete', `#${id}${targets.length > 1 ? ` (+${targets.length - 1} copies)` : ''}`);
  res.json({ removed: targets.length });
});

router.post('/exams/:id/import', (req, res) => {
  const id = toId(req.params.id);
  const exam = id && db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
  if(!exam) return fail(res, 404, 'Certificate not found.');
  const b = req.body || {};
  if(typeof b.csv !== 'string' || !b.csv.trim()) return fail(res, 400, 'Paste or upload some CSV first.');

  let rows;
  try{ rows = parseCsv(b.csv); }catch(e){ return fail(res, 400, e.message); }
  const { items, headerError } = toQuestionRows(rows);
  if(headerError) return fail(res, 400, headerError);
  if(!items.length) return fail(res, 400, 'No questions were found in the file.');
  if(items.length > 500) return fail(res, 400, 'Import at most 500 questions at a time.');

  let target = b.target;
  if(typeof target === 'string' && /^[1-5]$/.test(target)) target = Number(target);
  if(target !== 'spread' && !(Number.isInteger(target) && target >= 1 && target <= SET_COUNT)){
    return fail(res, 400, `Choose where to put them: "spread" evenly, or a set from 1 to ${SET_COUNT}.`);
  }

  const counts = setCountsFor(id);
  const before = counts.slice();
  const seen = Array.from({ length: SET_COUNT + 1 }, () => new Set());
  for(const r of db.prepare('SELECT set_number, lower(trim(text)) AS k FROM questions WHERE exam_id = ? AND active = 1').all(id)){
    if(seen[r.set_number]) seen[r.set_number].add(r.k);
  }

  const rowErrors = [];
  const planned = [];
  for(const it of items){
    if(it.error){ rowErrors.push({ row: it.line, message: it.error }); continue; }
    const { error, clean } = validateQuestion(it);
    if(error){ rowErrors.push({ row: it.line, message: error }); continue; }
    const key = clean.text.toLowerCase();
    let setNumber;
    if(target === 'spread'){
      const order = counts.map((c, i) => ({ c, set: i + 1 })).sort((x, y) => x.c - y.c || x.set - y.set);
      const free = order.find(o => !seen[o.set].has(key));
      if(!free){ rowErrors.push({ row: it.line, message: 'This question is already in every set.' }); continue; }
      setNumber = free.set;
    } else {
      setNumber = target;
      if(seen[setNumber].has(key)){ rowErrors.push({ row: it.line, message: `Set ${setNumber} already contains this exact question (or it appears twice in the file).` }); continue; }
    }
    planned.push({ clean, setNumber });
    counts[setNumber - 1]++;
    seen[setNumber].add(key);
  }
  if(rowErrors.length){
    return fail(res, 400, `${rowErrors.length} row(s) have problems, so nothing was imported. Fix them and try again.`, { rowErrors: rowErrors.slice(0, 50), totalErrors: rowErrors.length });
  }
  db.transaction(() => { for(const p of planned) insertQuestion(id, p.setNumber, p.clean); })();
  markAdminManaged(id);
  audit(req, 'question.import', `${exam.slug}: ${planned.length} questions`);
  res.json({ added: planned.length, perSet: counts.map((c, i) => c - before[i]) });
});

// ---------------------------------------------------------------- users

// How (if at all) a user has admin access. Two independent sources:
//   'panel'        -> the database flag (set here or by `npm run make-admin`); can be changed here
//   'ADMIN_EMAILS' -> the host setting; can only be changed in the host's dashboard
function adminVia(u){
  const via = [];
  if(u.is_admin) via.push('panel');
  if(adminEmailsActive() && adminEmailList().includes(String(u.email).toLowerCase())) via.push('ADMIN_EMAILS');
  return via;
}
function describeUser(u){
  const paid = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount_paise), 0) AS total FROM enrollments WHERE user_id = ? AND status = 'paid' AND amount_paise > 0").get(u.id);
  const att = db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE user_id = ? AND finished_at IS NOT NULL').get(u.id);
  return {
    id: u.id, name: u.name, email: u.email, mobile: u.mobile, username: u.username, createdAt: u.created_at,
    isAdmin: isAdminUser(u), adminVia: adminVia(u),
    paidEnrollments: paid.n, paidTotalInr: paid.total / 100, attempts: att.n,
    lastSeenAt: u.last_seen_at || null,
    activeNow: !!u.last_seen_at && Date.parse(u.last_seen_at.replace(' ', 'T') + 'Z') >= Date.now() - ACTIVE_WINDOW_MINUTES * 60000
  };
}
function loadUser(req, res){
  const id = toId(req.params.id);
  const u = id && db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if(!u){ fail(res, 404, 'User not found.'); return null; }
  return u;
}
function isSelf(req, u){ return u.id === req.adminUser.id; }

// Checks the editable details. `current` is the existing user (for edits) or null (for new users).
function validateUserFields(body, current){
  const b = body || {};
  const fields = {};
  const values = {};
  // Creating: every field is checked. Editing: only fields that were sent AND actually changed, so an
  // older account (e.g. a username with digits from before the current rules) can still be edited.
  const want = (k, norm) => {
    if(current === null) return true;
    if(b[k] === undefined) return false;
    return typeof b[k] !== 'string' || norm(b[k]) !== String(current[k]);
  };
  if(want('name', V.clean.name)){ const e = V.checkName(b.name); if(e) fields.name = e; else values.name = V.clean.name(b.name); }
  if(want('email', V.clean.email)){
    const e = V.checkEmail(b.email);
    if(e) fields.email = e;
    else{
      const email = V.clean.email(b.email);
      const other = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if(other && (!current || other.id !== current.id)) fields.email = 'Another account already uses this email.';
      else values.email = email;
    }
  }
  if(want('mobile', V.clean.mobile)){
    const e = V.checkMobile(b.mobile);
    if(e) fields.mobile = e;
    else{
      const mobile = V.clean.mobile(b.mobile);
      const other = db.prepare('SELECT id FROM users WHERE mobile = ?').get(mobile);
      if(other && (!current || other.id !== current.id)) fields.mobile = 'Another account already uses this mobile number.';
      else values.mobile = mobile;
    }
  }
  if(want('username', V.clean.username)){
    const e = V.checkUsername(b.username);
    if(e) fields.username = e;
    else{
      const uname = V.clean.username(b.username);
      const other = db.prepare('SELECT id FROM users WHERE username = ?').get(uname);
      if(other && (!current || other.id !== current.id)) fields.username = 'That username is already taken.';
      else values.username = uname;
    }
  }
  if(current === null){
    const e = V.checkPassword(b.password, typeof b.username === 'string' ? b.username : ''); if(e) fields.password = e;
  }
  return { fields, values };
}

router.get('/users', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase().slice(0, 100);
  const PAGE = 25;
  let page = parseInt(req.query.page, 10); if(!Number.isInteger(page) || page < 1) page = 1;
  const where = q ? `WHERE lower(name) LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\' OR mobile LIKE ? ESCAPE '\\'` : '';
  const like = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
  const params = q ? [like, like, like, like] : [];
  const total = db.prepare(`SELECT COUNT(*) AS n FROM users ${where}`).get(...params).n;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  if(page > pages) page = pages;
  const rows = db.prepare(`SELECT * FROM users ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, PAGE, (page - 1) * PAGE);
  res.json({ users: rows.map(describeUser), total, page, pages, meId: req.adminUser.id });
});

router.get('/users/:id', (req, res) => {
  const u = loadUser(req, res); if(!u) return;
  const enrollments = db.prepare(`
    SELECT e.name AS exam, en.amount_paise, en.status, en.dev_mode, en.paid_at, en.gateway_payment_id
    FROM enrollments en JOIN exams e ON e.id = en.exam_id WHERE en.user_id = ? ORDER BY en.id DESC
  `).all(u.id).map(r => ({ exam: r.exam, amountInr: r.amount_paise / 100, status: r.status, devMode: !!r.dev_mode, paidAt: r.paid_at, paymentId: r.gateway_payment_id }));
  const attempts = db.prepare(`
    SELECT e.name AS exam, a.set_number, a.score_pct, a.passed, a.finished_at
    FROM attempts a JOIN exams e ON e.id = a.exam_id WHERE a.user_id = ? AND a.finished_at IS NOT NULL ORDER BY a.id DESC LIMIT 20
  `).all(u.id).map(r => ({ exam: r.exam, set: r.set_number, scorePct: r.score_pct, passed: !!r.passed, finishedAt: r.finished_at }));
  res.json({ user: describeUser(u), enrollments, attempts, isSelf: isSelf(req, u) });
});

router.post('/users', (req, res) => {
  const { fields, values } = validateUserFields(req.body, null);
  if(Object.keys(fields).length) return fail(res, 400, 'Please fix the highlighted fields.', { fields });
  const hash = bcrypt.hashSync(String(req.body.password), 10);
  let info;
  try{
    info = db.prepare('INSERT INTO users (name, email, mobile, username, password_hash) VALUES (?, ?, ?, ?, ?)')
      .run(values.name, values.email, values.mobile, values.username, hash);
  }catch(e){
    return fail(res, 409, 'That username or email is already registered.');
  }
  audit(req, 'user.create', '@' + values.username);
  res.status(201).json({ user: describeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)) });
});

router.put('/users/:id', (req, res) => {
  const u = loadUser(req, res); if(!u) return;
  const { fields, values } = validateUserFields(req.body, u);
  if(Object.keys(fields).length) return fail(res, 400, 'Please fix the highlighted fields.', { fields });
  // Nothing changed: not an error, just report the user as-is.
  if(!Object.keys(values).length) return res.json({ user: describeUser(u), adminChanged: false });
  const cols = Object.keys(values);
  try{
    db.prepare(`UPDATE users SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ?`).run(...cols.map(c => values[c]), u.id);
  }catch(e){
    return fail(res, 409, 'That username or email is already registered.');
  }
  const changed = cols.filter(c => String(values[c]) !== String(u[c]));
  if(changed.length) audit(req, 'user.update', `@${u.username}: ${changed.join(', ')}`);
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
  // Changing someone's email can change whether ADMIN_EMAILS applies to them, so report it.
  res.json({ user: describeUser(fresh), adminChanged: isAdminUser(fresh) !== isAdminUser(u) });
});

router.post('/users/:id/password', (req, res) => {
  const u = loadUser(req, res); if(!u) return;
  if(isSelf(req, u)) return fail(res, 400, 'To change your own password, sign out and use "Forgot password?" on the sign-in page.');
  const e = V.checkPassword((req.body || {}).password, u.username);
  if(e) return fail(res, 400, e, { fields: { password: e } });
  db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(bcrypt.hashSync(String(req.body.password), 10), u.id);
  audit(req, 'user.password', '@' + u.username);
  res.json({ ok: true });
});

router.post('/users/:id/signout', (req, res) => {
  const u = loadUser(req, res); if(!u) return;
  if(isSelf(req, u)) return fail(res, 400, 'This would sign you out too. Use "Sign out" on the main site instead.');
  db.prepare('UPDATE users SET token_version = token_version + 1, last_seen_at = NULL WHERE id = ?').run(u.id);
  audit(req, 'user.signout', '@' + u.username);
  res.json({ ok: true });
});

router.post('/users/:id/admin', (req, res) => {
  const u = loadUser(req, res); if(!u) return;
  const want = (req.body || {}).isAdmin;
  if(typeof want !== 'boolean') return fail(res, 400, 'Send { "isAdmin": true } or { "isAdmin": false }.');
  if(isSelf(req, u) && !want) return fail(res, 400, 'You can\'t remove your own admin access (you could lock everyone out). Ask another admin to do it.');
  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(want ? 1 : 0, u.id);
  audit(req, want ? 'admin.grant' : 'admin.revoke', '@' + u.username + ' via admin panel');
  const fresh = describeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id));
  res.json({ user: fresh, stillAdminViaSetting: !want && fresh.isAdmin });
});

router.delete('/users/:id', (req, res) => {
  const u = loadUser(req, res); if(!u) return;
  if(isSelf(req, u)) return fail(res, 400, 'You can\'t delete your own account while signed in as it.');
  const confirm = String((req.body || {}).confirmUsername || '').trim().toLowerCase();
  if(confirm !== u.username) return fail(res, 400, 'Type the username exactly to confirm deletion.');
  const d = describeUser(u);
  // Cascades to their login codes, enrollments, attempts and answers. Their open logins stop
  // working immediately, because the account no longer exists.
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  audit(req, 'user.delete', `@${u.username} (${u.email}), ${d.paidEnrollments} paid enrolments, ${d.attempts} attempts`);
  res.json({ deleted: true, stillInAdminEmails: d.adminVia.includes('ADMIN_EMAILS') });
});

// ---------------------------------------------------------------- site settings

router.get('/settings', (req, res) => {
  res.json({ settings: settings.getForAdmin() });
});

router.put('/settings', (req, res) => {
  const { errors, clean } = settings.validate(req.body || {});
  if(Object.keys(errors).length) return fail(res, 400, 'Please fix the highlighted fields.', { fields: errors });
  if(!Object.keys(clean).length) return fail(res, 400, 'Nothing to save.');
  settings.save(clean);
  audit(req, 'settings.update', Object.keys(clean).join(', '));
  res.json({ settings: settings.getForAdmin() });
});

// ---------------------------------------------------------------- About Us photos

router.get('/photos', (req, res) => {
  res.json({ photos: photos.list(), max: photos.MAX_PHOTOS });
});

router.post('/photos', (req, res) => {
  const b = req.body || {};
  const r = photos.add(b.image, b.caption);
  if(r.errors) return fail(res, 400, Object.values(r.errors)[0], { fields: r.errors });
  audit(req, 'photo.add', 'id ' + r.id);
  res.json({ photos: photos.list(), max: photos.MAX_PHOTOS });
});

router.put('/photos/:id', (req, res) => {
  const id = toId(req.params.id);
  if(!id) return fail(res, 404, 'Photo not found.');
  const r = photos.setCaption(id, (req.body || {}).caption);
  if(r.notFound) return fail(res, 404, 'Photo not found.');
  if(r.errors) return fail(res, 400, r.errors.caption, { fields: r.errors });
  audit(req, 'photo.caption', 'id ' + id);
  res.json({ photos: photos.list(), max: photos.MAX_PHOTOS });
});

router.post('/photos/:id/move', (req, res) => {
  const id = toId(req.params.id);
  const dir = Number((req.body || {}).dir);
  if(!id) return fail(res, 404, 'Photo not found.');
  if(dir !== -1 && dir !== 1) return fail(res, 400, 'dir must be -1 or 1.');
  const r = photos.move(id, dir);
  if(r.notFound) return fail(res, 404, 'Photo not found.');
  res.json({ photos: photos.list(), max: photos.MAX_PHOTOS });
});

router.delete('/photos/:id', (req, res) => {
  const id = toId(req.params.id);
  const r = id ? photos.remove(id) : { notFound: true };
  if(r.notFound) return fail(res, 404, 'Photo not found.');
  audit(req, 'photo.delete', 'id ' + id);
  res.json({ photos: photos.list(), max: photos.MAX_PHOTOS });
});

// ---------------------------------------------------------------- ratings & reviews

router.get('/reviews', (req, res) => {
  res.json(reviews.listForAdmin(String(req.query.status || '')));
});

router.post('/reviews/:id/status', (req, res) => {
  const id = toId(req.params.id);
  const r = id && reviews.getById(id);
  if(!r) return fail(res, 404, 'Review not found.');
  const status = req.body && req.body.status;
  if(!reviews.STATUSES.includes(status)) return fail(res, 400, 'Status must be pending, approved or hidden.');
  reviews.setStatus(id, status);
  audit(req, 'review.' + status, `#${id} by @${r.username} (${r.rating}★)`);
  res.json(reviews.listForAdmin(String(req.query.status || '')));
});

router.delete('/reviews/:id', (req, res) => {
  const id = toId(req.params.id);
  const r = id && reviews.getById(id);
  if(!r) return fail(res, 404, 'Review not found.');
  reviews.remove(id);
  audit(req, 'review.delete', `#${id} by @${r.username} (${r.rating}★)`);
  res.json(reviews.listForAdmin(String(req.query.status || '')));
});

// ---------------------------------------------------------------- overview

router.get('/overview', (req, res) => {
  const one = (sql) => db.prepare(sql).get();
  const paid = one("SELECT COUNT(*) AS n, COALESCE(SUM(amount_paise), 0) AS total FROM enrollments WHERE status = 'paid' AND amount_paise > 0");
  res.json({
    counts: {
      users: one('SELECT COUNT(*) AS n FROM users').n,
      activeUsers: countActiveUsers(),
      examsLive: one('SELECT COUNT(*) AS n FROM exams WHERE active = 1').n,
      examsHidden: one('SELECT COUNT(*) AS n FROM exams WHERE active = 0').n,
      questions: one('SELECT COUNT(*) AS n FROM questions WHERE active = 1').n,
      attemptsCompleted: one('SELECT COUNT(*) AS n FROM attempts WHERE finished_at IS NOT NULL').n,
      paidEnrollments: paid.n,
      revenueInr: paid.total / 100,
      reviewsPending: one("SELECT COUNT(*) AS n FROM reviews WHERE status = 'pending'").n
    },
    activeWindowMinutes: ACTIVE_WINDOW_MINUTES,
    recentActivity: db.prepare('SELECT username, action, detail, created_at FROM admin_audit ORDER BY id DESC LIMIT 20').all()
  });
});

module.exports = router;

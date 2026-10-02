const express = require('express');
const db = require('../db');
const { requireAuth, optionalAuth } = require('../auth');

const router = express.Router();
const SET_COUNT = 5;

function requiresEnrollment(exam){
  return exam.price_inr_paise > 0;
}

function hasPaidEnrollment(userId, examId){
  return !!db.prepare(`
    SELECT 1 FROM enrollments WHERE user_id = ? AND exam_id = ? AND status = 'paid'
  `).get(userId, examId);
}

// ---- GET /api/exams  (public catalogue; includes "enrolled" per exam if logged in) ----
router.get('/', optionalAuth, (req, res) => {
  const exams = db.prepare(`
    SELECT e.id, e.slug, e.name, e.description, e.duration_minutes, e.pass_pct, e.color, e.short_label,
           e.price_inr_paise,
           (SELECT COALESCE(MAX(c), 0) FROM (
              SELECT COUNT(*) AS c FROM questions WHERE exam_id = e.id AND active = 1 GROUP BY set_number
           )) AS question_count,
           (SELECT COUNT(DISTINCT set_number) FROM questions WHERE exam_id = e.id AND active = 1) AS set_count
    FROM exams e
    WHERE e.active = 1
    ORDER BY e.id
  `).all();

  let enrolledSlugs = new Set();
  if(req.userId){
    const rows = db.prepare(`
      SELECT e.slug FROM enrollments en JOIN exams e ON e.id = en.exam_id
      WHERE en.user_id = ? AND en.status = 'paid'
    `).all(req.userId);
    enrolledSlugs = new Set(rows.map(r => r.slug));
  }

  res.json({
    exams: exams.map(e => ({
      ...e,
      enrolled: enrolledSlugs.has(e.slug)
    }))
  });
});

// ---- GET /api/exams/:slug/sets  (auth; requires paid enrollment for priced exams) ----
// Lists the SET_COUNT practice sets available for this exam, each with its
// question count and the user's own best score on that set so far (if any).
router.get('/:slug/sets', requireAuth, (req, res) => {
  const exam = db.prepare('SELECT * FROM exams WHERE slug = ? AND active = 1').get(req.params.slug);
  if(!exam) return res.status(404).json({ error: 'Exam not found.' });

  if(requiresEnrollment(exam) && !hasPaidEnrollment(req.userId, exam.id)){
    return res.status(402).json({ error: 'Please enroll and complete payment before accessing this exam.' });
  }

  const counts = db.prepare(`
    SELECT set_number, COUNT(*) AS question_count
    FROM questions WHERE exam_id = ? AND active = 1 GROUP BY set_number ORDER BY set_number
  `).all(exam.id);

  const bestScores = db.prepare(`
    SELECT set_number, MAX(score_pct) AS best_score, COUNT(*) AS attempt_count
    FROM attempts WHERE user_id = ? AND exam_id = ? AND finished_at IS NOT NULL
    GROUP BY set_number
  `).all(req.userId, exam.id);
  const bestBySet = Object.fromEntries(bestScores.map(b => [b.set_number, b]));

  const passedSets = new Set(db.prepare(`
    SELECT DISTINCT set_number FROM attempts
    WHERE user_id = ? AND exam_id = ? AND finished_at IS NOT NULL AND passed = 1
  `).all(req.userId, exam.id).map(r => r.set_number));

  const sets = [];
  for(let n = 1; n <= SET_COUNT; n++){
    const row = counts.find(c => c.set_number === n);
    const best = bestBySet[n];
    sets.push({
      setNumber: n,
      questionCount: row ? row.question_count : 0,
      bestScorePct: best ? best.best_score : null,
      attemptCount: best ? best.attempt_count : 0,
      locked: n > 1 && !passedSets.has(n - 1)
    });
  }

  res.json({
    exam: {
      slug: exam.slug, name: exam.name, durationMinutes: exam.duration_minutes,
      passPct: exam.pass_pct, color: exam.color, shortLabel: exam.short_label
    },
    sets
  });
});

// ---- POST /api/exams/:slug/start  (auth; requires a paid enrollment for priced exams) ----
router.post('/:slug/start', requireAuth, (req, res) => {
  const exam = db.prepare('SELECT * FROM exams WHERE slug = ? AND active = 1').get(req.params.slug);
  if(!exam) return res.status(404).json({ error: 'Exam not found.' });

  const setNumber = Number(req.body && req.body.setNumber);
  if(!Number.isInteger(setNumber) || setNumber < 1 || setNumber > SET_COUNT){
    return res.status(400).json({ error: `Choose a valid practice set (1-${SET_COUNT}).` });
  }

  if(requiresEnrollment(exam) && !hasPaidEnrollment(req.userId, exam.id)){
    return res.status(402).json({ error: 'Please enroll and complete payment before starting this exam.' });
  }

  if(setNumber > 1){
    const passedPrevious = db.prepare(`
      SELECT 1 FROM attempts
      WHERE user_id = ? AND exam_id = ? AND set_number = ? AND finished_at IS NOT NULL AND passed = 1
    `).get(req.userId, exam.id, setNumber - 1);
    if(!passedPrevious){
      return res.status(423).json({ error: `Pass Set ${setNumber - 1} first to unlock Set ${setNumber}.` });
    }
  }

  const questions = db.prepare(`
    SELECT id, seq, text, option_a, option_b, option_c, option_d
    FROM questions WHERE exam_id = ? AND set_number = ? AND active = 1 ORDER BY seq
  `).all(exam.id, setNumber);

  if(!questions.length){
    return res.status(404).json({ error: 'That practice set has no questions yet.' });
  }

  // Record the attempt AND exactly which questions were served, together. Grading later uses
  // this list, so an admin adding/removing questions mid-exam can't change what this person is
  // graded on.
  let attemptId;
  db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO attempts (user_id, exam_id, set_number, total_count) VALUES (?, ?, ?, ?)
    `).run(req.userId, exam.id, setNumber, questions.length);
    attemptId = info.lastInsertRowid;
    const link = db.prepare('INSERT INTO attempt_questions (attempt_id, question_id) VALUES (?, ?)');
    for(const q of questions) link.run(attemptId, q.id);
  })();
  const info = { lastInsertRowid: attemptId };

  res.json({
    attemptId: info.lastInsertRowid,
    exam: {
      slug: exam.slug, name: exam.name, durationMinutes: exam.duration_minutes,
      passPct: exam.pass_pct, color: exam.color, shortLabel: exam.short_label
    },
    setNumber,
    // correct_index is intentionally withheld from the client here.
    questions: questions.map(q => ({
      id: q.id, seq: q.seq, text: q.text,
      options: [q.option_a, q.option_b, q.option_c, q.option_d]
    }))
  });
});

// ---- POST /api/exams/attempts/:id/submit  (auth, server-side grading) ----
router.post('/attempts/:id/submit', requireAuth, (req, res) => {
  const attemptId = Number(req.params.id);
  const attempt = db.prepare('SELECT * FROM attempts WHERE id = ? AND user_id = ?').get(attemptId, req.userId);
  if(!attempt) return res.status(404).json({ error: 'Attempt not found.' });
  if(attempt.finished_at) return res.status(409).json({ error: 'This attempt was already submitted.' });

  const answers = (req.body && req.body.answers) || {}; // { questionId: selectedIndex }
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(attempt.exam_id);
  // Scoped to the SAME set this attempt was started with — with multiple
  // sets per exam, grading against every question in the exam (not just
  // this attempt's 30) would silently corrupt the score.
  let questions = db.prepare(`
    SELECT q.* FROM attempt_questions aq JOIN questions q ON q.id = aq.question_id
    WHERE aq.attempt_id = ? ORDER BY q.seq
  `).all(attemptId);
  if(!questions.length){
    // Attempt started before this tracking existed: fall back to the set's current questions.
    questions = db.prepare(`
      SELECT * FROM questions WHERE exam_id = ? AND set_number = ? AND active = 1 ORDER BY seq
    `).all(exam.id, attempt.set_number);
  }

  const insertAnswer = db.prepare(`
    INSERT INTO attempt_answers (attempt_id, question_id, selected_index, is_correct)
    VALUES (?, ?, ?, ?)
  `);

  let correctCount = 0;
  const detail = [];

  const run = db.transaction(() => {
    for(const q of questions){
      const raw = answers[String(q.id)];
      const selected = (raw === undefined || raw === null) ? null : Number(raw);
      const isCorrect = selected === q.correct_index ? 1 : 0;
      if(isCorrect) correctCount++;
      insertAnswer.run(attemptId, q.id, selected, isCorrect);
      detail.push({
        questionId: q.id, seq: q.seq, text: q.text,
        options: [q.option_a, q.option_b, q.option_c, q.option_d],
        selectedIndex: selected, correctIndex: q.correct_index, isCorrect: !!isCorrect
      });
    }
    const total = questions.length;
    const scorePct = total ? Math.round((correctCount / total) * 100) : 0;
    const passed = scorePct >= exam.pass_pct ? 1 : 0;
    db.prepare(`
      UPDATE attempts SET finished_at = datetime('now'), correct_count = ?, total_count = ?, score_pct = ?, passed = ?
      WHERE id = ?
    `).run(correctCount, total, scorePct, passed, attemptId);
  });
  run();

  const total = questions.length;
  const scorePct = total ? Math.round((correctCount / total) * 100) : 0;
  res.json({
    attemptId,
    examName: exam.name,
    setNumber: attempt.set_number,
    correctCount, total, scorePct,
    passed: scorePct >= exam.pass_pct,
    passPct: exam.pass_pct,
    detail
  });
});

// ---- GET /api/exams/attempts/mine  (auth) — full history across all exams/sets ----
router.get('/attempts/mine', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.set_number, a.started_at, a.finished_at,
           a.correct_count, a.total_count, a.score_pct, a.passed,
           e.slug, e.name, e.color, e.short_label, e.pass_pct
    FROM attempts a JOIN exams e ON e.id = a.exam_id
    WHERE a.user_id = ? AND a.finished_at IS NOT NULL
    ORDER BY a.finished_at DESC
  `).all(req.userId);

  res.json({
    attempts: rows.map(r => ({
      attemptId: r.id,
      examSlug: r.slug,
      examName: r.name,
      color: r.color,
      shortLabel: r.short_label,
      setNumber: r.set_number,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      correctCount: r.correct_count,
      total: r.total_count,
      scorePct: r.score_pct,
      passed: !!r.passed,
      passPct: r.pass_pct
    }))
  });
});

// ---- GET /api/exams/attempts/:id  (auth, re-fetch a past result) ----
router.get('/attempts/:id', requireAuth, (req, res) => {
  const attemptId = Number(req.params.id);
  const attempt = db.prepare('SELECT * FROM attempts WHERE id = ? AND user_id = ?').get(attemptId, req.userId);
  if(!attempt || !attempt.finished_at) return res.status(404).json({ error: 'Result not found.' });

  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(attempt.exam_id);
  const rows = db.prepare(`
    SELECT aa.selected_index, aa.is_correct, q.id AS question_id, q.seq, q.text,
           q.option_a, q.option_b, q.option_c, q.option_d, q.correct_index
    FROM attempt_answers aa JOIN questions q ON q.id = aa.question_id
    WHERE aa.attempt_id = ? ORDER BY q.seq
  `).all(attemptId);

  res.json({
    attemptId,
    examName: exam.name,
    setNumber: attempt.set_number,
    correctCount: attempt.correct_count, total: attempt.total_count, scorePct: attempt.score_pct,
    passed: !!attempt.passed, passPct: exam.pass_pct,
    detail: rows.map(r => ({
      questionId: r.question_id, seq: r.seq, text: r.text,
      options: [r.option_a, r.option_b, r.option_c, r.option_d],
      selectedIndex: r.selected_index, correctIndex: r.correct_index, isCorrect: !!r.is_correct
    }))
  });
});

module.exports = router;

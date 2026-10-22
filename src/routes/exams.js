const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { requireAuth, optionalAuth } = require('../auth');
const Sections = require('../sections');
const Audience = require('../audience');
const Marking = require('../marking');

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
           e.price_inr_paise, e.sections, e.audience, e.marking,
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

  // Students and IT Professionals each see their own certificates (plus any they've already bought).
  const viewer = Audience.viewerAudience(req.userId);
  res.json({
    audience: viewer,
    exams: exams.filter(e => !viewer || e.audience === viewer || enrolledSlugs.has(e.slug)).map(e => ({
      ...e,
      sections: Sections.parse(e.sections),
      marking: Marking.parse(e.marking),
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
  if(!Audience.allowed(exam, req.userId)) return res.status(403).json({ error: Audience.deniedMessage(exam), audience: exam.audience });

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
      locked: !exam.sets_unlocked && n > 1 && !passedSets.has(n - 1)
    });
  }

  res.json({
    exam: {
      slug: exam.slug, name: exam.name, durationMinutes: exam.duration_minutes,
      passPct: exam.pass_pct, color: exam.color, shortLabel: exam.short_label,
      sections: Sections.parse(exam.sections), marking: Marking.parse(exam.marking)
    },
    sets
  });
});

// Each start saves the attempt and its question list, so one account can't start hundreds of
// attempts and fill up the database. Counted per account, not per IP.
const startLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => 'user:' + req.userId,
  message: { error: 'You have started a lot of practice sets in the last hour. Please wait a little and try again.' }
});

// ---- POST /api/exams/:slug/start  (auth; requires a paid enrollment for priced exams) ----
router.post('/:slug/start', requireAuth, startLimiter, (req, res) => {
  const exam = db.prepare('SELECT * FROM exams WHERE slug = ? AND active = 1').get(req.params.slug);
  if(!exam) return res.status(404).json({ error: 'Exam not found.' });
  if(!Audience.allowed(exam, req.userId)) return res.status(403).json({ error: Audience.deniedMessage(exam), audience: exam.audience });

  const setNumber = Number(req.body && req.body.setNumber);
  if(!Number.isInteger(setNumber) || setNumber < 1 || setNumber > SET_COUNT){
    return res.status(400).json({ error: `Choose a valid practice set (1-${SET_COUNT}).` });
  }

  if(requiresEnrollment(exam) && !hasPaidEnrollment(req.userId, exam.id)){
    return res.status(402).json({ error: 'Please enroll and complete payment before starting this exam.' });
  }

  // Unless the admin opened every set for this exam, Set N needs a pass on Set N-1.
  if(setNumber > 1 && !exam.sets_unlocked){
    const passedPrevious = db.prepare(`
      SELECT 1 FROM attempts
      WHERE user_id = ? AND exam_id = ? AND set_number = ? AND finished_at IS NOT NULL AND passed = 1
    `).get(req.userId, exam.id, setNumber - 1);
    if(!passedPrevious){
      return res.status(423).json({ error: `Pass Set ${setNumber - 1} first to unlock Set ${setNumber}.` });
    }
  }

  const sections = Sections.parse(exam.sections);
  const { questions, groups } = Sections.arrange(sections, db.prepare(`
    SELECT id, seq, text, option_a, option_b, option_c, option_d, section, image_mime, image_data
    FROM questions WHERE exam_id = ? AND set_number = ? AND active = 1 ORDER BY seq
  `).all(exam.id, setNumber));

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
      passPct: exam.pass_pct, color: exam.color, shortLabel: exam.short_label,
      marking: Marking.parse(exam.marking)
    },
    setNumber,
    // Sectioned exams: the sections in order, each with its own time limit. Questions come grouped
    // in this order. null = one timer (durationMinutes) for the whole set.
    sections: groups,
    // correct_index is intentionally withheld from the client here.
    questions: questions.map(q => ({
      id: q.id, seq: q.seq, text: q.text,
      options: [q.option_a, q.option_b, q.option_c, q.option_d],
      section: groups ? q.section : undefined,
      image: Sections.imageUrl(q)
    }))
  });
});

// The score part of a result. marking/marks/maxMarks are null for exams scored by percentage only.
function resultScore(sc, marking){
  return {
    correctCount: sc.correctCount, wrongCount: sc.wrongCount, unansweredCount: sc.unansweredCount,
    total: sc.total, scorePct: sc.scorePct,
    marking: marking || null, marks: sc.marks, maxMarks: sc.maxMarks
  };
}

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
  const sections = Sections.parse(exam.sections);
  questions = Sections.arrange(sections, questions).questions;

  const insertAnswer = db.prepare(`
    INSERT INTO attempt_answers (attempt_id, question_id, selected_index, is_correct)
    VALUES (?, ?, ?, ?)
  `);

  // Graded with the exam's marking scheme as it is now, which is saved with the attempt.
  const marking = Marking.parse(exam.marking);
  const detail = [];
  let sc;

  const run = db.transaction(() => {
    for(const q of questions){
      const raw = answers[String(q.id)];
      // Only option 0-3 counts as an answer; anything else is "not answered" (so it isn't marked wrong).
      const n = (raw === undefined || raw === null || raw === '') ? NaN : Number(raw);
      const selected = Number.isInteger(n) && n >= 0 && n <= 3 ? n : null;
      const isCorrect = selected !== null && selected === q.correct_index ? 1 : 0;
      insertAnswer.run(attemptId, q.id, selected, isCorrect);
      detail.push({
        questionId: q.id, seq: q.seq, text: q.text,
        options: [q.option_a, q.option_b, q.option_c, q.option_d],
        selectedIndex: selected, correctIndex: q.correct_index, isCorrect: !!isCorrect,
        section: sections ? q.section : undefined, image: Sections.imageUrl(q),
        explanation: q.explanation || null
      });
    }
    sc = Marking.score(marking, detail);
    const passed = sc.scorePct >= exam.pass_pct ? 1 : 0;
    db.prepare(`
      UPDATE attempts SET finished_at = datetime('now'), correct_count = ?, total_count = ?, score_pct = ?, passed = ?,
                          marking = ?, marks = ?, max_marks = ?
      WHERE id = ?
    `).run(sc.correctCount, sc.total, sc.scorePct, passed, marking ? JSON.stringify(marking) : null, sc.marks, sc.maxMarks, attemptId);
  });
  run();

  res.json({
    attemptId,
    examName: exam.name,
    setNumber: attempt.set_number,
    ...resultScore(sc, marking),
    passed: sc.scorePct >= exam.pass_pct,
    passPct: exam.pass_pct,
    sections: Sections.breakdown(sections, detail, marking),
    detail
  });
});

// ---- GET /api/exams/attempts/mine  (auth) — full history across all exams/sets ----
router.get('/attempts/mine', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.set_number, a.started_at, a.finished_at,
           a.correct_count, a.total_count, a.score_pct, a.passed, a.marks, a.max_marks,
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
      marks: r.marks, maxMarks: r.max_marks,   // null unless the exam uses a marking scheme
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
  const sections = Sections.parse(exam.sections);
  const rows = Sections.arrange(sections, db.prepare(`
    SELECT aa.selected_index, aa.is_correct, q.id AS question_id, q.seq, q.text,
           q.option_a, q.option_b, q.option_c, q.option_d, q.correct_index, q.section, q.image_mime, q.image_data, q.explanation
    FROM attempt_answers aa JOIN questions q ON q.id = aa.question_id
    WHERE aa.attempt_id = ? ORDER BY q.seq
  `).all(attemptId)).questions;
  const detail = rows.map(r => ({
    questionId: r.question_id, seq: r.seq, text: r.text,
    options: [r.option_a, r.option_b, r.option_c, r.option_d],
    selectedIndex: r.selected_index, correctIndex: r.correct_index, isCorrect: !!r.is_correct,
    section: sections ? r.section : undefined, image: Sections.imageUrl(r),
    explanation: r.explanation || null
  }));

  // Shown with the scheme it was graded with (older attempts have none: percentage only).
  const marking = Marking.parse(attempt.marking);
  const sc = Marking.score(marking, detail);
  res.json({
    attemptId,
    examName: exam.name,
    setNumber: attempt.set_number,
    ...resultScore(sc, marking),
    // The score and pass/fail as recorded when it was submitted.
    correctCount: attempt.correct_count, total: attempt.total_count, scorePct: attempt.score_pct,
    marks: marking ? attempt.marks : null, maxMarks: marking ? attempt.max_marks : null,
    passed: !!attempt.passed, passPct: exam.pass_pct,
    sections: Sections.breakdown(sections, detail, marking),
    detail
  });
});

module.exports = router;

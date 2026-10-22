// How an attempt is scored.
// No scheme (NULL): the score is the percentage of questions answered correctly (the IT exams).
// A scheme gives marks for each correct, wrong and unanswered question, e.g. VITEEE: +4 / -1 / 0.
// The score percentage is then marks out of the maximum (every answer correct), never below 0.

const VITEEE = { correct: 4, wrong: -1, unanswered: 0 };

// The stored JSON as a scheme, or null for "no scheme" (also for anything malformed).
function parse(text){
  if(!text) return null;
  let m;
  try{ m = typeof text === 'string' ? JSON.parse(text) : text; }catch(e){ return null; }
  if(!m || typeof m !== 'object') return null;
  const ok = (n) => Number.isInteger(n) && Math.abs(n) <= 100;
  if(!ok(m.correct) || !ok(m.wrong) || !ok(m.unanswered) || m.correct <= 0) return null;
  return { correct: m.correct, wrong: m.wrong, unanswered: m.unanswered };
}

const isAnswered = (d) => d.selectedIndex !== null && d.selectedIndex !== undefined;

// detail: [{ isCorrect, selectedIndex }]. Returns the counts, marks (null without a scheme) and score %.
function score(marking, detail){
  const total = detail.length;
  const correctCount = detail.filter(d => d.isCorrect).length;
  const unansweredCount = detail.filter(d => !isAnswered(d)).length;
  const wrongCount = total - correctCount - unansweredCount;
  if(!marking){
    return { total, correctCount, wrongCount, unansweredCount, marks: null, maxMarks: null,
             scorePct: total ? Math.round(correctCount / total * 100) : 0 };
  }
  const marks = correctCount * marking.correct + wrongCount * marking.wrong + unansweredCount * marking.unanswered;
  const maxMarks = total * marking.correct;
  const scorePct = maxMarks ? Math.max(0, Math.min(100, Math.round(marks / maxMarks * 100))) : 0;
  return { total, correctCount, wrongCount, unansweredCount, marks, maxMarks, scorePct };
}

module.exports = { VITEEE, parse, score };

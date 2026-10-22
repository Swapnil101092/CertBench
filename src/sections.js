// Timed sections (e.g. VITEEE: Mathematics, Physics, ...) and question images.
// An exam's `sections` column is NULL (one timer for the whole set) or a JSON list of
// { name, questions, minutes }, in the order students take them. `questions` is the target count per
// set (shown to admins); `minutes` is that section's own time limit.

const MAX_SECTIONS = 8;
const CONTROL_RE = /[\u0000-\u001f]/;

function parse(raw){
  if(!raw) return null;
  try{
    const list = JSON.parse(raw);
    return Array.isArray(list) && list.length ? list : null;
  }catch(e){ return null; }
}

// Returns { value } (a clean list, or null for "no sections") or { error }.
function validate(input){
  if(input === undefined || input === null || (Array.isArray(input) && !input.length)) return { value: null };
  if(!Array.isArray(input)) return { error: 'Sections must be a list.' };
  if(input.length > MAX_SECTIONS) return { error: 'Use at most ' + MAX_SECTIONS + ' sections.' };
  const out = [];
  const names = new Set();
  for(const s of input){
    const name = s && typeof s.name === 'string' ? s.name.trim() : '';
    if(name.length < 1 || name.length > 40 || CONTROL_RE.test(name)) return { error: 'Each section needs a name of 1-40 characters.' };
    if(names.has(name.toLowerCase())) return { error: 'Section names must all be different ("' + name + '" is used twice).' };
    names.add(name.toLowerCase());
    const questions = s.questions, minutes = s.minutes;
    if(!Number.isInteger(questions) || questions < 1 || questions > 200) return { error: name + ': questions per set must be a whole number, 1-200.' };
    if(!Number.isInteger(minutes) || minutes < 1 || minutes > 300) return { error: name + ': time limit must be a whole number of minutes, 1-300.' };
    out.push({ name, questions, minutes });
  }
  const total = out.reduce((t, s) => t + s.minutes, 0);
  if(total > 300) return { error: 'The sections add up to ' + total + ' minutes; keep the total at 300 or less.' };
  return { value: out };
}

function totalMinutes(sections){
  return sections.reduce((t, s) => t + s.minutes, 0);
}

// Where a question goes: the index of its section, or the last section if its section is missing or
// unknown (e.g. a question added before the exam had sections), so no question is ever dropped.
function indexFor(sections, name){
  const i = sections.findIndex(s => s.name === name);
  return i === -1 ? sections.length - 1 : i;
}

// Orders a set's questions section by section and groups them for the exam screen.
// Returns { questions (each with .section set to its group's name), groups: [{ name, minutes, questionCount }] }.
// Sections without any questions in this set are left out.
function arrange(sections, questions){
  if(!sections) return { questions, groups: null };
  const buckets = sections.map(() => []);
  for(const q of questions) buckets[indexFor(sections, q.section)].push(q);
  const ordered = [], groups = [];
  buckets.forEach((b, i) => {
    if(!b.length) return;
    b.forEach(q => ordered.push(Object.assign({}, q, { section: sections[i].name })));
    groups.push({ name: sections[i].name, minutes: sections[i].minutes, questionCount: b.length });
  });
  return { questions: ordered, groups };
}

// Correct / total per section, for results. With a marking scheme, also the section's marks.
function breakdown(sections, detail, marking){
  if(!sections) return null;
  const Marking = require('./marking');
  const rows = sections.map(() => []);
  for(const d of detail) rows[indexFor(sections, d.section)].push(d);
  return sections.map((s, i) => {
    if(!rows[i].length) return null;
    const sc = Marking.score(marking || null, rows[i]);
    const row = { name: s.name, correct: sc.correctCount, total: sc.total };
    if(marking) Object.assign(row, { wrong: sc.wrongCount, unanswered: sc.unansweredCount, marks: sc.marks, maxMarks: sc.maxMarks });
    return row;
  }).filter(Boolean);
}

function imageUrl(row){
  return row.image_data && row.image_mime ? 'data:' + row.image_mime + ';base64,' + Buffer.from(row.image_data).toString('base64') : null;
}

module.exports = { parse, validate, totalMinutes, arrange, breakdown, imageUrl, MAX_SECTIONS };

// Built-in answer explanations ("why the correct answer is right"), shown on the results page.
// ./banks/explanations/<slug>.json is { "<question text exactly as in the bank>": "<explanation>" },
// so explanations can be added exam by exam without touching the question banks.
const fs = require('fs');
const path = require('path');
const db = require('./db');

const DIR = path.join(__dirname, 'banks', 'explanations');

function forSlug(slug){
  const file = path.join(DIR, slug + '.json');
  if(!fs.existsSync(file)) return new Map();
  return new Map(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8'))));
}

// Fills in built-in explanations for questions that have none yet (explanation IS NULL), matched by
// exam slug and question text. Runs on every start, so a database seeded before an exam's explanations
// existed gets them too. An explanation written or cleared in the admin panel is never replaced.
function backfill(){
  if(!fs.existsSync(DIR)) return 0;
  const examId = db.prepare('SELECT id FROM exams WHERE slug = ?');
  const fill = db.prepare('UPDATE questions SET explanation = ? WHERE exam_id = ? AND text = ? AND explanation IS NULL');
  let filled = 0;
  db.transaction(() => {
    for(const file of fs.readdirSync(DIR).filter(f => f.endsWith('.json'))){
      const exam = examId.get(path.basename(file, '.json'));
      if(!exam) continue;
      for(const [text, why] of forSlug(path.basename(file, '.json'))) filled += Number(fill.run(why, exam.id, text).changes);
    }
  })();
  return filled;
}

module.exports = { forSlug, backfill };

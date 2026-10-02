// Small CSV reader for bulk-importing questions. Handles quoted fields, commas and line
// breaks inside quotes, doubled quotes (""), Windows/Unix line endings, and a leading BOM
// (what Excel adds when saving as CSV).
function parseCsv(text){
  text = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for(let i = 0; i < text.length; i++){
    const c = text[i];
    if(inQuotes){
      if(c === '"'){
        if(text[i + 1] === '"'){ field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if(c === '"' && field === ''){
      inQuotes = true;
    } else if(c === ','){
      row.push(field); field = '';
    } else if(c === '\n' || c === '\r'){
      if(c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if(inQuotes) throw new Error('A quoted value is never closed (missing closing quote).');
  if(field !== '' || row.length){ row.push(field); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}

const ALIASES = {
  question: ['question', 'text', 'q', 'question text'],
  a: ['option_a', 'option a', 'optiona', 'a', 'option1', 'option 1', 'answer a'],
  b: ['option_b', 'option b', 'optionb', 'b', 'option2', 'option 2', 'answer b'],
  c: ['option_c', 'option c', 'optionc', 'c', 'option3', 'option 3', 'answer c'],
  d: ['option_d', 'option d', 'optiond', 'd', 'option4', 'option 4', 'answer d'],
  correct: ['correct', 'answer', 'correct_answer', 'correct answer', 'key', 'correct option']
};

// Turns raw rows into { line, text, options, correctIndex } (or { line, error }).
// `line` is the row number as seen in a spreadsheet (header = row 1).
function toQuestionRows(rows){
  if(!rows.length) return { items: [], headerError: 'The file is empty.' };
  const first = rows[0].map(x => String(x).trim().toLowerCase());
  const hasHeader = first.some(x => ALIASES.question.includes(x));
  let idx, start;
  if(hasHeader){
    idx = {};
    for(const key of Object.keys(ALIASES)){
      idx[key] = first.findIndex(x => ALIASES[key].includes(x));
    }
    const missing = Object.keys(idx).filter(k => idx[k] === -1).map(k => ({ question:'question', a:'option_a', b:'option_b', c:'option_c', d:'option_d', correct:'correct' }[k]));
    if(missing.length) return { items: [], headerError: 'Missing column(s): ' + missing.join(', ') + '. Use the template columns: question, option_a, option_b, option_c, option_d, correct.' };
    start = 1;
  } else {
    idx = { question: 0, a: 1, b: 2, c: 3, d: 4, correct: 5 };
    start = 0;
  }
  const items = [];
  for(let r = start; r < rows.length; r++){
    const cells = rows[r].map(x => String(x).trim());
    const line = r + 1;
    const get = (k) => cells[idx[k]] !== undefined ? cells[idx[k]] : '';
    const token = get('correct');
    let correctIndex = -1;
    if(/^[A-Da-d]$/.test(token)) correctIndex = token.toUpperCase().charCodeAt(0) - 65;
    else if(/^[1-4]$/.test(token)) correctIndex = Number(token) - 1;
    if(correctIndex === -1){
      items.push({ line, error: 'The "correct" column must be A, B, C or D (or 1-4). Found: "' + token + '".' });
      continue;
    }
    items.push({ line, text: get('question'), options: [get('a'), get('b'), get('c'), get('d')], correctIndex });
  }
  return { items };
}

module.exports = { parseCsv, toQuestionRows };

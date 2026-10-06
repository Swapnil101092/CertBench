// Site visitor counter for the home page.
// Each browser keeps an anonymous random ID; it is counted at most once per day (India time).
// Only a salted hash of that ID is stored, and only for today and yesterday, so nothing
// personal is kept. Daily totals are kept forever so the all-time number can be shown.
const crypto = require('crypto');
const db = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS visit_daily (
  day TEXT PRIMARY KEY,           -- YYYY-MM-DD in India time
  visitors INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS visit_seen (
  day TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  PRIMARY KEY (day, visitor_hash)
);
`);

const SALT = process.env.JWT_SECRET || 'certbench-visits';
const ID_RE = /^[A-Za-z0-9-]{16,64}$/;

// Today's date in India (UTC+5:30), as YYYY-MM-DD.
function todayIST(now = Date.now()){
  return new Date(now + 330 * 60 * 1000).toISOString().slice(0, 10);
}

const insertSeen = db.prepare('INSERT OR IGNORE INTO visit_seen (day, visitor_hash) VALUES (?, ?)');
const bumpDay = db.prepare('INSERT INTO visit_daily (day, visitors) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET visitors = visitors + 1');
const pruneSeen = db.prepare('DELETE FROM visit_seen WHERE day < ?');
const getDay = db.prepare('SELECT visitors FROM visit_daily WHERE day = ?');
const getTotal = db.prepare('SELECT COALESCE(SUM(visitors), 0) AS n FROM visit_daily');

let lastPruned = '';
function validId(id){ return typeof id === 'string' && ID_RE.test(id); }

// Records one visit for this browser today (repeat visits the same day are ignored).
function record(id){
  const day = todayIST();
  const hash = crypto.createHash('sha256').update(SALT + ':' + id).digest('hex');
  if(insertSeen.run(day, hash).changes > 0) bumpDay.run(day);
  if(lastPruned !== day){   // once a day, forget visitor hashes older than yesterday
    pruneSeen.run(todayIST(Date.now() - 2 * 86400000));
    lastPruned = day;
  }
}

function counts(){
  const t = getDay.get(todayIST());
  return { total: Number(getTotal.get().n), today: t ? Number(t.visitors) : 0 };
}

module.exports = { record, counts, validId, todayIST };

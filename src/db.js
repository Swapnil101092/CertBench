const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'certbench.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const raw = new DatabaseSync(DB_PATH);
raw.exec('PRAGMA journal_mode = WAL');
raw.exec('PRAGMA foreign_keys = ON');

raw.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  mobile TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS otps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL DEFAULT 'login', -- 'login' | 'password_reset'
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  pass_pct INTEGER NOT NULL,
  color TEXT NOT NULL DEFAULT '#2dd4bf',
  short_label TEXT NOT NULL DEFAULT 'EX',
  price_inr_paise INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  set_number INTEGER NOT NULL DEFAULT 1,
  seq INTEGER NOT NULL,
  text TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,
  correct_index INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  set_number INTEGER NOT NULL DEFAULT 1,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  correct_count INTEGER,
  total_count INTEGER,
  score_pct REAL,
  passed INTEGER
);

CREATE TABLE IF NOT EXISTS attempt_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_index INTEGER,
  is_correct INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  amount_paise INTEGER NOT NULL,
  gateway_order_id TEXT NOT NULL UNIQUE,
  gateway_payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'created', -- created | paid | failed
  dev_mode INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_questions_exam ON questions(exam_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_otps_user ON otps(user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_user ON enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_exam ON enrollments(exam_id);
`);

// Lightweight migration for databases created before pricing was added —
// SQLite has no "ADD COLUMN IF NOT EXISTS", so we try and swallow the
// "duplicate column" error if it's already there.
try{ raw.exec('ALTER TABLE exams ADD COLUMN price_inr_paise INTEGER NOT NULL DEFAULT 0'); }catch(e){}
try{ raw.exec('ALTER TABLE questions ADD COLUMN set_number INTEGER NOT NULL DEFAULT 1'); }catch(e){}
try{ raw.exec('ALTER TABLE attempts ADD COLUMN set_number INTEGER NOT NULL DEFAULT 1'); }catch(e){}
try{ raw.exec("ALTER TABLE otps ADD COLUMN purpose TEXT NOT NULL DEFAULT 'login'"); }catch(e){}
try{ raw.exec('CREATE INDEX IF NOT EXISTS idx_questions_exam_set ON questions(exam_id, set_number)'); }catch(e){}
// ---- Admin panel support (safe on existing databases: each step is skipped if already applied) ----
try{ raw.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0'); }catch(e){}
// Bumped to sign a user out everywhere (password reset, deleted by an admin, "sign out all devices").
try{ raw.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0'); }catch(e){}
// exams.active: 0 = hidden from students (draft or archived), data is kept.
// exams.source: 'seed' = loaded from the built-in list, 'admin' = created/edited in the admin panel
// (so `npm run seed` will never overwrite it).
try{ raw.exec('ALTER TABLE exams ADD COLUMN active INTEGER NOT NULL DEFAULT 1'); }catch(e){}
try{ raw.exec("ALTER TABLE exams ADD COLUMN source TEXT NOT NULL DEFAULT 'seed'"); }catch(e){}
// questions.active: 0 = removed by an admin. The row is kept so past results and
// in-progress attempts that used it still work.
try{ raw.exec('ALTER TABLE questions ADD COLUMN active INTEGER NOT NULL DEFAULT 1'); }catch(e){}
// users.last_seen_at: when this person last used the site while signed in (UTC). Logins are JWTs with
// no server-side session, so the admin panel's "active now" count is based on this.
try{ raw.exec('ALTER TABLE users ADD COLUMN last_seen_at TEXT'); }catch(e){}
try{ raw.exec('CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen_at)'); }catch(e){}

raw.exec(`
-- Which questions an attempt was actually served, so grading stays correct even if an
-- admin adds/removes questions while the person is mid-exam.
CREATE TABLE IF NOT EXISTS attempt_questions (
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  PRIMARY KEY (attempt_id, question_id)
);
CREATE TABLE IF NOT EXISTS settings (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
try{ raw.exec('CREATE INDEX IF NOT EXISTS idx_questions_active ON questions(exam_id, set_number, active)'); }catch(e){}

// Ratings & reviews of CertBench. One review per user (editing it replaces it).
// status: 'pending' (waiting for an admin) | 'approved' (can show on the home page) | 'hidden'.
raw.exec(`
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status, rating);
`);

// Photos for the "About Us" section of the home page (uploaded in the admin panel).
raw.exec(`
CREATE TABLE IF NOT EXISTS about_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

try{ raw.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)'); }catch(e){
  console.warn('Could not add a unique index on users.email (likely pre-existing duplicate emails in the database) — new registrations are still checked at the application level, but consider cleaning up duplicates.');
}

// Lookups by mobile number (registration rejects a number that is already in use).
try{ raw.exec('CREATE INDEX IF NOT EXISTS idx_users_mobile ON users(mobile)'); }catch(e){}

// Thin wrapper so the rest of the app can keep using the same
// db.prepare(...).run/get/all(...) and db.transaction(fn) style regardless
// of which underlying SQLite driver is in use.
const statementCache = new Map();
function prepare(sql){
  let stmt = statementCache.get(sql);
  if(!stmt){ stmt = raw.prepare(sql); statementCache.set(sql, stmt); }
  return stmt;
}

function transaction(fn){
  return function(...args){
    raw.exec('BEGIN');
    try{
      const result = fn(...args);
      raw.exec('COMMIT');
      return result;
    }catch(err){
      raw.exec('ROLLBACK');
      throw err;
    }
  };
}

module.exports = {
  prepare,
  exec: (sql) => raw.exec(sql),
  transaction
};

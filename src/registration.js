// Sign-ups waiting for their email and mobile codes. The account is only created once the
// codes are confirmed, so an unverified email or mobile number never becomes an account.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS pending_registrations (
  id TEXT PRIMARY KEY,                 -- random, handed to the browser
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  mobile TEXT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email_code_hash TEXT NOT NULL,
  mobile_code_hash TEXT,               -- NULL when SMS is not set up on this server
  attempts INTEGER NOT NULL DEFAULT 0,
  email_sends INTEGER NOT NULL DEFAULT 1,
  mobile_sends INTEGER NOT NULL DEFAULT 1,
  last_email_sent_at INTEGER NOT NULL,
  last_mobile_sent_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL          -- ms since epoch
);
`);

// Accounts remember that their email / mobile were verified. Accounts made by an admin in the
// admin panel count as verified (the admin vouched for them). Older accounts count as having a
// verified email only if they ever confirmed a code sent to it (sign-in or password reset).
function addColumn(sql){ try{ db.exec(sql); return true; }catch(e){ return false; } }
if(addColumn('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1')){
  db.exec(`UPDATE users SET email_verified = 0 WHERE id NOT IN (SELECT DISTINCT user_id FROM otps WHERE consumed = 1)`);
}
addColumn('ALTER TABLE users ADD COLUMN mobile_verified INTEGER NOT NULL DEFAULT 0');

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_GAP_MS = 30 * 1000;
const MAX_SENDS = 5;
const MAX_ATTEMPTS = 5;

function genCode(){ return String(crypto.randomInt(100000, 1000000)); }
function hash(code){ return bcrypt.hashSync(code, 8); }

function prune(){ db.prepare('DELETE FROM pending_registrations WHERE expires_at < ?').run(Date.now() - 60 * 60 * 1000); }

function create({ name, email, mobile, username, passwordHash, withMobile }){
  prune();
  const id = crypto.randomBytes(24).toString('base64url');
  const emailCode = genCode();
  const mobileCode = withMobile ? genCode() : null;
  const now = Date.now();
  db.prepare(`INSERT INTO pending_registrations
    (id, name, email, mobile, username, password_hash, email_code_hash, mobile_code_hash, last_email_sent_at, last_mobile_sent_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, name, email, mobile, username, passwordHash, hash(emailCode), mobileCode ? hash(mobileCode) : null, now, now, now + CODE_TTL_MS);
  return { id, emailCode, mobileCode };
}

function get(id){
  if(typeof id !== 'string' || id.length < 20 || id.length > 64) return null;
  return db.prepare('SELECT * FROM pending_registrations WHERE id = ?').get(id) || null;
}

// A fresh code for one channel. Returns { code } or { error, status }.
function newCode(p, channel){
  const now = Date.now();
  const sends = channel === 'email' ? p.email_sends : p.mobile_sends;
  const last = channel === 'email' ? p.last_email_sent_at : p.last_mobile_sent_at;
  if(channel === 'mobile' && !p.mobile_code_hash) return { error: 'Mobile verification is not needed.', status: 400 };
  if(sends >= MAX_SENDS) return { error: 'Too many codes sent. Please start the sign-up again.', status: 429 };
  if(now - last < RESEND_GAP_MS) return { error: 'Please wait a few seconds before asking for another code.', status: 429, retryInSeconds: Math.ceil((RESEND_GAP_MS - (now - last)) / 1000) };
  const code = genCode();
  if(channel === 'email'){
    db.prepare('UPDATE pending_registrations SET email_code_hash = ?, email_sends = email_sends + 1, last_email_sent_at = ?, expires_at = ? WHERE id = ?').run(hash(code), now, now + CODE_TTL_MS, p.id);
  } else {
    db.prepare('UPDATE pending_registrations SET mobile_code_hash = ?, mobile_sends = mobile_sends + 1, last_mobile_sent_at = ?, expires_at = ? WHERE id = ?').run(hash(code), now, now + CODE_TTL_MS, p.id);
  }
  return { code };
}

// Checks both codes. Returns { ok: true } or { error, status, fields }.
function checkCodes(p, emailCode, mobileCode){
  if(p.expires_at < Date.now()) return { error: 'These codes have expired. Please request new ones.', status: 400 };
  if(p.attempts >= MAX_ATTEMPTS) return { error: 'Too many incorrect attempts. Please start the sign-up again.', status: 429 };
  const fields = {};
  const clean = (c) => String(c == null ? '' : c).replace(/\s+/g, '');
  const e = clean(emailCode), m = clean(mobileCode);
  if(!/^\d{6}$/.test(e)) fields.emailCode = 'Enter the 6-digit code sent to your email.';
  else if(!bcrypt.compareSync(e, p.email_code_hash)) fields.emailCode = 'That email code doesn’t match.';
  if(p.mobile_code_hash){
    if(!/^\d{6}$/.test(m)) fields.mobileCode = 'Enter the 6-digit code sent to your mobile.';
    else if(!bcrypt.compareSync(m, p.mobile_code_hash)) fields.mobileCode = 'That mobile code doesn’t match.';
  }
  if(Object.keys(fields).length){
    db.prepare('UPDATE pending_registrations SET attempts = attempts + 1 WHERE id = ?').run(p.id);
    const first = fields.emailCode || fields.mobileCode;
    return { error: first, status: 400, fields };
  }
  return { ok: true };
}

function remove(id){ db.prepare('DELETE FROM pending_registrations WHERE id = ?').run(id); }

module.exports = { create, get, newCode, checkCodes, remove, CODE_TTL_MS, RESEND_GAP_MS };

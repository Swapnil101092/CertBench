const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
if(!JWT_SECRET){
  throw new Error('JWT_SECRET is not set. Copy .env.example to .env and set a strong random value.');
}

function signSessionToken(user){
  return jwt.sign(
    { sub: user.id, username: user.username, purpose: 'session', tv: user.token_version || 0 },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

function signPendingToken(user){
  // Short-lived token issued right after password check, before OTP is
  // verified. It can only be used against the verify-otp/resend-otp
  // endpoints, never to access protected resources.
  return jwt.sign(
    { sub: user.id, purpose: 'otp-pending' },
    JWT_SECRET,
    { expiresIn: '10m' }
  );
}

function signResetToken(user){
  // Separate purpose from otp-pending so a password-reset code can never
  // be used to complete a normal login, or vice versa.
  return jwt.sign(
    { sub: user.id, purpose: 'password-reset-pending' },
    JWT_SECRET,
    { expiresIn: '10m' }
  );
}

function verifyToken(token){
  try{
    return jwt.verify(token, JWT_SECRET);
  }catch(e){
    return null;
  }
}

// A login is only valid while the account still exists and its session version hasn't changed.
// Logins issued before session versions existed carry no "tv" and count as version 0, so an
// upgrade doesn't sign anyone out.
function sessionUser(payload){
  if(!payload || payload.purpose !== 'session') return null;
  const u = db.prepare('SELECT id, token_version FROM users WHERE id = ?').get(payload.sub);
  if(!u) return null;
  if((payload.tv || 0) !== (u.token_version || 0)) return null;
  touchLastSeen(u.id);
  return u;
}

// Records that a signed-in user is using the site. Written at most once a minute per user, so busy
// pages don't turn every request into a database write.
const ACTIVE_WINDOW_MINUTES = 15;
function touchLastSeen(userId){
  db.prepare("UPDATE users SET last_seen_at = datetime('now') WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < datetime('now', '-60 seconds'))").run(userId);
}
// Signed-in users who made a request in the last ACTIVE_WINDOW_MINUTES.
function countActiveUsers(){
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE last_seen_at >= datetime('now', ?)").get('-' + ACTIVE_WINDOW_MINUTES + ' minutes').n;
}

function requireAuth(req, res, next){
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const u = sessionUser(token ? verifyToken(token) : null);
  if(!u){
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  req.userId = u.id;
  next();
}
function optionalAuth(req, res, next){
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const u = sessionUser(token ? verifyToken(token) : null);
  if(u) req.userId = u.id;          // an ended or deleted login is simply treated as "not signed in"
  next();
}

// ---- Who is an admin ----
// Two ways to be one:
//   1. `npm run make-admin -- <username>` sets a flag in the database (needs a shell on the server).
//   2. The ADMIN_EMAILS environment variable (comma-separated), set in your host's dashboard. This is
//      for hosts where you can't run commands on the server. It is ONLY honoured when a real email
//      service is configured: signing in then needs the code emailed to that address, so nobody else
//      can use it. (Without email, the site shows login codes on screen, so anyone could register
//      that address and sign in as it.)
function adminEmailList(){
  return String(process.env.ADMIN_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
}
function adminEmailsActive(){
  return adminEmailList().length > 0 && require('./email').isConfigured();
}
function isAdminUser(u){
  if(!u) return false;
  if(u.is_admin) return true;
  return adminEmailsActive() && adminEmailList().includes(String(u.email || '').trim().toLowerCase());
}

// Admin-only routes. Checked against the database (and ADMIN_EMAILS) on EVERY request, not stored in
// the login token, so removing someone's access takes effect immediately.
function requireAdmin(req, res, next){
  requireAuth(req, res, () => {
    const u = db.prepare('SELECT id, username, email, is_admin FROM users WHERE id = ?').get(req.userId);
    if(!isAdminUser(u)){
      return res.status(403).json({ error: 'Admin access required.' });
    }
    req.adminUser = { id: u.id, username: u.username };
    next();
  });
}

module.exports = { ACTIVE_WINDOW_MINUTES, countActiveUsers, signSessionToken, signPendingToken, signResetToken, verifyToken, requireAuth, requireAdmin, optionalAuth, isAdminUser, adminEmailList, adminEmailsActive };

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signSessionToken, signPendingToken, signResetToken, verifyToken, requireAuth, isAdminUser } = require('../auth');
const { sendOtpEmail, sendPasswordResetEmail } = require('../email');

const router = express.Router();

// A solid general-purpose email format check (not a hard whitelist of
// providers — restricting registration to only @gmail.com/@yahoo.com would
// lock out perfectly valid users on Outlook, work email domains, etc; this
// instead verifies the address is *shaped* like a real email address).
const { checkName, checkEmail, checkMobile, checkPassword, checkUsername, clean } = require('../validation');

function maskEmail(email){
  const [name, domain] = String(email).split('@');
  if(!domain) return email;
  const visible = name.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(1, name.length - visible.length))}@${domain}`;
}

function genOtp(){
  return String(Math.floor(100000 + Math.random() * 900000));
}

function publicUser(u){
  return { id: u.id, name: u.name, email: u.email, mobile: u.mobile, username: u.username, isAdmin: isAdminUser(u) };
}

// ---- POST /api/auth/register ----
router.post('/register', (req, res) => {
  const { name, email, mobile, username, password } = req.body || {};

  // Check every field (not just the first bad one) so the form can highlight all problems at once.
  const fields = {};
  const nameErr = checkName(name); if(nameErr) fields.name = nameErr;
  const emailErr = checkEmail(email); if(emailErr) fields.email = emailErr;
  const mobileErr = checkMobile(mobile); if(mobileErr) fields.mobile = mobileErr;
  const userErr = checkUsername(username); if(userErr) fields.username = userErr;
  const pwErr = checkPassword(password, typeof username === 'string' ? username : ''); if(pwErr) fields.password = pwErr;
  const order = ['name', 'email', 'mobile', 'username', 'password'];
  const firstBad = order.find(k => fields[k]);
  if(firstBad){
    return res.status(400).json({ error: fields[firstBad], fields });
  }
  const trimmedName = clean.name(name);
  const trimmedEmail = clean.email(email);
  const digits = clean.mobile(mobile);
  const uname = clean.username(username);

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(uname);
  if(existing){
    return res.status(409).json({ error: 'That username is already taken.', fields: { username: 'That username is already taken.' } });
  }
  const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(trimmedEmail);
  if(existingEmail){
    return res.status(409).json({ error: 'An account with that email already exists.', fields: { email: 'An account with that email already exists.' } });
  }
  const existingMobile = db.prepare('SELECT id FROM users WHERE mobile = ?').get(digits);
  if(existingMobile){
    return res.status(409).json({ error: 'An account with that mobile number already exists.', fields: { mobile: 'An account with that mobile number already exists.' } });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  let info;
  try{
    info = db.prepare(`
      INSERT INTO users (name, email, mobile, username, password_hash)
      VALUES (?, ?, ?, ?, ?)
    `).run(trimmedName, trimmedEmail, digits, uname, passwordHash);
  }catch(err){
    return res.status(409).json({ error: 'That username or email is already registered.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ user: publicUser(user) });
});

// ---- POST /api/auth/login  (step 1: password check, issues OTP) ----
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if(typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password){
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const uname = String(username).trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(uname);
  if(!user || !bcrypt.compareSync(password, user.password_hash)){
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }

  const code = genOtp();
  const codeHash = bcrypt.hashSync(code, 8);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO otps (user_id, purpose, code_hash, expires_at) VALUES (?, 'login', ?, ?)
  `).run(user.id, codeHash, expiresAt);

  let emailResult;
  try{
    emailResult = await sendOtpEmail(user.email, code);
  }catch(err){
    console.error('Email send failed:', err.message);
    return res.status(502).json({ error: 'Could not send the verification code. Please try again shortly.' });
  }

  const pendingToken = signPendingToken(user);
  const response = {
    pendingToken,
    emailMasked: maskEmail(user.email),
    expiresInSeconds: 300
  };
  // Only ever echo the live code back to the client when there is no real
  // email provider configured, i.e. local/dev use — never in production
  // once EMAIL_USER / EMAIL_PASS env vars are set.
  if(emailResult.devFallback){
    response.devOtp = code;
  }
  res.json(response);
});

// ---- POST /api/auth/verify-otp  (step 2) ----
router.post('/verify-otp', (req, res) => {
  const { pendingToken, code } = req.body || {};
  const payload = pendingToken ? verifyToken(pendingToken) : null;
  if(!payload || payload.purpose !== 'otp-pending'){
    return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
  }

  const otpRow = db.prepare(`
    SELECT * FROM otps WHERE user_id = ? AND purpose = 'login' AND consumed = 0
    ORDER BY id DESC LIMIT 1
  `).get(payload.sub);

  if(!otpRow){
    return res.status(400).json({ error: 'No active code found. Please request a new one.' });
  }
  if(new Date(otpRow.expires_at).getTime() < Date.now()){
    return res.status(400).json({ error: 'This code has expired. Please request a new one.' });
  }
  if(otpRow.attempts >= 5){
    return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new code.' });
  }
  if(!code || !bcrypt.compareSync(String(code), otpRow.code_hash)){
    db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE id = ?').run(otpRow.id);
    return res.status(400).json({ error: 'That code doesn’t match. Please try again.' });
  }

  db.prepare('UPDATE otps SET consumed = 1 WHERE id = ?').run(otpRow.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
  const token = signSessionToken(user);
  res.json({ token, user: publicUser(user) });
});

// ---- POST /api/auth/forgot-password  (step 1: send a reset code by email) ----
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if(typeof email !== 'string' || !email.trim()) return res.status(400).json({ error: 'Enter your email address.' });

  const trimmedEmail = String(email).trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(trimmedEmail);

  // Always respond the same way whether or not the email exists, so this
  // endpoint can't be used to check which emails are registered.
  const genericResponse = { message: 'If that email is registered, a reset code has been sent.' };

  if(!user){
    return res.json(genericResponse);
  }

  const code = genOtp();
  const codeHash = bcrypt.hashSync(code, 8);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO otps (user_id, purpose, code_hash, expires_at) VALUES (?, 'password_reset', ?, ?)
  `).run(user.id, codeHash, expiresAt);

  const resetToken = signResetToken(user);

  try{
    const result = await sendPasswordResetEmail(user.email, code);
    const response = { ...genericResponse, resetToken, expiresInSeconds: 600 };
    if(result.devFallback) response.devOtp = code;
    return res.json(response);
  }catch(err){
    console.error('Password reset email failed:', err.message);
    // Still return the generic response — don't reveal whether the email
    // exists via a different error path — but log it for the operator.
    return res.json(genericResponse);
  }
});

// ---- POST /api/auth/reset-password  (step 2: verify code + set new password) ----
router.post('/reset-password', (req, res) => {
  const { resetToken, code, newPassword } = req.body || {};
  const payload = resetToken ? verifyToken(resetToken) : null;
  if(!payload || payload.purpose !== 'password-reset-pending'){
    return res.status(401).json({ error: 'Your reset session expired. Please request a new code.' });
  }

  const resetUser = db.prepare('SELECT username FROM users WHERE id = ?').get(payload.sub);
  const pwProblem = checkPassword(newPassword, resetUser ? resetUser.username : '');
  if(pwProblem){
    return res.status(400).json({ error: pwProblem });
  }

  const otpRow = db.prepare(`
    SELECT * FROM otps WHERE user_id = ? AND purpose = 'password_reset' AND consumed = 0
    ORDER BY id DESC LIMIT 1
  `).get(payload.sub);

  if(!otpRow){
    return res.status(400).json({ error: 'No active reset code found. Please request a new one.' });
  }
  if(new Date(otpRow.expires_at).getTime() < Date.now()){
    return res.status(400).json({ error: 'This code has expired. Please request a new one.' });
  }
  if(otpRow.attempts >= 5){
    return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new code.' });
  }
  if(!code || !bcrypt.compareSync(String(code), otpRow.code_hash)){
    db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE id = ?').run(otpRow.id);
    return res.status(400).json({ error: 'That code doesn’t match. Please try again.' });
  }

  db.prepare('UPDATE otps SET consumed = 1 WHERE id = ?').run(otpRow.id);
  const passwordHash = bcrypt.hashSync(newPassword, 10);
  // Also end every existing login: if someone else knew the old password, they're signed out now.
  db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(passwordHash, payload.sub);

  res.json({ message: 'Password updated. You can now sign in with your new password.' });
});

// ---- POST /api/auth/resend-otp ----
router.post('/resend-otp', async (req, res) => {
  const { pendingToken } = req.body || {};
  const payload = pendingToken ? verifyToken(pendingToken) : null;
  if(!payload || payload.purpose !== 'otp-pending'){
    return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
  if(!user) return res.status(404).json({ error: 'User not found.' });

  const code = genOtp();
  const codeHash = bcrypt.hashSync(code, 8);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO otps (user_id, purpose, code_hash, expires_at) VALUES (?, 'login', ?, ?)`).run(user.id, codeHash, expiresAt);

  let emailResult;
  try{
    emailResult = await sendOtpEmail(user.email, code);
  }catch(err){
    return res.status(502).json({ error: 'Could not send the verification code. Please try again shortly.' });
  }

  const response = { expiresInSeconds: 300 };
  if(emailResult.devFallback) response.devOtp = code;
  res.json(response);
});

// ---- GET /api/auth/me  (auth) ----
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if(!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: publicUser(user) });
});

module.exports = router;

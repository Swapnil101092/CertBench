const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signSessionToken, signResetToken, verifyToken, requireAuth, isAdminUser } = require('../auth');
const { sendOtpEmail, sendPasswordResetEmail, isConfigured: emailConfigured } = require('../email');
const sms = require('../sms');
const registration = require('../registration');

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

function maskMobile(m){
  const d = String(m);
  return '+91 ' + d.slice(0, 2) + '******' + d.slice(-2);
}

// Is the username, email or mobile already used by an account? Returns { field, message } or null.
function takenField({ username, email, mobile }){
  if(db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return { field: 'username', message: 'That username is already taken.' };
  if(db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return { field: 'email', message: 'An account with that email already exists.' };
  if(db.prepare('SELECT id FROM users WHERE mobile = ?').get(mobile)) return { field: 'mobile', message: 'An account with that mobile number already exists.' };
  return null;
}

function genOtp(){
  return String(Math.floor(100000 + Math.random() * 900000));
}

function publicUser(u){
  return { id: u.id, name: u.name, email: u.email, mobile: u.mobile, username: u.username, isAdmin: isAdminUser(u) };
}

// ---- POST /api/auth/register  (step 1: check the details, send codes to the email and mobile) ----
// Nothing is created yet: the account only exists once both codes are confirmed (step 2).
router.post('/register', async (req, res) => {
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

  const taken = takenField({ username: uname, email: trimmedEmail, mobile: digits });
  if(taken) return res.status(409).json({ error: taken.message, fields: { [taken.field]: taken.message } });

  // The mobile code is sent when SMS is set up. On a dev machine with no email or SMS provider at
  // all, both codes are shown on screen instead so the whole flow can still be tried.
  const withMobile = sms.isConfigured() || !emailConfigured();
  const pending = registration.create({
    name: trimmedName, email: trimmedEmail, mobile: digits, username: uname,
    passwordHash: bcrypt.hashSync(password, 10), withMobile
  });

  let emailResult, smsResult = null;
  try{
    emailResult = await sendOtpEmail(trimmedEmail, pending.emailCode);
  }catch(err){
    console.error('Registration email failed:', err.message);
    registration.remove(pending.id);
    return res.status(502).json({ error: 'Could not send the email code. Please check the address and try again.' });
  }
  if(withMobile){
    try{
      smsResult = await sms.sendOtpSms(digits, pending.mobileCode);
    }catch(err){
      console.error('Registration SMS failed:', err.message);
      registration.remove(pending.id);
      return res.status(502).json({ error: 'Could not send the SMS code. Please check the mobile number and try again.' });
    }
  }

  const response = {
    registrationId: pending.id,
    emailMasked: maskEmail(trimmedEmail),
    mobileMasked: withMobile ? maskMobile(digits) : null,
    needsMobileCode: withMobile,
    expiresInSeconds: registration.CODE_TTL_MS / 1000,
    resendInSeconds: registration.RESEND_GAP_MS / 1000
  };
  // Only when no real provider is set up (local/dev use) — never once email / SMS are configured.
  if(emailResult.devFallback) response.devEmailOtp = pending.emailCode;
  if(smsResult && smsResult.devFallback) response.devMobileOtp = pending.mobileCode;
  res.status(201).json(response);
});

// ---- POST /api/auth/register/verify  (step 2: both codes correct → create the account, signed in) ----
router.post('/register/verify', (req, res) => {
  const { registrationId, emailCode, mobileCode } = req.body || {};
  const p = registration.get(registrationId);
  if(!p) return res.status(400).json({ error: 'This sign-up has expired. Please fill in the form again.', restart: true });

  const check = registration.checkCodes(p, emailCode, mobileCode);
  if(!check.ok) return res.status(check.status).json({ error: check.error, fields: check.fields, restart: check.status === 429 });

  // Someone may have taken the username / email / mobile while the codes were on their way.
  const taken = takenField(p);
  if(taken){
    registration.remove(p.id);
    return res.status(409).json({ error: taken.message, fields: { [taken.field]: taken.message }, restart: true });
  }

  let info;
  try{
    info = db.prepare(`
      INSERT INTO users (name, email, mobile, username, password_hash, email_verified, mobile_verified)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run(p.name, p.email, p.mobile, p.username, p.password_hash, p.mobile_code_hash ? 1 : 0);
  }catch(err){
    registration.remove(p.id);
    return res.status(409).json({ error: 'That username or email is already registered.', restart: true });
  }
  registration.remove(p.id);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ token: signSessionToken(user), user: publicUser(user) });
});

// ---- POST /api/auth/register/resend  { registrationId, channel: 'email' | 'mobile' } ----
router.post('/register/resend', async (req, res) => {
  const { registrationId, channel } = req.body || {};
  if(channel !== 'email' && channel !== 'mobile') return res.status(400).json({ error: 'Choose email or mobile.' });
  const p = registration.get(registrationId);
  if(!p) return res.status(400).json({ error: 'This sign-up has expired. Please fill in the form again.', restart: true });

  const fresh = registration.newCode(p, channel);
  if(fresh.error) return res.status(fresh.status).json({ error: fresh.error, retryInSeconds: fresh.retryInSeconds });

  let result;
  try{
    result = channel === 'email' ? await sendOtpEmail(p.email, fresh.code) : await sms.sendOtpSms(p.mobile, fresh.code);
  }catch(err){
    console.error(`Registration ${channel} resend failed:`, err.message);
    return res.status(502).json({ error: 'Could not send the code. Please try again shortly.' });
  }
  const response = { expiresInSeconds: registration.CODE_TTL_MS / 1000, resendInSeconds: registration.RESEND_GAP_MS / 1000 };
  if(result.devFallback) response[channel === 'email' ? 'devEmailOtp' : 'devMobileOtp'] = fresh.code;
  res.json(response);
});

// ---- POST /api/auth/login  (username + password; email and mobile were verified at sign-up) ----
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if(typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password){
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const uname = String(username).trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(uname);
  if(!user || !bcrypt.compareSync(password, user.password_hash)){
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }
  res.json({ token: signSessionToken(user), user: publicUser(user) });
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
  db.prepare('UPDATE users SET password_hash = ?, email_verified = 1, token_version = token_version + 1 WHERE id = ?').run(passwordHash, payload.sub);

  res.json({ message: 'Password updated. You can now sign in with your new password.' });
});

// ---- GET /api/auth/me  (auth) ----
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if(!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: publicUser(user) });
});

module.exports = router;

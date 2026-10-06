// Regression + validation tests for registration (with email + mobile codes) and the sign-in flow.
// Run with:  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, validUser } = require('./helpers');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(() => srv && srv.stop());

// The full sign-up: details, then both verification codes. Field problems fail at the first step.
async function register(over){ return srv.signUp(validUser(over)); }
async function expectRejected(over, msgPart){
  const r = await register(over);
  assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(over)}, got ${r.status} ${JSON.stringify(r.data)}`);
  if(msgPart) assert.match(r.data.error, msgPart);
  return r;
}
async function expectAccepted(over){
  const r = await register(over);
  assert.equal(r.status, 201, `expected 201 for ${JSON.stringify(over)}, got ${r.status} ${JSON.stringify(r.data)}`);
  return r;
}

// ---------------------------------------------------------------- happy path / end to end
test('E2E: register -> email + mobile codes -> signed in -> /me -> forgot -> reset -> password sign-in', async () => {
  const u = validUser();
  const step1 = await srv.api('/auth/register', { method: 'POST', body: u });
  assert.equal(step1.status, 201);
  assert.ok(step1.data.registrationId, 'a sign-up id for step 2');
  assert.equal(step1.data.needsMobileCode, true);
  assert.match(step1.data.devEmailOtp, /^\d{6}$/);
  assert.match(step1.data.devMobileOtp, /^\d{6}$/);
  assert.match(step1.data.emailMasked, /\*/);
  assert.match(step1.data.mobileMasked, /^\+91 \d\d\*{6}\d\d$/);
  assert.ok(!('user' in step1.data) && !('token' in step1.data), 'no account until the codes are confirmed');

  // Not an account yet: the username cannot sign in.
  const early = await srv.api('/auth/login', { method: 'POST', body: { username: u.username, password: u.password } });
  assert.equal(early.status, 401);

  // Wrong codes: each one is reported on its own field.
  const bad = await srv.api('/auth/register/verify', { method: 'POST', body: { registrationId: step1.data.registrationId, emailCode: step1.data.devEmailOtp, mobileCode: '000000' } });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.fields.mobileCode && !bad.data.fields.emailCode);
  const bad2 = await srv.api('/auth/register/verify', { method: 'POST', body: { registrationId: step1.data.registrationId, emailCode: '12', mobileCode: step1.data.devMobileOtp } });
  assert.ok(bad2.data.fields.emailCode && !bad2.data.fields.mobileCode);

  const ok = await srv.api('/auth/register/verify', { method: 'POST', body: { registrationId: step1.data.registrationId, emailCode: step1.data.devEmailOtp, mobileCode: step1.data.devMobileOtp } });
  assert.equal(ok.status, 201);
  assert.ok(ok.data.token, 'signed in straight away');
  assert.equal(ok.data.user.username, u.username);
  assert.equal(ok.data.user.isAdmin, false);
  assert.ok(!('password_hash' in ok.data.user), 'never leak the password hash');
  const reuse = await srv.api('/auth/register/verify', { method: 'POST', body: { registrationId: step1.data.registrationId, emailCode: step1.data.devEmailOtp, mobileCode: step1.data.devMobileOtp } });
  assert.equal(reuse.status, 400, 'a sign-up can only be completed once');
  assert.equal(reuse.data.restart, true);

  const me = await srv.api('/auth/me', { token: ok.data.token });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, u.email.toLowerCase());

  // Sign-in is username + password only: no code.
  const login = await srv.api('/auth/login', { method: 'POST', body: { username: u.username.toUpperCase(), password: u.password } });
  assert.equal(login.status, 200, 'username sign-in is case-insensitive');
  assert.ok(login.data.token && !login.data.pendingToken && !login.data.devOtp);
  assert.equal((await srv.api('/auth/me', { token: login.data.token })).status, 200);
  assert.equal((await srv.api('/auth/verify-otp', { method: 'POST', body: {} })).status, 404, 'the old sign-in code step is gone');

  const forgot = await srv.api('/auth/forgot-password', { method: 'POST', body: { email: u.email } });
  assert.equal(forgot.status, 200);
  const weak = await srv.api('/auth/reset-password', { method: 'POST', body: { resetToken: forgot.data.resetToken, code: forgot.data.devOtp, newPassword: 'abc12345' } });
  assert.equal(weak.status, 400, 'reset must enforce the same password rules as registration');
  const reset = await srv.api('/auth/reset-password', { method: 'POST', body: { resetToken: forgot.data.resetToken, code: forgot.data.devOtp, newPassword: 'NewPass#456' } });
  assert.equal(reset.status, 200);
  const old = await srv.api('/auth/me', { token: login.data.token });
  assert.equal(old.status, 401, 'password reset signs out old sessions');

  const oldPw = await srv.api('/auth/login', { method: 'POST', body: { username: u.username, password: u.password } });
  assert.equal(oldPw.status, 401);
  const newPw = await srv.api('/auth/login', { method: 'POST', body: { username: u.username, password: 'NewPass#456' } });
  assert.equal(newPw.status, 200);
});

test('verification: too many wrong codes ends the sign-up', async () => {
  const s1 = await srv.api('/auth/register', { method: 'POST', body: validUser() });
  const body = { registrationId: s1.data.registrationId, emailCode: '111111', mobileCode: '111111' };
  for(let i = 0; i < 5; i++) assert.equal((await srv.api('/auth/register/verify', { method: 'POST', body })).status, 400);
  const locked = await srv.api('/auth/register/verify', { method: 'POST', body: { ...body, emailCode: s1.data.devEmailOtp, mobileCode: s1.data.devMobileOtp } });
  assert.equal(locked.status, 429);
  assert.equal(locked.data.restart, true);
});

test('verification: expired codes are refused', async () => {
  const s1 = await srv.api('/auth/register', { method: 'POST', body: validUser() });
  srv.sql('UPDATE pending_registrations SET expires_at = ? WHERE id = ?', Date.now() - 1000, s1.data.registrationId);
  const r = await srv.api('/auth/register/verify', { method: 'POST', body: { registrationId: s1.data.registrationId, emailCode: s1.data.devEmailOtp, mobileCode: s1.data.devMobileOtp } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /expired/i);
});

test('verification: resend waits 30s, issues a new code and the old one stops working', async () => {
  const s1 = await srv.api('/auth/register', { method: 'POST', body: validUser() });
  const id = s1.data.registrationId;
  const tooSoon = await srv.api('/auth/register/resend', { method: 'POST', body: { registrationId: id, channel: 'mobile' } });
  assert.equal(tooSoon.status, 429);
  assert.ok(tooSoon.data.retryInSeconds > 0);
  srv.sql('UPDATE pending_registrations SET last_mobile_sent_at = 0, last_email_sent_at = 0 WHERE id = ?', id);
  const again = await srv.api('/auth/register/resend', { method: 'POST', body: { registrationId: id, channel: 'mobile' } });
  assert.equal(again.status, 200);
  assert.match(again.data.devMobileOtp, /^\d{6}$/);
  assert.equal((await srv.api('/auth/register/resend', { method: 'POST', body: { registrationId: id, channel: 'fax' } })).status, 400);
  if(again.data.devMobileOtp !== s1.data.devMobileOtp){
    const old = await srv.api('/auth/register/verify', { method: 'POST', body: { registrationId: id, emailCode: s1.data.devEmailOtp, mobileCode: s1.data.devMobileOtp } });
    assert.equal(old.status, 400, 'the replaced mobile code no longer works');
  }
  const ok = await srv.api('/auth/register/verify', { method: 'POST', body: { registrationId: id, emailCode: s1.data.devEmailOtp, mobileCode: again.data.devMobileOtp } });
  assert.equal(ok.status, 201);
});

test('verification: details taken by someone else meanwhile are caught at the last step', async () => {
  const u = validUser();
  const first = await srv.api('/auth/register', { method: 'POST', body: u });
  const second = await srv.api('/auth/register', { method: 'POST', body: { ...validUser(), username: u.username } });
  assert.equal(second.status, 201, 'nobody owns the username yet');
  const done = await srv.api('/auth/register/verify', { method: 'POST', body: { registrationId: second.data.registrationId, emailCode: second.data.devEmailOtp, mobileCode: second.data.devMobileOtp } });
  assert.equal(done.status, 201);
  const late = await srv.api('/auth/register/verify', { method: 'POST', body: { registrationId: first.data.registrationId, emailCode: first.data.devEmailOtp, mobileCode: first.data.devMobileOtp } });
  assert.equal(late.status, 409);
  assert.ok(late.data.fields.username);
  assert.equal(late.data.restart, true);
});

test('verification: unknown or malformed sign-up ids are refused', async () => {
  for(const registrationId of [undefined, '', 'x', 'a'.repeat(300), 'abcdefghijklmnopqrstuvwxyz0123456789']){
    const r = await srv.api('/auth/register/verify', { method: 'POST', body: { registrationId, emailCode: '123456', mobileCode: '123456' } });
    assert.equal(r.status, 400);
  }
});

test('forgot-password does not reveal whether an email exists', async () => {
  const r = await srv.api('/auth/forgot-password', { method: 'POST', body: { email: 'nobody-here@example.com' } });
  assert.equal(r.status, 200);
  assert.ok(!r.data.resetToken);
});

test('login with wrong password or unknown user gives the same 401', async () => {
  const u = validUser(); await srv.signUp(u);
  const a = await srv.api('/auth/login', { method: 'POST', body: { username: u.username, password: 'Wrong#Pass1' } });
  const b = await srv.api('/auth/login', { method: 'POST', body: { username: 'no_such_user', password: 'Wrong#Pass1' } });
  assert.equal(a.status, 401); assert.equal(b.status, 401); assert.equal(a.data.error, b.data.error);
});

// ---------------------------------------------------------------- required fields / types
test('every field is required', async () => {
  for(const k of ['name', 'email', 'mobile', 'username', 'password']){
    await expectRejected({ [k]: '' });
    await expectRejected({ [k]: '   ' });
  }
});
test('non-string values are rejected with 400, not a server error', async () => {
  for(const k of ['name', 'email', 'mobile', 'username', 'password']){
    for(const v of [12345678, ['Abc@12345'], { a: 1 }, true]){
      const r = await srv.api('/auth/register', { method: 'POST', body: validUser({ [k]: v }) });
      assert.equal(r.status, 400, `${k}=${JSON.stringify(v)} -> ${r.status}`);
    }
  }
});
test('malformed JSON body gives 400', async () => {
  const r = await srv.api('/auth/register', { method: 'POST', raw: '{"name": ' });
  assert.equal(r.status, 400);
});

// ---------------------------------------------------------------- username
test('username: numbers are NOT allowed', async () => {
  for(const u of ['john123', '123john', 'john_2', '9999', 'j0hn', 'test.user1']) await expectRejected({ username: u }, /username/i);
});
test('username: valid forms are accepted', async () => {
  for(const u of ['john', 'john_doe', 'john.doe', 'JohnDoe', 'abc']) await expectAccepted({ username: u });
});
test('username: stored lowercase and unique case-insensitively', async () => {
  await expectAccepted({ username: 'CaseUser' });
  const r = await register({ username: 'caseuser' });
  assert.equal(r.status, 409);
});
test('username: length 3-20', async () => {
  await expectRejected({ username: 'ab' }, /username/i);
  await expectRejected({ username: 'a'.repeat(21) }, /username/i);
  await expectAccepted({ username: 'b'.repeat(20) });
});
test('username: no spaces, symbols, or non-Latin letters', async () => {
  for(const u of ['john doe', 'john-doe', 'john@doe', 'john!', 'jöhn', 'जॉन', '<script>', "john'", 'john$']) await expectRejected({ username: u }, /username/i);
});
test('username: must start with a letter and not end with . or _', async () => {
  for(const u of ['_john', '.john', 'john_', 'john.']) await expectRejected({ username: u }, /username/i);
});
test('username: no consecutive dots/underscores', async () => {
  for(const u of ['john..doe', 'john__doe', 'john._doe']) await expectRejected({ username: u }, /username/i);
});
test('username: reserved names are blocked', async () => {
  for(const u of ['admin', 'Administrator', 'root', 'support', 'certbench', 'system']) await expectRejected({ username: u }, /reserved|not available/i);
});

// ---------------------------------------------------------------- name
test('name: valid names accepted', async () => {
  for(const n of ["Swapnil Jain", "Mary-Jane O'Neil", 'A. B. Kumar', 'Li']) await expectAccepted({ name: n });
});
test('name: digits, symbols, single letter, too long rejected', async () => {
  for(const n of ['John2', 'J', 'John@Doe', '<b>John</b>', '---', 'A'.repeat(81), "John  --  Doe", '. John']) await expectRejected({ name: n }, /name/i);
});
test('name: extra inner spaces are collapsed', async () => {
  const r = await expectAccepted({ name: '  Ravi    Kumar  ' });
  assert.equal(r.data.user.name, 'Ravi Kumar');
});

// ---------------------------------------------------------------- email
test('email: invalid formats rejected', async () => {
  for(const e of ['plainaddress', 'a@b', 'a@b.c', '@example.com', 'john@', 'john..doe@example.com', '.john@example.com', 'john.@example.com', 'john doe@example.com', 'john@exa mple.com', 'john@-example.com', 'a'.repeat(65) + '@example.com']) await expectRejected({ email: e }, /email/i);
});
test('email: stored lowercase; duplicate (any case) rejected', async () => {
  const r = await expectAccepted({ email: 'Mixed.Case@Example.COM' });
  assert.equal(r.data.user.email, 'mixed.case@example.com');
  const d = await register({ email: 'mixed.case@example.com' });
  assert.equal(d.status, 409);
});
test('email: plus-addressing and subdomains are allowed', async () => {
  await expectAccepted({ email: 'qa+certbench@mail.example.co.in' });
});

// ---------------------------------------------------------------- mobile
test('mobile: must be a 10-digit Indian number starting 6-9', async () => {
  for(const m of ['12345', '12345678901', '5876543210', '0000000000', 'abcdefghij', '98765-4321']) await expectRejected({ mobile: m }, /mobile/i);
});
test('mobile: obviously fake numbers rejected', async () => {
  for(const m of ['9999999999', '6666666666']) await expectRejected({ mobile: m }, /mobile/i);
});
test('mobile: +91 / 0 prefix and spaces are accepted and normalised', async () => {
  const a = await expectAccepted({ mobile: '+91 98234 56710' });
  assert.equal(a.data.user.mobile, '9823456710');
  const b = await expectAccepted({ mobile: '09823456711' });
  assert.equal(b.data.user.mobile, '9823456711');
});
test('mobile: already-registered number is rejected', async () => {
  await expectAccepted({ mobile: '9123456780' });
  const r = await register({ mobile: '9123456780' });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /mobile/i);
});

// ---------------------------------------------------------------- password
test('password: strength rules', async () => {
  for(const p of ['Ab@1', 'abcdefgh', '12345678', 'abcd1234', 'ABCD@1234', 'abcd@1234', 'Abcd12345', 'Abcd @1234', 'A1@' + 'a'.repeat(70)]) await expectRejected({ password: p }, /password/i);
});
test('password: must not contain the username', async () => {
  await expectRejected({ username: 'ravi', password: 'Ravi@2026x' }, /password/i);
});
test('password: strong passwords accepted', async () => {
  await expectAccepted({ password: 'Str0ng#Pass' });
});

// Admin panel user management must enforce the same rules as self-registration.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, validUser } = require('./helpers');

let srv, token;
test.before(async () => {
  srv = await startServer();
  const a = validUser({ username: 'boss_user' });
  await srv.api('/auth/register', { method: 'POST', body: a });
  srv.sql('UPDATE users SET is_admin = 1 WHERE username = ?', 'boss_user');
  const l = await srv.api('/auth/login', { method: 'POST', body: { username: a.username, password: a.password } });
  const v = await srv.api('/auth/verify-otp', { method: 'POST', body: { pendingToken: l.data.pendingToken, code: l.data.devOtp } });
  token = v.data.token;
});
test.after(() => srv && srv.stop());

test('admin create user: username with digits rejected', async () => {
  const r = await srv.api('/admin/users', { method: 'POST', token, body: validUser({ username: 'agent007' }) });
  assert.equal(r.status, 400);
  assert.match(r.data.fields.username, /numbers/i);
});
test('admin create user: valid user accepted', async () => {
  const r = await srv.api('/admin/users', { method: 'POST', token, body: validUser({ username: 'new_member' }) });
  assert.equal(r.status, 201);
});
test('admin edit: legacy account with digits in username can still be edited', async () => {
  const info = srv.sql("INSERT INTO users (name, email, mobile, username, password_hash) VALUES ('Old Timer', 'old@example.com', '9876501234', 'olduser99', 'x')");
  const id = Number(info.lastInsertRowid);
  const r = await srv.api('/admin/users/' + id, { method: 'PUT', token, body: { name: 'Old Timer Two', email: 'old@example.com', mobile: '9876501234', username: 'olduser99' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.user.name, 'Old Timer Two');
  const bad = await srv.api('/admin/users/' + id, { method: 'PUT', token, body: { username: 'newname1' } });
  assert.equal(bad.status, 400, 'changing to a new invalid username is still blocked');
});
test('admin set password: same strength rules', async () => {
  const r = await srv.api('/admin/users', { method: 'POST', token, body: validUser({ username: 'pw_target' }) });
  const weak = await srv.api(`/admin/users/${r.data.user.id}/password`, { method: 'POST', token, body: { password: 'abc12345' } });
  assert.equal(weak.status, 400);
  const ok = await srv.api(`/admin/users/${r.data.user.id}/password`, { method: 'POST', token, body: { password: 'Fresh#Pass9' } });
  assert.equal(ok.status, 200);
});

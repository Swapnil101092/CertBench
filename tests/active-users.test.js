// The admin overview counts users who used the site while signed in during the last 15 minutes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, validUser } = require('./helpers');

let srv, adminToken;
async function login(u){
  const l = await srv.api('/auth/login', { method: 'POST', body: { username: u.username, password: u.password } });
  return l.data.token;
}
test.before(async () => {
  srv = await startServer();
  const a = validUser({ username: 'boss_user' });
  await srv.signUp(a);
  srv.sql('UPDATE users SET is_admin = 1 WHERE username = ?', 'boss_user');
  adminToken = await login(a);
});
test.after(() => srv && srv.stop());

test('active users: counts signed-in requests in the last 15 minutes only', async () => {
  let r = await srv.api('/admin/overview', { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.data.counts.activeUsers, 1, 'the admin themselves');
  assert.equal(r.data.activeWindowMinutes, 15);

  const s = validUser({ username: 'student_one' });
  await srv.signUp(s);
  const t = await login(s);
  await srv.api('/auth/me', { token: t });
  r = await srv.api('/admin/overview', { token: adminToken });
  assert.equal(r.data.counts.activeUsers, 2);

  const list = await srv.api('/admin/users?q=student_one', { token: adminToken });
  assert.equal(list.data.users[0].activeNow, true);

  srv.sql("UPDATE users SET last_seen_at = datetime('now', '-16 minutes') WHERE username = 'student_one'");
  r = await srv.api('/admin/overview', { token: adminToken });
  assert.equal(r.data.counts.activeUsers, 1, 'idle for 16 minutes is no longer active');
});

test('active users: "sign out everywhere" drops the user from the count', async () => {
  const s = validUser({ username: 'student_two' });
  await srv.signUp(s);
  const t = await login(s);
  await srv.api('/auth/me', { token: t });
  const before = (await srv.api('/admin/overview', { token: adminToken })).data.counts.activeUsers;
  const list = await srv.api('/admin/users?q=student_two', { token: adminToken });
  await srv.api(`/admin/users/${list.data.users[0].id}/signout`, { method: 'POST', token: adminToken });
  const after = (await srv.api('/admin/overview', { token: adminToken })).data.counts.activeUsers;
  assert.equal(after, before - 1);
});

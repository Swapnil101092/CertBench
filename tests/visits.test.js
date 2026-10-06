// Home page visitor counter: each browser counts once per day; totals add up across days.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, validUser } = require('./helpers');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(() => srv && srv.stop());

const id = (n) => 'visitor-test-id-' + String(n).padStart(4, '0');

test('visits: starts at zero', async () => {
  const r = await srv.api('/visits');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { enabled: true, total: 0, today: 0 });
});

test('visits: the same browser is counted once per day', async () => {
  let r = await srv.api('/visits', { method: 'POST', body: { id: id(1) } });
  assert.deepEqual(r.data, { enabled: true, total: 1, today: 1 });
  r = await srv.api('/visits', { method: 'POST', body: { id: id(1) } });
  assert.deepEqual(r.data, { enabled: true, total: 1, today: 1 }, 'repeat visit is not counted');
  r = await srv.api('/visits', { method: 'POST', body: { id: id(2) } });
  assert.deepEqual(r.data, { enabled: true, total: 2, today: 2 });
});

test('visits: earlier days add to the total but not to today', async () => {
  srv.sql("INSERT INTO visit_daily (day, visitors) VALUES ('2020-01-01', 500)");
  const r = await srv.api('/visits');
  assert.deepEqual(r.data, { enabled: true, total: 502, today: 2 });
});

test('visits: rejects missing or malformed ids', async () => {
  for(const body of [{}, { id: 'short' }, { id: 'has spaces in it here!!' }, { id: 12345678901234567 }]){
    const r = await srv.api('/visits', { method: 'POST', body });
    assert.equal(r.status, 400);
  }
  assert.equal((await srv.api('/visits')).data.total, 502);
});

test('visits: admin can hide the counter; visits are still counted while hidden', async () => {
  const a = validUser({ username: 'visit_admin' });
  await srv.api('/auth/register', { method: 'POST', body: a });
  srv.sql('UPDATE users SET is_admin = 1 WHERE username = ?', 'visit_admin');
  const l = await srv.api('/auth/login', { method: 'POST', body: { username: a.username, password: a.password } });
  const token = (await srv.api('/auth/verify-otp', { method: 'POST', body: { pendingToken: l.data.pendingToken, code: l.data.devOtp } })).data.token;

  let r = await srv.api('/admin/settings', { method: 'PUT', token, body: { visitorCounterEnabled: false } });
  assert.equal(r.status, 200);
  assert.equal(r.data.settings.visitorCounterEnabled, false);
  assert.equal((await srv.api('/settings/public')).data.visitorCounter.enabled, false);

  // Public endpoints hand out no numbers while hidden, but still count new browsers.
  r = await srv.api('/visits', { method: 'POST', body: { id: id(3) } });
  assert.deepEqual(r.data, { enabled: false });
  r = await srv.api('/visits/admin', { token });
  assert.deepEqual(r.data, { enabled: false, total: 503, today: 3 });

  // Only admins can read the admin numbers or change the switch.
  assert.equal((await srv.api('/visits/admin')).status, 401);
  assert.equal((await srv.api('/admin/settings', { method: 'PUT', token, body: { visitorCounterEnabled: 'yes' } })).status, 400);

  r = await srv.api('/admin/settings', { method: 'PUT', token, body: { visitorCounterEnabled: true } });
  assert.equal(r.data.settings.visitorCounterEnabled, true);
  assert.deepEqual((await srv.api('/visits')).data, { enabled: true, total: 503, today: 3 });
});

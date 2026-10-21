// Contact us panel: admins can hide the whole panel or any one detail; hidden details never reach the public API.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, validUser } = require('./helpers');

let srv, token;
test.before(async () => {
  srv = await startServer();
  const a = validUser({ username: 'contact_admin' });
  await srv.signUp(a);
  srv.sql('UPDATE users SET is_admin = 1 WHERE username = ?', a.username);
  token = (await srv.api('/auth/login', { method: 'POST', body: { username: a.username, password: a.password } })).data.token;
});
test.after(() => srv && srv.stop());

const pub = async () => (await srv.api('/settings/public')).data.contact;
const put = (body) => srv.api('/admin/settings', { method: 'PUT', token, body });

test('contact: everything is shown by default', async () => {
  const c = await pub();
  assert.equal(c.enabled, true);
  assert.ok(c.address && c.phone && c.email);
  const s = (await srv.api('/admin/settings', { token })).data.settings;
  assert.deepEqual([s.contactEnabled, s.contactShowAddress, s.contactShowPhone, s.contactShowEmail], [true, true, true, true]);
});

test('contact: one detail can be hidden, and is left out of the public settings', async () => {
  const r = await put({ contactShowAddress: false });
  assert.equal(r.status, 200);
  assert.equal(r.data.settings.contactShowAddress, false);
  const c = await pub();
  assert.equal(c.address, null);
  assert.ok(c.phone && c.email);
  assert.ok(!JSON.stringify(await srv.api('/settings/public')).includes('Wagholi'), 'hidden address is not sent');
});

test('contact: the whole panel can be hidden and shown again', async () => {
  await put({ contactEnabled: false });
  assert.deepEqual(await pub(), { enabled: false });
  await put({ contactEnabled: true, contactShowAddress: true });
  const c = await pub();
  assert.equal(c.enabled, true);
  assert.ok(c.address);
});

test('contact: switches must be true or false', async () => {
  for(const key of ['contactEnabled', 'contactShowAddress', 'contactShowPhone', 'contactShowEmail']){
    const r = await put({ [key]: 'no' });
    assert.equal(r.status, 400, key);
  }
});

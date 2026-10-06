// About Us photos: admins upload/caption/reorder/delete; the public site lists and serves them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, validUser } = require('./helpers');

let srv, admin, user;
async function signUp(over){
  const u = validUser(over);
  await srv.signUp(u);
  const l = await srv.api('/auth/login', { method: 'POST', body: { username: u.username, password: u.password } });
  return l.data.token;
}
// A real 1x1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test.before(async () => {
  srv = await startServer();
  admin = await signUp({ username: 'photo_boss' });
  srv.sql('UPDATE users SET is_admin = 1 WHERE username = ?', 'photo_boss');
  user = await signUp();
});
test.after(() => srv && srv.stop());

test('photos: admin only', async () => {
  assert.equal((await srv.api('/admin/photos', { method: 'POST', body: { image: PNG } })).status, 401);
  assert.equal((await srv.api('/admin/photos', { method: 'POST', token: user, body: { image: PNG } })).status, 403);
});

test('photos: rejects non-images and bad captions', async () => {
  const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
  const r1 = await srv.api('/admin/photos', { method: 'POST', token: admin, body: { image: svg } });
  assert.equal(r1.status, 400); assert.ok(r1.data.fields.image);
  const r2 = await srv.api('/admin/photos', { method: 'POST', token: admin, body: { image: PNG, caption: 'x'.repeat(200) } });
  assert.equal(r2.status, 400); assert.ok(r2.data.fields.caption);
});

test('photos: upload, list publicly, serve, caption, reorder, delete', async () => {
  const a = await srv.api('/admin/photos', { method: 'POST', token: admin, body: { image: PNG, caption: 'Team' } });
  assert.equal(a.status, 200);
  const b = await srv.api('/admin/photos', { method: 'POST', token: admin, body: { image: PNG } });
  const [p1, p2] = b.data.photos;
  assert.equal(p1.caption, 'Team');

  const pub = await srv.api('/settings/public');
  assert.deepEqual(pub.data.aboutPhotos.map(p => p.id), [p1.id, p2.id]);
  const img = await fetch(srv.base + pub.data.aboutPhotos[0].url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal(img.headers.get('x-content-type-options'), 'nosniff');

  const c = await srv.api('/admin/photos/' + p2.id, { method: 'PUT', token: admin, body: { caption: 'Office' } });
  assert.equal(c.data.photos[1].caption, 'Office');
  assert.notEqual(c.data.photos[1].url, p2.url, 'url version changes so caches refresh');

  const m = await srv.api('/admin/photos/' + p2.id + '/move', { method: 'POST', token: admin, body: { dir: -1 } });
  assert.deepEqual(m.data.photos.map(p => p.id), [p2.id, p1.id]);

  const d = await srv.api('/admin/photos/' + p2.id, { method: 'DELETE', token: admin });
  assert.deepEqual(d.data.photos.map(p => p.id), [p1.id]);
  assert.equal((await fetch(srv.base + '/api/settings/photos/' + p2.id)).status, 404);
});

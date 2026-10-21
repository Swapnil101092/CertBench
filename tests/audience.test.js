// Students and IT Professionals: each account type sees and can use only its own certificates;
// admins, signed-out visitors and accounts that haven't chosen yet see everything.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, validUser } = require('./helpers');

let srv, admin;
test.before(async () => {
  srv = await startServer();
  const a = validUser({ username: 'aud_admin' });
  await srv.signUp(a);
  srv.sql('UPDATE users SET is_admin = 1 WHERE username = ?', a.username);
  admin = await login(a);
});
test.after(() => srv && srv.stop());

async function login(u){
  return (await srv.api('/auth/login', { method: 'POST', body: { username: u.username, password: u.password } })).data.token;
}
async function account(type){
  const u = validUser(type === undefined ? {} : { accountType: type });
  const r = await srv.signUp(u);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { u, token: r.data.token, user: r.data.user };
}
const slugs = async (token) => (await srv.api('/exams', { token })).data.exams.map(e => e.slug);

test('audience: built-in exams are split, VITEEE for Students and the rest for IT Professionals', async () => {
  const all = (await srv.api('/exams')).data.exams;
  assert.equal(all.find(e => e.slug === 'viteee').audience, 'student');
  assert.equal(all.find(e => e.slug === 'azure').audience, 'professional');
  assert.ok(all.length > 2, 'signed-out visitors see everything');
});

test('audience: sign-up stores the type; each type only sees its own certificates', async () => {
  const s = await account('student');
  assert.equal(s.user.accountType, 'student');
  assert.deepEqual(await slugs(s.token), ['viteee']);
  const p = await account('professional');
  const ps = await slugs(p.token);
  assert.ok(ps.includes('azure') && !ps.includes('viteee'));
  const bad = await srv.api('/auth/register', { method: 'POST', body: validUser({ accountType: 'teacher' }) });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.fields.accountType);
});

test('audience: the other type’s exam cannot be opened, started, bought or checked out', async () => {
  const s = await account('student');
  srv.sql("UPDATE exams SET price_inr_paise = 0 WHERE slug = 'k8s'");
  for(const [path, body] of [['/exams/k8s/sets'], ['/exams/k8s/start', { setNumber: 1 }]]){
    const r = await srv.api(path, { method: body ? 'POST' : 'GET', token: s.token, body });
    assert.equal(r.status, 403, path);
    assert.match(r.data.error, /IT Professionals/);
  }
  assert.equal((await srv.api('/payments/enroll', { method: 'POST', token: s.token, body: { examSlug: 'k8s' } })).status, 403);
  const cart = await srv.api('/payments/cart/checkout', { method: 'POST', token: s.token, body: { examSlugs: ['k8s'] } });
  assert.deepEqual(cart.data.unavailable, ['k8s']);
});

test('audience: not chosen yet = sees everything; choosing (or switching) narrows the list', async () => {
  const n = await account();
  assert.equal(n.user.accountType, null);
  assert.ok((await slugs(n.token)).includes('viteee') && (await slugs(n.token)).includes('azure'));
  let r = await srv.api('/auth/account-type', { method: 'PUT', token: n.token, body: { accountType: 'student' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.accountType, 'student');
  assert.deepEqual(await slugs(n.token), ['viteee']);
  r = await srv.api('/auth/account-type', { method: 'PUT', token: n.token, body: { accountType: 'nobody' } });
  assert.equal(r.status, 400);
  assert.equal((await srv.api('/auth/me', { token: n.token })).data.user.accountType, 'student');
});

test('audience: an exam already paid for stays open after switching type', async () => {
  const p = await account('professional');
  srv.sql("UPDATE exams SET price_inr_paise = 0 WHERE slug = 'devops'");
  assert.equal((await srv.api('/payments/enroll', { method: 'POST', token: p.token, body: { examSlug: 'devops' } })).status, 200);
  await srv.api('/auth/account-type', { method: 'PUT', token: p.token, body: { accountType: 'student' } });
  const list = await slugs(p.token);
  assert.ok(list.includes('devops') && list.includes('viteee') && !list.includes('azure'));
  assert.equal((await srv.api('/exams/devops/sets', { token: p.token })).status, 200);
});

test('audience: admins see every certificate, set who a certificate is for, and filter users by type', async () => {
  srv.sql("UPDATE users SET account_type = 'student' WHERE username = 'aud_admin'");
  const list = await slugs(admin);
  assert.ok(list.includes('viteee') && list.includes('azure'));

  const exams = (await srv.api('/admin/exams', { token: admin })).data.exams;
  const aws = exams.find(e => e.slug === 'aws');
  assert.equal(aws.audience, 'professional');
  const put = (body) => srv.api('/admin/exams/' + aws.id, { method: 'PUT', token: admin, body: {
    name: aws.name, description: aws.description, shortLabel: aws.shortLabel, color: aws.color,
    durationMinutes: aws.durationMinutes, passPct: aws.passPct, priceInr: aws.priceInr, ...body } });
  assert.equal((await put({ audience: 'everyone' })).status, 400);
  let r = await put({ audience: 'student' });
  assert.equal(r.status, 200);
  assert.equal(r.data.exam.audience, 'student');
  r = await put({});
  assert.equal(r.data.exam.audience, 'student', 'left out = unchanged');
  const s = await account('student');
  assert.ok((await slugs(s.token)).includes('aws'));
  await put({ audience: 'professional' });

  const users = (type) => srv.api('/admin/users?type=' + type, { token: admin }).then(x => x.data.users);
  assert.ok((await users('student')).every(u => u.accountType === 'student'));
  assert.ok((await users('professional')).length > 0);
  assert.ok((await users('none')).every(u => u.accountType === null));
  await account();
  const someone = (await users('none'))[0];
  r = await srv.api('/admin/users/' + someone.id, { method: 'PUT', token: admin, body: { accountType: 'professional' } });
  assert.equal(r.data.user.accountType, 'professional');
});

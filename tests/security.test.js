const test = require('node:test');
const assert = require('node:assert');
const { startServer, validUser } = require('./helpers');

test('every page carries the security headers, and no open CORS', async () => {
  const srv = await startServer();
  try{
    for(const p of ['/', '/admin', '/api/health']){
      const r = await fetch(srv.base + p, { headers: { origin: 'https://evil.example' } });
      assert.match(r.headers.get('content-security-policy') || '', /frame-ancestors 'none'/, p);
      assert.equal(r.headers.get('x-frame-options'), 'DENY', p);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff', p);
      assert.equal(r.headers.get('x-powered-by'), null, p);
      assert.equal(r.headers.get('access-control-allow-origin'), null, p);
    }
  } finally { srv.stop(); }
});

test('on a live server, missing Razorpay keys never make paid exams free', async () => {
  const saved = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  let srv;
  try{ srv = await startServer(); } finally { if(saved === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved; }
  try{
    const u = validUser({ accountType: 'professional' });
    const token = (await srv.signUp(u)).data.token;
    const paid = (await srv.api('/exams', { token })).data.exams.find(e => e.price_inr_paise > 0);
    const enroll = await srv.api('/payments/enroll', { method: 'POST', token, body: { examSlug: paid.slug } });
    assert.equal(enroll.status, 502);
    const cart = await srv.api('/payments/cart/checkout', { method: 'POST', token, body: { examSlugs: [paid.slug] } });
    assert.equal(cart.status, 502);
    assert.equal((await srv.api(`/exams/${paid.slug}/sets`, { token })).status, 402);
  } finally { srv.stop(); }
});

test('starting practice sets is rate limited per account', async () => {
  const srv = await startServer();
  try{
    const token = (await srv.signUp(validUser({ accountType: 'professional' }))).data.token;
    const free = (await srv.api('/exams', { token })).data.exams.find(e => !(e.price_inr_paise > 0));
    const codes = [];
    for(let i = 0; i < 41; i++) codes.push((await srv.api(`/exams/${free.slug}/start`, { method: 'POST', token, body: { setNumber: 1 } })).status);
    assert.equal(codes.filter(c => c === 200).length, 40);
    assert.equal(codes[40], 429);
  } finally { srv.stop(); }
});

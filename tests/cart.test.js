// Cart checkout: several certificates paid for in one payment (dev mode: no Razorpay keys set).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, validUser } = require('./helpers');

// Only the secret is set (no key id), so checkout stays in dev mode but signatures can be checked.
process.env.RAZORPAY_KEY_SECRET = 'test-razorpay-secret';
const sign = (orderId, paymentId) => crypto.createHmac('sha256', 'test-razorpay-secret').update(orderId + '|' + paymentId).digest('hex');

let srv, token, slugs;
test.before(async () => {
  srv = await startServer();
  const u = validUser();
  await srv.signUp(u);
  token = (await srv.api('/auth/login', { method: 'POST', body: { username: u.username, password: u.password } })).data.token;
  const exams = (await srv.api('/exams', { token })).data.exams;
  slugs = exams.map(e => e.slug);
  // Three paid exams (₹199, ₹299, ₹499) and one free one.
  srv.sql('UPDATE exams SET price_inr_paise = 19900 WHERE slug = ?', slugs[0]);
  srv.sql('UPDATE exams SET price_inr_paise = 29900 WHERE slug = ?', slugs[1]);
  srv.sql('UPDATE exams SET price_inr_paise = 49900 WHERE slug = ?', slugs[2]);
  srv.sql('UPDATE exams SET price_inr_paise = 0 WHERE slug = ?', slugs[3]);
});
test.after(() => srv && srv.stop());

const checkout = (examSlugs, t = token) => srv.api('/payments/cart/checkout', { method: 'POST', token: t, body: { examSlugs } });
const enrolled = async () => (await srv.api('/exams', { token })).data.exams.filter(e => e.enrolled).map(e => e.slug);

test('cart: sign-in required and empty / bad carts are refused', async () => {
  assert.equal((await srv.api('/payments/cart/checkout', { method: 'POST', body: { examSlugs: [slugs[0]] } })).status, 401);
  for(const examSlugs of [undefined, [], 'abc', [123, null]]) assert.equal((await checkout(examSlugs)).status, 400);
  const tooMany = Array.from({ length: 61 }, (_, i) => 'exam-' + i);
  assert.match((await checkout(tooMany)).data.error, /at most/);
});

test('cart: one payment covers every certificate, total uses server prices, duplicates ignored', async () => {
  const r = await checkout([slugs[0], slugs[1], slugs[0], slugs[2], 'no-such-exam', slugs[3]]);
  assert.equal(r.status, 200);
  assert.equal(r.data.devMode, true);
  assert.equal(r.data.amountPaise, 19900 + 29900 + 49900);
  assert.deepEqual(r.data.items.map(i => i.slug).sort(), [slugs[0], slugs[1], slugs[2]].sort());
  assert.deepEqual(r.data.enrolledFree, [slugs[3]]);
  assert.deepEqual(r.data.unavailable, ['no-such-exam']);
  assert.deepEqual(r.data.enrolled.sort(), [slugs[0], slugs[1], slugs[2]].sort());
  const now = await enrolled();
  for(const s of slugs.slice(0, 4)) assert.ok(now.includes(s), s + ' should be unlocked');
});

test('cart: already-owned exams are never charged again', async () => {
  const r = await checkout([slugs[0], slugs[1]]);
  assert.equal(r.status, 200);
  assert.equal(r.data.nothingToPay, true);
  assert.equal(r.data.amountPaise, 0);
  assert.deepEqual(r.data.alreadyOwned.sort(), [slugs[0], slugs[1]].sort());
});

test('cart: verify needs a real signature and only the buyer\'s own order', async () => {
  assert.equal((await srv.api('/payments/cart/verify', { method: 'POST', token, body: {} })).status, 400);
  const bad = await srv.api('/payments/cart/verify', { method: 'POST', token, body: { razorpay_order_id: 'order_nope', razorpay_payment_id: 'pay_x', razorpay_signature: 'sig' } });
  assert.equal(bad.status, 404);
});

test('cart: a correctly signed Razorpay payment unlocks every exam in the order; a forged one does not', async () => {
  const u = validUser();
  await srv.signUp(u);
  const t2 = (await srv.api('/auth/login', { method: 'POST', body: { username: u.username, password: u.password } })).data.token;
  const uid = (await srv.api('/auth/me', { token: t2 })).data.user.id;
  // A pending order for two exams, as a live checkout would leave it.
  const { DatabaseSync } = require('node:sqlite');
  const d = new DatabaseSync(srv.dbPath);
  const ids = [slugs[1], slugs[2]].map(s => d.prepare('SELECT id FROM exams WHERE slug = ?').get(s).id);
  const order = d.prepare("INSERT INTO cart_orders (user_id, gateway_order_id, amount_paise) VALUES (?, 'order_live_1', 79800)").run(uid);
  d.prepare('INSERT INTO cart_order_items (cart_order_id, exam_id, price_paise) VALUES (?, ?, 29900), (?, ?, 49900)').run(order.lastInsertRowid, ids[0], order.lastInsertRowid, ids[1]);
  d.close();

  const forged = await srv.api('/payments/cart/verify', { method: 'POST', token: t2, body: { razorpay_order_id: 'order_live_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'f'.repeat(64) } });
  assert.equal(forged.status, 400);
  // Someone else cannot confirm this user's order.
  const other = await srv.api('/payments/cart/verify', { method: 'POST', token, body: { razorpay_order_id: 'order_live_1', razorpay_payment_id: 'pay_1', razorpay_signature: sign('order_live_1', 'pay_1') } });
  assert.equal(other.status, 404);

  const ok = await srv.api('/payments/cart/verify', { method: 'POST', token: t2, body: { razorpay_order_id: 'order_live_1', razorpay_payment_id: 'pay_1', razorpay_signature: sign('order_live_1', 'pay_1') } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data.enrolled.sort(), [slugs[1], slugs[2]].sort());
  const mine = (await srv.api('/exams', { token: t2 })).data.exams.filter(e => e.enrolled).map(e => e.slug);
  assert.ok(mine.includes(slugs[1]) && mine.includes(slugs[2]));
  assert.ok(!mine.includes(slugs[0]), 'nothing outside the order is unlocked');
  const again = await srv.api('/payments/cart/verify', { method: 'POST', token: t2, body: { razorpay_order_id: 'order_live_1', razorpay_payment_id: 'pay_1', razorpay_signature: sign('order_live_1', 'pay_1') } });
  assert.equal(again.data.alreadyPaid, true);
});

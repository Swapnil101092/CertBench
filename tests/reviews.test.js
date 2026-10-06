// Ratings & reviews: users write one review each, admins approve, home page shows the top 5 good ones.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, validUser } = require('./helpers');

let srv, admin;
// Signs up and logs in. Unless `noAttempt` is set, also records a finished practice set,
// because only people who have completed an exam can leave a review.
async function signUp(over, noAttempt){
  const u = validUser(over);
  await srv.signUp(u);
  const l = await srv.api('/auth/login', { method: 'POST', body: { username: u.username, password: u.password } });
  if(!noAttempt){
    srv.sql("INSERT INTO attempts (user_id, exam_id, finished_at, correct_count, total_count, score_pct, passed) SELECT id, (SELECT MIN(id) FROM exams), datetime('now'), 25, 30, 83.3, 1 FROM users WHERE username = ?", u.username);
  }
  return l.data.token;
}
test.before(async () => {
  srv = await startServer();
  admin = await signUp({ username: 'review_boss' });
  srv.sql('UPDATE users SET is_admin = 1 WHERE username = ?', 'review_boss');
});
test.after(() => srv && srv.stop());

test('reviews: login required, validation enforced', async () => {
  assert.equal((await srv.api('/reviews/mine', { method: 'PUT', body: { rating: 5, comment: 'Great practice site!' } })).status, 401);
  const t = await signUp();
  const bad = await srv.api('/reviews/mine', { method: 'PUT', token: t, body: { rating: 6, comment: 'short' } });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.fields.rating && bad.data.fields.comment);
});

test('reviews: pending until approved; top list is 4-5 stars only, max 5, best first', async () => {
  const ids = [];
  const ratings = [5, 4, 3, 5, 4, 5, 2, 4];
  for(let i = 0; i < ratings.length; i++){
    const t = await signUp({ name: 'Reviewer ' + 'ABCDEFGH'[i] + 'son' });
    const r = await srv.api('/reviews/mine', { method: 'PUT', token: t, body: { rating: ratings[i], comment: 'Review text number ' + i } });
    assert.equal(r.status, 200);
    assert.equal(r.data.review.status, 'pending');
  }
  let top = await srv.api('/reviews/top');
  assert.equal(top.data.reviews.length, 0, 'nothing public before approval');

  const list = await srv.api('/admin/reviews?status=pending', { token: admin });
  assert.equal(list.status, 200);
  for(const r of list.data.reviews){
    ids.push(r.id);
    await srv.api(`/admin/reviews/${r.id}/status`, { method: 'POST', token: admin, body: { status: 'approved' } });
  }
  top = await srv.api('/reviews/top');
  assert.equal(top.data.reviews.length, 5);
  assert.ok(top.data.reviews.every(r => r.rating >= 4));
  assert.deepEqual(top.data.reviews.map(r => r.rating), [5, 5, 5, 4, 4]);
  assert.match(top.data.reviews[0].name, /^Reviewer [A-H]\.$/, 'only first name + last initial');
  assert.equal(top.data.summary.count, ratings.length);
  assert.ok(!('email' in top.data.reviews[0]));

  // hiding removes it from the home page
  const five = (await srv.api('/admin/reviews?status=approved', { token: admin })).data.reviews.find(r => r.featured && r.rating === 5);
  await srv.api(`/admin/reviews/${five.id}/status`, { method: 'POST', token: admin, body: { status: 'hidden' } });
  top = await srv.api('/reviews/top');
  assert.ok(!top.data.reviews.some(r => r.id === five.id));
});

test('reviews: editing replaces the review and sends it back for approval', async () => {
  const t = await signUp();
  await srv.api('/reviews/mine', { method: 'PUT', token: t, body: { rating: 5, comment: 'First version of review' } });
  const id = (await srv.api('/admin/reviews?status=pending', { token: admin })).data.reviews[0].id;
  await srv.api(`/admin/reviews/${id}/status`, { method: 'POST', token: admin, body: { status: 'approved' } });
  const e = await srv.api('/reviews/mine', { method: 'PUT', token: t, body: { rating: 4, comment: 'Second version of review' } });
  assert.equal(e.data.review.status, 'pending');
  assert.equal(e.data.review.rating, 4);
  const mine = await srv.api('/reviews/mine', { token: t });
  assert.equal(mine.data.review.comment, 'Second version of review');
  assert.equal((await srv.api('/reviews/mine', { method: 'DELETE', token: t })).data.deleted, true);
  assert.equal((await srv.api('/reviews/mine', { token: t })).data.review, null);
});

test('reviews: only people who finished a practice set can review', async () => {
  const t = await signUp({}, true);
  const mine = await srv.api('/reviews/mine', { token: t });
  assert.equal(mine.data.canReview, false);
  const r = await srv.api('/reviews/mine', { method: 'PUT', token: t, body: { rating: 5, comment: 'Trying to rate without an exam' } });
  assert.equal(r.status, 403);
});

test('reviews: home page data has the exam badge and star breakdown', async () => {
  const top = await srv.api('/reviews/top');
  assert.ok(top.data.reviews[0].exam, 'exam name included');
  const b = top.data.summary.breakdown;
  assert.equal(b[5] + b[4] + b[3] + b[2] + b[1], top.data.summary.count);
});

test('reviews: admin routes need an admin', async () => {
  const t = await signUp();
  assert.equal((await srv.api('/admin/reviews', { token: t })).status, 403);
});

test('settings: contact title and intro are editable and public', async () => {
  const r = await srv.api('/admin/settings', { method: 'PUT', token: admin, body: { contactTitle: 'Talk to us', contactIntro: 'We reply within a day.' } });
  assert.equal(r.status, 200);
  const pub = await srv.api('/settings/public');
  assert.equal(pub.data.contact.title, 'Talk to us');
  assert.equal(pub.data.contact.intro, 'We reply within a day.');
  const bad = await srv.api('/admin/settings', { method: 'PUT', token: admin, body: { contactIntro: 'x'.repeat(301) } });
  assert.equal(bad.status, 400);
});

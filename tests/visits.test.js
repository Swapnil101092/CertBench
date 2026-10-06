// Home page visitor counter: each browser counts once per day; totals add up across days.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(() => srv && srv.stop());

const id = (n) => 'visitor-test-id-' + String(n).padStart(4, '0');

test('visits: starts at zero', async () => {
  const r = await srv.api('/visits');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { total: 0, today: 0 });
});

test('visits: the same browser is counted once per day', async () => {
  let r = await srv.api('/visits', { method: 'POST', body: { id: id(1) } });
  assert.deepEqual(r.data, { total: 1, today: 1 });
  r = await srv.api('/visits', { method: 'POST', body: { id: id(1) } });
  assert.deepEqual(r.data, { total: 1, today: 1 }, 'repeat visit is not counted');
  r = await srv.api('/visits', { method: 'POST', body: { id: id(2) } });
  assert.deepEqual(r.data, { total: 2, today: 2 });
});

test('visits: earlier days add to the total but not to today', async () => {
  srv.sql("INSERT INTO visit_daily (day, visitors) VALUES ('2020-01-01', 500)");
  const r = await srv.api('/visits');
  assert.deepEqual(r.data, { total: 502, today: 2 });
});

test('visits: rejects missing or malformed ids', async () => {
  for(const body of [{}, { id: 'short' }, { id: 'has spaces in it here!!' }, { id: 12345678901234567 }]){
    const r = await srv.api('/visits', { method: 'POST', body });
    assert.equal(r.status, 400);
  }
  assert.equal((await srv.api('/visits')).data.total, 502);
});

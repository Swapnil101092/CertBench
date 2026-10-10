// Cart checkout: pay for several certificates in ONE Razorpay payment.
// The order (and what it covers) is stored here; once the payment is confirmed, each exam gets its
// own row in `enrollments` (as if bought one by one), so access checks and the admin panel's
// revenue figures work unchanged.
const db = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS cart_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gateway_order_id TEXT NOT NULL UNIQUE,
  gateway_payment_id TEXT,
  amount_paise INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',   -- created | paid | failed
  dev_mode INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);
CREATE TABLE IF NOT EXISTS cart_order_items (
  cart_order_id INTEGER NOT NULL REFERENCES cart_orders(id) ON DELETE CASCADE,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  price_paise INTEGER NOT NULL,
  PRIMARY KEY (cart_order_id, exam_id)
);
`);

const MAX_ITEMS = 60;

// Works out what a checkout of these exam slugs contains, using the prices in the database (never
// the browser's). Returns { error } or { toBuy, free, owned, unknown, totalPaise }.
function plan(userId, slugs){
  if(!Array.isArray(slugs) || !slugs.length) return { error: 'Your cart is empty.' };
  const unique = Array.from(new Set(slugs.filter(s => typeof s === 'string' && s.length <= 80)));
  if(!unique.length) return { error: 'Your cart is empty.' };
  if(unique.length > MAX_ITEMS) return { error: `You can check out at most ${MAX_ITEMS} certificates at once.` };

  const getExam = db.prepare('SELECT * FROM exams WHERE slug = ? AND active = 1');
  const isOwned = db.prepare("SELECT 1 FROM enrollments WHERE user_id = ? AND exam_id = ? AND status = 'paid'");
  const out = { toBuy: [], free: [], owned: [], unknown: [], totalPaise: 0 };
  for(const slug of unique){
    const exam = getExam.get(slug);
    if(!exam){ out.unknown.push(slug); continue; }
    if(isOwned.get(userId, exam.id)){ out.owned.push(exam); continue; }
    if(!(exam.price_inr_paise > 0)){ out.free.push(exam); continue; }
    out.toBuy.push(exam);
    out.totalPaise += exam.price_inr_paise;
  }
  return out;
}

function createOrder(userId, orderId, exams, totalPaise, devMode){
  return db.transaction(() => {
    const info = db.prepare('INSERT INTO cart_orders (user_id, gateway_order_id, amount_paise, dev_mode) VALUES (?, ?, ?, ?)')
      .run(userId, orderId, totalPaise, devMode ? 1 : 0);
    const add = db.prepare('INSERT INTO cart_order_items (cart_order_id, exam_id, price_paise) VALUES (?, ?, ?)');
    for(const e of exams) add.run(info.lastInsertRowid, e.id, e.price_inr_paise);
    return info.lastInsertRowid;
  })();
}

function findOrder(userId, orderId){
  return db.prepare('SELECT * FROM cart_orders WHERE gateway_order_id = ? AND user_id = ?').get(orderId, userId) || null;
}

// Marks the order paid and enrolls the user in every exam it covered (skipping any they already own).
// Returns the slugs now enrolled.
function markPaid(order, paymentId){
  return db.transaction(() => {
    db.prepare("UPDATE cart_orders SET status = 'paid', gateway_payment_id = ?, paid_at = datetime('now') WHERE id = ?")
      .run(paymentId || null, order.id);
    const items = db.prepare('SELECT i.exam_id, i.price_paise, e.slug FROM cart_order_items i JOIN exams e ON e.id = i.exam_id WHERE i.cart_order_id = ?').all(order.id);
    const owned = db.prepare("SELECT 1 FROM enrollments WHERE user_id = ? AND exam_id = ? AND status = 'paid'");
    const enroll = db.prepare(`INSERT INTO enrollments (user_id, exam_id, amount_paise, gateway_order_id, gateway_payment_id, status, dev_mode, paid_at)
      VALUES (?, ?, ?, ?, ?, 'paid', ?, datetime('now'))`);
    for(const it of items){
      if(owned.get(order.user_id, it.exam_id)) continue;
      enroll.run(order.user_id, it.exam_id, it.price_paise, `${order.gateway_order_id}#${it.exam_id}`, paymentId || null, order.dev_mode);
    }
    return items.map(it => it.slug);
  })();
}

function markFailed(order){ db.prepare("UPDATE cart_orders SET status = 'failed' WHERE id = ?").run(order.id); }

module.exports = { plan, createOrder, findOrder, markPaid, markFailed, MAX_ITEMS };

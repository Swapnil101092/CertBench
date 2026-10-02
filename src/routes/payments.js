const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const { createOrder, verifySignature, isConfigured } = require('../payments');

const router = express.Router();

// ---- GET /api/payments/config  (public: does the frontend need to load Checkout.js?) ----
router.get('/config', (req, res) => {
  res.json({ liveGateway: isConfigured() });
});

// ---- POST /api/payments/enroll  (auth) — start enrollment for an exam ----
router.post('/enroll', requireAuth, async (req, res) => {
  const { examSlug } = req.body || {};
  const exam = db.prepare('SELECT * FROM exams WHERE slug = ? AND active = 1').get(examSlug);
  if(!exam) return res.status(404).json({ error: 'Exam not found.' });

  // Already enrolled (paid)? Don't charge twice.
  const existing = db.prepare(`
    SELECT * FROM enrollments WHERE user_id = ? AND exam_id = ? AND status = 'paid'
  `).get(req.userId, exam.id);
  if(existing){
    return res.json({ alreadyEnrolled: true });
  }

  if(exam.price_inr_paise <= 0){
    // Free exam — enroll instantly, no gateway involved.
    const info = db.prepare(`
      INSERT INTO enrollments (user_id, exam_id, amount_paise, gateway_order_id, status, dev_mode, paid_at)
      VALUES (?, ?, 0, ?, 'paid', 1, datetime('now'))
    `).run(req.userId, exam.id, 'free_' + Date.now() + '_' + req.userId);
    return res.json({ free: true, enrollmentId: info.lastInsertRowid });
  }

  try{
    const receipt = `u${req.userId}_e${exam.id}_${Date.now()}`;
    const order = await createOrder(exam.price_inr_paise, receipt);

    const info = db.prepare(`
      INSERT INTO enrollments (user_id, exam_id, amount_paise, gateway_order_id, status, dev_mode)
      VALUES (?, ?, ?, ?, 'created', ?)
    `).run(req.userId, exam.id, exam.price_inr_paise, order.orderId, order.devMode ? 1 : 0);

    if(order.devMode){
      // No real gateway configured — mark paid immediately so the flow is
      // fully testable without a Razorpay account.
      db.prepare(`UPDATE enrollments SET status = 'paid', paid_at = datetime('now') WHERE id = ?`)
        .run(info.lastInsertRowid);
      return res.json({
        devMode: true,
        enrollmentId: info.lastInsertRowid,
        orderId: order.orderId,
        amountPaise: exam.price_inr_paise
      });
    }

    res.json({
      devMode: false,
      enrollmentId: info.lastInsertRowid,
      orderId: order.orderId,
      amountPaise: exam.price_inr_paise,
      currency: 'INR',
      keyId: order.keyId,
      examName: exam.name
    });
  }catch(err){
    console.error('Order creation failed:', err.message);
    res.status(502).json({ error: 'Could not start payment. Please try again shortly.' });
  }
});

// ---- POST /api/payments/verify  (auth) — confirm a real Razorpay Checkout payment ----
router.post('/verify', requireAuth, (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if(!razorpay_order_id || !razorpay_payment_id || !razorpay_signature){
    return res.status(400).json({ error: 'Missing payment details.' });
  }

  const enrollment = db.prepare(`
    SELECT * FROM enrollments WHERE gateway_order_id = ? AND user_id = ?
  `).get(razorpay_order_id, req.userId);
  if(!enrollment) return res.status(404).json({ error: 'Enrollment not found.' });
  if(enrollment.status === 'paid') return res.json({ enrolled: true });

  const valid = verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
  if(!valid){
    db.prepare(`UPDATE enrollments SET status = 'failed' WHERE id = ?`).run(enrollment.id);
    return res.status(400).json({ error: 'Payment verification failed.' });
  }

  db.prepare(`
    UPDATE enrollments SET status = 'paid', gateway_payment_id = ?, paid_at = datetime('now') WHERE id = ?
  `).run(razorpay_payment_id, enrollment.id);

  res.json({ enrolled: true });
});

// ---- GET /api/payments/my-enrollments  (auth) ----
router.get('/my-enrollments', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT e.slug FROM enrollments en JOIN exams e ON e.id = en.exam_id
    WHERE en.user_id = ? AND en.status = 'paid'
  `).all(req.userId);
  res.json({ enrolledSlugs: rows.map(r => r.slug) });
});

module.exports = router;

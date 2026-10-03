const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../auth');
const reviews = require('../reviews');

const router = express.Router();

// Public: the top approved reviews for the home page. No login needed.
router.get('/top', (req, res) => {
  res.json(reviews.topPublic());
});

// Signed-in users: read / write / remove their own review.
router.get('/mine', requireAuth, (req, res) => {
  res.json({ review: reviews.mine(req.userId) });
});

const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

router.put('/mine', writeLimiter, requireAuth, (req, res) => {
  const { errors, value } = reviews.validate(req.body);
  if(Object.keys(errors).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors });
  res.json({ review: reviews.saveMine(req.userId, value) });
});

router.delete('/mine', writeLimiter, requireAuth, (req, res) => {
  res.json({ deleted: reviews.deleteMine(req.userId) });
});

module.exports = router;

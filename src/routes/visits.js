const express = require('express');
const rateLimit = require('express-rate-limit');
const visits = require('../visits');

const router = express.Router();

// Stops one machine from inflating the numbers by sending many made-up IDs.
const recordLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

// Public: the visitor numbers shown on the home page.
router.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(visits.counts());
});

// Public: count this browser's visit for today, then return the numbers.
router.post('/', recordLimiter, (req, res) => {
  const id = (req.body || {}).id;
  if(!visits.validId(id)) return res.status(400).json({ error: 'Invalid visitor id.' });
  visits.record(id);
  res.set('Cache-Control', 'no-store');
  res.json(visits.counts());
});

module.exports = router;

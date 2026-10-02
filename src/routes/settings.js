const express = require('express');
const settings = require('../settings');

const router = express.Router();

// Public: the website reads these (contact details, banner message, About text). No login needed,
// and nothing private is in here.
router.get('/public', (req, res) => {
  res.json(settings.getPublic());
});

module.exports = router;

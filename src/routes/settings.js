const express = require('express');
const settings = require('../settings');
const photos = require('../photos');

const router = express.Router();

// Public: the website reads these (contact details, banner message, About text). No login needed,
// and nothing private is in here.
router.get('/public', (req, res) => {
  res.json(settings.getPublic());
});

// Public: an About Us photo. The URL carries ?v=<version>, so it can be cached for a long time.
router.get('/photos/:id', (req, res) => {
  const id = Number(req.params.id);
  const p = Number.isInteger(id) && id > 0 ? photos.get(id) : null;
  if(!p) return res.status(404).json({ error: 'Photo not found.' });
  res.set({
    'Content-Type': p.mime,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'"
  });
  res.send(Buffer.from(p.data));
});

module.exports = router;

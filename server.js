require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./src/routes/auth');
const examRoutes = require('./src/routes/exams');
const paymentRoutes = require('./src/routes/payments');
const adminRoutes = require('./src/routes/admin');
const settingsRoutes = require('./src/routes/settings');
const reviewRoutes = require('./src/routes/reviews');
const visitRoutes = require('./src/routes/visits');

const app = express();
app.set('trust proxy', 1);

app.use(cors());
// Admin requests may carry a CSV of questions or an About Us photo, so they get a larger limit. This must come BEFORE
// the general parser (which then skips bodies that are already parsed).
app.use('/api/admin', express.json({ limit: '3mb' }));
app.use(express.json({ limit: '100kb' }));

// Basic abuse protection on auth endpoints (login/OTP brute force, spam registration).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  // Only the state-changing / credential endpoints (register, login, OTP, password
  // reset) are limited. The session check (GET /api/auth/me) runs on every page load
  // for logged-in users and needs a valid token, so it must not count toward the limit
  // -- otherwise many people refreshing from one shared IP could lock each other out.
  skip: (req) => req.method === 'GET'
});
app.use('/api/auth', authLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/visits', visitRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Serve the frontend
app.use(express.static(path.join(__dirname, 'public')));
// The admin panel is its own page (public/admin.html). The page itself is just a shell:
// everything it shows comes from /api/admin, which requires an admin login.
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('*', (req, res, next) => {
  if(req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Central error handler — avoid leaking stack traces to clients.
app.use((err, req, res, next) => {
  if(err && err.status && err.status >= 400 && err.status < 500){
    // Client mistakes (bad JSON, upload too large): say so plainly instead of a vague 500.
    const message = err.type === 'entity.too.large' ? 'That request is too large.' : 'That request could not be understood.';
    return res.status(err.status).json({ error: message });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// First start on an empty database (e.g. a fresh deploy on Railway/Render): load the built-in exams
// automatically, so hosts without a shell still get questions. Each built-in exam is offered only
// ONCE per database: the slugs already offered are saved, so if you later delete a certificate in
// the admin panel it stays deleted, while built-in exams added in a later release still appear on
// the next start.
(function seedBuiltInExams(){
  const db = require('./src/db');
  const { seed, BANKS, ORIGINAL_SLUGS } = require('./src/seed');
  const getSetting = (name) => db.prepare('SELECT value FROM settings WHERE name = ?').get(name);
  const allSlugs = BANKS.map(b => b.slug);
  let offered;
  if(!getSetting('initial_seed_done')){
    const examCount = db.prepare('SELECT COUNT(*) AS n FROM exams').get().n;
    if(examCount === 0){
      console.log('[SETUP] Empty database: loading the built-in exams (first start only)...');
      seed();
    }
    offered = allSlugs;
  } else {
    // Databases seeded before this list existed were offered the original six exams only.
    const saved = getSetting('builtin_exams_offered');
    offered = saved ? JSON.parse(saved.value) : ORIGINAL_SLUGS;
    const fresh = allSlugs.filter(slug => !offered.includes(slug));
    if(fresh.length){
      console.log(`[SETUP] Loading ${fresh.length} new built-in exam(s)...`);
      seed({ only: fresh });
      offered = offered.concat(fresh);
    }
  }
  db.prepare('INSERT INTO settings (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value')
    .run('builtin_exams_offered', JSON.stringify(offered));
  db.prepare("INSERT OR IGNORE INTO settings (name, value) VALUES ('initial_seed_done', datetime('now'))").run();
})();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CertBench server listening on port ${PORT}`);
  // Say plainly whether ADMIN_EMAILS is doing anything, so a missing email setup is easy to spot in the host's logs.
  const { adminEmailList, adminEmailsActive } = require('./src/auth');
  const admins = adminEmailList();
  if(admins.length && adminEmailsActive()){
    console.log(`[ADMIN] Admin panel access via ADMIN_EMAILS is ON for: ${admins.join(', ')}`);
  } else if(admins.length){
    console.warn('[ADMIN] ADMIN_EMAILS is set but IGNORED: email sending is not configured (BREVO_API_KEY + EMAIL_FROM_ADDRESS, or EMAIL_USER / EMAIL_PASS).');
    console.warn('[ADMIN] Without real email, login codes are shown on screen, so anyone could sign in as that address.');
    console.warn('[ADMIN] Configure email, or use `npm run make-admin -- <username>` from a shell on the server.');
  }
});

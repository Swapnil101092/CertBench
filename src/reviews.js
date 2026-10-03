// Ratings & reviews: shared rules for the public site, signed-in users and the admin panel.
const db = require('./db');

const TOP_LIMIT = 5;          // how many reviews the home page shows
const MIN_TOP_RATING = 4;     // only "good" ratings (4 or 5 stars) are featured
const STATUSES = ['pending', 'approved', 'hidden'];
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;

// "Swapnil Jain" -> "Swapnil J." so full names are never published.
function displayName(name){
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if(!parts.length) return 'CertBench user';
  return parts.length > 1 ? parts[0] + ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.' : parts[0];
}

function validate(body){
  const b = body || {};
  const errors = {};
  const rating = Number(b.rating);
  if(!Number.isInteger(rating) || rating < 1 || rating > 5) errors.rating = 'Pick a rating from 1 to 5 stars.';
  const comment = typeof b.comment === 'string' ? b.comment.replace(/\r\n/g, '\n').trim() : '';
  if(comment.length < 10) errors.comment = 'Please write at least 10 characters about your experience.';
  else if(comment.length > 500) errors.comment = 'Keep your review under 500 characters.';
  else if(CONTROL_RE.test(comment)) errors.comment = 'Your review contains characters that are not allowed.';
  return { errors, value: { rating, comment } };
}

// Only people who have finished at least one practice set can leave a review.
function hasCompletedExam(userId){
  return !!db.prepare('SELECT 1 FROM attempts WHERE user_id = ? AND finished_at IS NOT NULL LIMIT 1').get(userId);
}

// Home page: the best approved reviews (highest rating first, then most recent).
// Each review also carries the exam the reviewer practised most recently (shown as a badge).
function topPublic(){
  const rows = db.prepare(`
    SELECT r.id, r.rating, r.comment, r.updated_at, u.name,
      (SELECT e.name FROM attempts a JOIN exams e ON e.id = a.exam_id
        WHERE a.user_id = r.user_id AND a.finished_at IS NOT NULL ORDER BY a.finished_at DESC, a.id DESC LIMIT 1) AS exam
    FROM reviews r JOIN users u ON u.id = r.user_id
    WHERE r.status = 'approved' AND r.rating >= ?
    ORDER BY r.rating DESC, r.updated_at DESC, r.id DESC
    LIMIT ?`).all(MIN_TOP_RATING, TOP_LIMIT);
  const sum = db.prepare("SELECT COUNT(*) AS n, AVG(rating) AS avg FROM reviews WHERE status = 'approved'").get();
  const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for(const b of db.prepare("SELECT rating, COUNT(*) AS n FROM reviews WHERE status = 'approved' GROUP BY rating").all()) breakdown[b.rating] = b.n;
  return {
    reviews: rows.map(r => ({ id: r.id, rating: r.rating, comment: r.comment, name: displayName(r.name), date: r.updated_at, exam: r.exam || null })),
    summary: { count: sum.n, average: sum.n ? Math.round(sum.avg * 10) / 10 : null, breakdown }
  };
}

function mine(userId){
  const r = db.prepare('SELECT rating, comment, status, updated_at FROM reviews WHERE user_id = ?').get(userId);
  return r ? { rating: r.rating, comment: r.comment, status: r.status, updatedAt: r.updated_at } : null;
}

// Create or replace the user's review. Any change goes back to "pending" so an admin sees it again.
function saveMine(userId, value){
  db.prepare(`
    INSERT INTO reviews (user_id, rating, comment, status) VALUES (?, ?, ?, 'pending')
    ON CONFLICT(user_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment,
      status = 'pending', updated_at = datetime('now')`).run(userId, value.rating, value.comment);
  return mine(userId);
}

function deleteMine(userId){
  return db.prepare('DELETE FROM reviews WHERE user_id = ?').run(userId).changes > 0;
}

// ---- admin ----
function listForAdmin(status){
  const where = STATUSES.includes(status) ? 'WHERE r.status = ?' : '';
  const params = where ? [status] : [];
  const rows = db.prepare(`
    SELECT r.id, r.rating, r.comment, r.status, r.created_at, r.updated_at, u.id AS user_id, u.name, u.username, u.email
    FROM reviews r JOIN users u ON u.id = r.user_id ${where}
    ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, r.updated_at DESC, r.id DESC
    LIMIT 500`).all(...params);
  const counts = { pending: 0, approved: 0, hidden: 0 };
  for(const c of db.prepare('SELECT status, COUNT(*) AS n FROM reviews GROUP BY status').all()) counts[c.status] = c.n;
  const featured = new Set(topPublic().reviews.map(r => r.id));
  return {
    counts,
    reviews: rows.map(r => ({
      id: r.id, rating: r.rating, comment: r.comment, status: r.status,
      createdAt: r.created_at, updatedAt: r.updated_at,
      user: { id: r.user_id, name: r.name, username: r.username, email: r.email },
      publicName: displayName(r.name), featured: featured.has(r.id)
    }))
  };
}

function getById(id){
  return db.prepare('SELECT r.*, u.username FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.id = ?').get(id);
}
function setStatus(id, status){
  return db.prepare('UPDATE reviews SET status = ? WHERE id = ?').run(status, id).changes > 0;
}
function remove(id){
  return db.prepare('DELETE FROM reviews WHERE id = ?').run(id).changes > 0;
}

module.exports = { hasCompletedExam, validate, topPublic, mine, saveMine, deleteMine, listForAdmin, getById, setStatus, remove, displayName, STATUSES, TOP_LIMIT, MIN_TOP_RATING };

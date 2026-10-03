// "About Us" photos, uploaded in the admin panel and shown in the About Us section of the home page.
// Images live in the database (like everything else), so they survive redeploys as long as the
// database does. Only JPEG / PNG / WebP are accepted, checked by their actual file bytes.
const db = require('./db');

const MAX_PHOTOS = 12;
const MAX_BYTES = 1.5 * 1024 * 1024;    // per photo, after the admin page has resized it
const MAX_CAPTION = 120;
const CONTROL_RE = /[\u0000-\u001f]/;

function sniff(buf){
  if(buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if(buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if(buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function cleanCaption(v){
  if(v === undefined || v === null) return { value: '' };
  if(typeof v !== 'string') return { error: 'Caption must be text.' };
  const s = v.trim();
  if(s.length > MAX_CAPTION) return { error: 'Keep the caption under ' + MAX_CAPTION + ' characters.' };
  if(CONTROL_RE.test(s)) return { error: 'Use a single line of plain text for the caption.' };
  return { value: s };
}

function shape(r){
  return { id: r.id, caption: r.caption, mime: r.mime, bytes: r.bytes, createdAt: r.created_at, url: '/api/settings/photos/' + r.id + '?v=' + r.version };
}

function list(){
  return db.prepare('SELECT id, caption, mime, length(data) AS bytes, created_at, version FROM about_photos ORDER BY sort_order, id').all().map(shape);
}

function get(id){
  return db.prepare('SELECT id, mime, data, version FROM about_photos WHERE id = ?').get(id);
}

// image: a data URL ("data:image/jpeg;base64,...") or plain base64.
function add(image, caption){
  const errors = {};
  const cap = cleanCaption(caption);
  if(cap.error) errors.caption = cap.error;
  let buf = null, mime = null;
  if(typeof image !== 'string' || !image) errors.image = 'Choose a photo to upload.';
  else {
    const b64 = image.replace(/^data:[^;,]*;base64,/, '');
    if(!/^[A-Za-z0-9+/=\s]+$/.test(b64)) errors.image = 'That file could not be read.';
    else {
      buf = Buffer.from(b64, 'base64');
      mime = sniff(buf);
      if(!mime) errors.image = 'Only JPEG, PNG or WebP photos can be uploaded.';
      else if(buf.length > MAX_BYTES) errors.image = 'That photo is too large (max 1.5 MB).';
    }
  }
  if(Object.keys(errors).length) return { errors };
  const count = db.prepare('SELECT COUNT(*) AS n FROM about_photos').get().n;
  if(count >= MAX_PHOTOS) return { errors: { image: 'You can have up to ' + MAX_PHOTOS + ' photos. Delete one first.' } };
  const next = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM about_photos').get().n;
  const r = db.prepare('INSERT INTO about_photos (mime, data, caption, sort_order) VALUES (?, ?, ?, ?)').run(mime, buf, cap.value, next);
  return { id: Number(r.lastInsertRowid) };
}

function setCaption(id, caption){
  const cap = cleanCaption(caption);
  if(cap.error) return { errors: { caption: cap.error } };
  const r = db.prepare('UPDATE about_photos SET caption = ?, version = version + 1 WHERE id = ?').run(cap.value, id);
  return r.changes ? {} : { notFound: true };
}

// dir: -1 = earlier, +1 = later
function move(id, dir){
  const rows = db.prepare('SELECT id FROM about_photos ORDER BY sort_order, id').all().map(r => r.id);
  const i = rows.indexOf(id);
  if(i < 0) return { notFound: true };
  const j = i + (dir < 0 ? -1 : 1);
  if(j < 0 || j >= rows.length) return {};
  [rows[i], rows[j]] = [rows[j], rows[i]];
  const up = db.prepare('UPDATE about_photos SET sort_order = ? WHERE id = ?');
  db.transaction(() => rows.forEach((pid, k) => up.run(k + 1, pid)))();
  return {};
}

function remove(id){
  const r = db.prepare('DELETE FROM about_photos WHERE id = ?').run(id);
  return r.changes ? {} : { notFound: true };
}

module.exports = { list, get, add, setCaption, move, remove, MAX_PHOTOS };

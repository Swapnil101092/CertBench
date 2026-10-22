// Used by restore-db.sh: turns a backup (.db, .db.gz or base64 text) into a checked .db file.
//   node decode-backup.js <input> <output.db>
const fs = require('fs');
const zlib = require('zlib');
const { DatabaseSync } = require('node:sqlite');

const [input, output] = process.argv.slice(2);
let buf = fs.readFileSync(input);
const MAGIC = 'SQLite format 3\0';

if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
if (buf.subarray(0, 16).toString('latin1') !== MAGIC) {
  // A base64 dump. Windows PowerShell saves redirected output as UTF-16, so handle that too.
  let text = buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString('utf16le') : buf.toString('latin1');
  buf = Buffer.from(text.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
}
if (buf.subarray(0, 16).toString('latin1') !== MAGIC) {
  console.error('Not a SQLite database (or a damaged copy).');
  process.exit(1);
}
fs.writeFileSync(output, buf);

const db = new DatabaseSync(output);
const check = db.prepare('PRAGMA integrity_check').get();
if (Object.values(check)[0] !== 'ok') {
  fs.unlinkSync(output);
  console.error('Integrity check failed:', check);
  process.exit(1);
}
const count = t => { try { return db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n; } catch { return '?'; } };
console.log(`Copy looks good: ${count('users')} users, ${count('attempts')} attempts, ${count('enrollments')} enrollments.`);
db.close();

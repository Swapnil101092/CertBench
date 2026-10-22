// Nightly copy of the live database, run by cron as the certbench user (see setup.sh).
// VACUUM INTO gives a consistent snapshot while the app keeps running. Keeps the last 14.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || '/var/lib/certbench/certbench.db';
const DIR = process.env.BACKUP_DIR || '/var/backups/certbench';
const KEEP = 14;

const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
const tmp = path.join(DIR, `certbench-${stamp}.db`);

const db = new DatabaseSync(DB_PATH);
db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
db.close();
fs.writeFileSync(tmp + '.gz', zlib.gzipSync(fs.readFileSync(tmp)));
fs.unlinkSync(tmp);

const old = fs.readdirSync(DIR).filter(f => /^certbench-.*\.db\.gz$/.test(f)).sort().slice(0, -KEEP);
for (const f of old) fs.unlinkSync(path.join(DIR, f));
console.log(`${new Date().toISOString()} saved ${tmp}.gz, removed ${old.length} old`);

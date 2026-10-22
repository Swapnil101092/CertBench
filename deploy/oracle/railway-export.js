// Prints a consistent copy of the Railway database as base64 text, for moving it to Oracle.
// Run from your own computer (in Command Prompt on Windows, not PowerShell):
//
//   railway ssh -- node < deploy/oracle/railway-export.js > certbench-railway.b64
//
// Then restore it on the VM with restore-db.sh (see deploy/oracle/README.md).
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { DatabaseSync } = require('node:sqlite');

const src = process.env.DB_PATH || '/app/data/certbench.db';
const tmp = path.join(os.tmpdir(), `certbench-export-${process.pid}.db`);
const db = new DatabaseSync(src);
db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
db.close();
process.stdout.write(zlib.gzipSync(fs.readFileSync(tmp)).toString('base64') + '\n');
fs.unlinkSync(tmp);

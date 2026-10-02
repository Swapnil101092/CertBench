require('dotenv').config();
const db = require('./db');

const username = process.argv[2];
if(!username){
  console.error('Usage: node src/delete-user.js <username>');
  process.exit(1);
}

const uname = username.trim().toLowerCase();
const user = db.prepare('SELECT id, name, email, username FROM users WHERE username = ?').get(uname);

if(!user){
  console.log(`No user found with username "${username}".`);
  process.exit(0);
}

// Foreign keys are set to ON DELETE CASCADE in the schema, and this
// connection enables PRAGMA foreign_keys = ON in db.js, so deleting the
// user row also removes their OTPs, exam attempts, attempt answers, and
// enrollments automatically.
const info = db.prepare('DELETE FROM users WHERE id = ?').run(user.id);

console.log(`Deleted user: ${user.name} (${user.email}, @${user.username})`);
console.log('Their OTPs, exam attempts, and enrollments were removed too.');
console.log(`Rows affected: ${info.changes}`);

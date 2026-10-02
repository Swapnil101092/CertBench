// Grants (or revokes) admin-panel access for an existing account.
//
//   npm run make-admin -- <username>            give admin access
//   npm run make-admin -- <username> --revoke   remove admin access
//
// This is deliberately a command you run on the server, not something you can do from
// the website, so nobody can promote themselves.
require('dotenv').config();
const db = require('./db');

const args = process.argv.slice(2);
const revoke = args.includes('--revoke');
const username = (args.find(a => !a.startsWith('--')) || '').trim().toLowerCase();

if(!username){
  console.error('Usage: npm run make-admin -- <username> [--revoke]');
  process.exit(1);
}
const user = db.prepare('SELECT id, name, username, is_admin FROM users WHERE username = ?').get(username);
if(!user){
  console.error(`No account with username "${username}". Register it on the site first, then run this again.`);
  process.exit(1);
}
db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(revoke ? 0 : 1, user.id);
db.prepare('INSERT INTO admin_audit (user_id, username, action, detail) VALUES (?, ?, ?, ?)')
  .run(user.id, user.username, revoke ? 'admin.revoke' : 'admin.grant', 'via make-admin script');
console.log(revoke
  ? `Admin access removed from ${user.name} (@${user.username}).`
  : `${user.name} (@${user.username}) is now an admin. Sign in on the site, then open /admin.`);

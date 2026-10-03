// Rules for account details, shared by self-registration, password reset and the admin panel so
// all of them enforce exactly the same thing. Each check returns an error message, or null when the
// value is fine. public/app.js mirrors these rules for instant feedback; the server is the authority.

// Local part: dot-separated runs of allowed characters (so no leading, trailing or double dots).
// Domain: dot-separated labels that don't start/end with "-", ending in a 2+ letter TLD.
const EMAIL_RE = /^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;
// Words of letters joined by a single space, hyphen, apostrophe or ". " (initials like "A. B. Kumar").
const NAME_RE = /^[a-zA-Z]+(?:(?:[ '-]|\. ?)[a-zA-Z]+)*\.?$/;
// Starts with a letter, letters only, single dots/underscores allowed between letters. No digits.
const USERNAME_RE = /^[a-z]+(?:[._][a-z]+)*$/;
const USERNAME_MIN = 3, USERNAME_MAX = 20;
const PASSWORD_MIN = 8, PASSWORD_MAX = 64;
const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'superuser', 'sysadmin', 'system', 'support', 'help', 'helpdesk',
  'info', 'contact', 'billing', 'security', 'moderator', 'owner', 'staff', 'team', 'official',
  'certbench', 'api', 'www', 'mail', 'null', 'undefined', 'test', 'guest', 'anonymous'
]);

const str = (v) => (typeof v === 'string' ? v : null);

function checkName(v){
  const s = str(v); if(s === null) return 'Enter your full name.';
  const n = clean.name(s);
  if(!n) return 'Enter your full name.';
  if(n.length < 2 || n.length > 80) return 'Name must be 2-80 characters.';
  if(!NAME_RE.test(n) || n.replace(/[^a-zA-Z]/g, '').length < 2) return 'Name can only contain letters, spaces, hyphens, apostrophes and dots.';
  return null;
}
function checkEmail(v){
  const s = str(v); if(s === null) return 'Enter your email address.';
  const e = s.trim();
  if(!e) return 'Enter your email address.';
  if(e.length > 254 || e.split('@')[0].length > 64 || !EMAIL_RE.test(e)) return 'Enter a valid email address.';
  return null;
}
function checkMobile(v){
  const s = str(v); if(s === null) return 'Enter your mobile number.';
  if(!s.trim()) return 'Enter your mobile number.';
  // Only digits, spaces and an optional leading +; dashes etc are a sign of a typo.
  if(!/^\+?[\d ]+$/.test(s.trim())) return 'Mobile number can only contain digits.';
  const d = clean.mobile(s);
  if(d.length !== 10) return 'Mobile number must be exactly 10 digits.';
  if(!/^[6-9]/.test(d)) return 'Enter a valid Indian mobile number (must start with 6, 7, 8, or 9).';
  if(/^(\d)\1{9}$/.test(d)) return 'Enter a real mobile number.';
  return null;
}
function checkUsername(v){
  const s = str(v); if(s === null) return 'Choose a username.';
  const u = clean.username(s);
  if(!u) return 'Choose a username.';
  if(/\d/.test(u)) return 'Username cannot contain numbers.';
  if(u.length < USERNAME_MIN || u.length > USERNAME_MAX) return `Username must be ${USERNAME_MIN}-${USERNAME_MAX} characters.`;
  if(!/^[a-z._]+$/.test(u)) return 'Username can only contain letters, dots and underscores (no spaces or symbols).';
  if(!USERNAME_RE.test(u)) return 'Username must start and end with a letter, with no two dots/underscores in a row.';
  if(RESERVED_USERNAMES.has(u)) return 'That username is reserved. Please choose another.';
  return null;
}
// `username` is optional; when given, the password may not contain it.
function checkPassword(v, username){
  const p = str(v); if(p === null || !p) return 'Choose a password.';
  if(p.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if(p.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters.`;
  if(/\s/.test(p)) return 'Password cannot contain spaces.';
  if(!/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/[0-9]/.test(p) || !/[^a-zA-Z0-9]/.test(p)){
    return 'Password must include an uppercase letter, a lowercase letter, a number and a special character.';
  }
  const u = typeof username === 'string' ? clean.username(username) : '';
  if(u.length >= 3 && p.toLowerCase().includes(u)) return 'Password must not contain your username.';
  return null;
}
// Normalised forms, exactly as registration stores them.
const clean = {
  name: (v) => String(v).trim().replace(/\s+/g, ' '),
  email: (v) => String(v).trim().toLowerCase(),
  // Accept "+91 98xxxxxxxx", "91 98xxxxxxxx" (12 digits) and "098xxxxxxxx" (11 digits).
  mobile: (v) => {
    let d = String(v).replace(/\D/g, '');
    if(d.length === 12 && d.startsWith('91')) d = d.slice(2);
    else if(d.length === 11 && d.startsWith('0')) d = d.slice(1);
    return d;
  },
  username: (v) => String(v).trim().toLowerCase()
};

module.exports = {
  EMAIL_RE, NAME_RE, USERNAME_RE, RESERVED_USERNAMES, PASSWORD_MIN, PASSWORD_MAX, USERNAME_MIN, USERNAME_MAX,
  checkName, checkEmail, checkMobile, checkPassword, checkUsername, clean
};

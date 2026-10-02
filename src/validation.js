// Rules for account details, shared by self-registration and the admin panel so both enforce
// exactly the same thing. Each check returns an error message, or null when the value is fine.
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const NAME_RE = /^[a-zA-Z][a-zA-Z .'-]{1,79}$/;

function checkName(v){
  return NAME_RE.test(String(v || '').trim()) ? null : 'Enter a valid name (letters only, 2-80 characters).';
}
function checkEmail(v){
  const e = String(v || '').trim();
  return e.length <= 254 && EMAIL_RE.test(e) ? null : 'Enter a valid email address.';
}
function checkMobile(v){
  const digits = String(v || '').replace(/\D/g, '');
  if(digits.length !== 10) return 'Mobile number must be exactly 10 digits.';
  if(!/^[6-9]/.test(digits)) return 'Enter a valid Indian mobile number (must start with 6, 7, 8, or 9).';
  return null;
}
function checkPassword(v){
  const p = String(v || '');
  if(p.length < 6) return 'Password must be at least 6 characters.';
  if(!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) return 'Password must include at least one letter and one number.';
  return null;
}
function checkUsername(v){
  return /^[a-z0-9_.]{3,32}$/.test(String(v || '').trim().toLowerCase()) ? null : 'Username must be 3-32 characters: letters, numbers, dot or underscore.';
}
// Normalised forms, exactly as registration stores them.
const clean = {
  name: (v) => String(v).trim(),
  email: (v) => String(v).trim().toLowerCase(),
  mobile: (v) => String(v).replace(/\D/g, ''),
  username: (v) => String(v).trim().toLowerCase()
};

module.exports = { EMAIL_RE, NAME_RE, checkName, checkEmail, checkMobile, checkPassword, checkUsername, clean };

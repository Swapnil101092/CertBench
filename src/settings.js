// Site settings editable from the admin panel. Anything not saved yet falls back to the
// defaults below, so a fresh install looks exactly as it always has.
const db = require('./db');

const DEFAULT_ABOUT = [
  'CertBench is a practice platform for people preparing for IT certification exams. Every question is an original practice question written for CertBench, not a copy of real exam content, so you are practicing the concepts rather than memorizing real exam questions.',
  'Answers are graded on the server and your results are saved to your account. Correct answers are only revealed after you submit, just like a real exam.',
  'CertBench is an independent project and is not affiliated with or endorsed by Microsoft, AWS, Google, or the Cloud Native Computing Foundation.'
].join('\n\n');

const DEFAULTS = {
  promo_enabled: '1',
  promo_text: '',                    // blank = the site writes its own line from the live exam list
  about_text: DEFAULT_ABOUT,         // blank = this default
  contact_address: 'F 710, Ayaan Society, Wagholi, Pune',
  contact_phone: '+91 8421603458',
  contact_email: 'swapneeljain@gmail.com'
};

const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const PHONE_RE = /^\+?[0-9][0-9 ()-]{5,18}[0-9]$/;
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;   // everything except tab / newline / carriage return

function getRaw(){
  const out = { ...DEFAULTS };
  for(const row of db.prepare('SELECT name, value FROM settings').all()){
    if(row.name in DEFAULTS) out[row.name] = row.value;
  }
  return out;
}

// What the admin form edits (blank fields shown as blank so they can see what is custom).
function getForAdmin(){
  const r = getRaw();
  return {
    promoEnabled: r.promo_enabled === '1',
    promoText: r.promo_text,
    aboutText: r.about_text,
    contactAddress: r.contact_address,
    contactPhone: r.contact_phone,
    contactEmail: r.contact_email,
    defaults: { aboutText: DEFAULT_ABOUT }
  };
}

// What the public website reads (no login needed).
function getPublic(){
  const r = getRaw();
  const aboutSource = r.about_text.trim() ? r.about_text : DEFAULT_ABOUT;
  return {
    promo: { enabled: r.promo_enabled === '1', text: r.promo_text.trim() },
    about: aboutSource.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean),
    contact: { address: r.contact_address, phone: r.contact_phone, email: r.contact_email }
  };
}

function validate(input){
  const errors = {};
  const clean = {};
  const str = (v) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : null);

  if('promoEnabled' in input){
    if(typeof input.promoEnabled !== 'boolean') errors.promoEnabled = 'Must be on or off.';
    else clean.promo_enabled = input.promoEnabled ? '1' : '0';
  }
  if('promoText' in input){
    const v = str(input.promoText);
    if(v === null) errors.promoText = 'Must be text.';
    else if(v.length > 200) errors.promoText = 'Keep the banner message under 200 characters.';
    else if(CONTROL_RE.test(v) || v.includes('\n')) errors.promoText = 'Use a single line of plain text.';
    else clean.promo_text = v;
  }
  if('aboutText' in input){
    const v = str(input.aboutText);
    if(v === null) errors.aboutText = 'Must be text.';
    else if(v.length > 2000) errors.aboutText = 'Keep the About text under 2000 characters.';
    else if(CONTROL_RE.test(v)) errors.aboutText = 'Contains characters that are not allowed.';
    else clean.about_text = v;
  }
  if('contactAddress' in input){
    const v = str(input.contactAddress);
    if(!v || v.length < 5 || v.length > 200 || CONTROL_RE.test(v) || v.includes('\n')) errors.contactAddress = 'Enter the address on one line (5-200 characters).';
    else clean.contact_address = v;
  }
  if('contactPhone' in input){
    const v = str(input.contactPhone);
    if(!v || !PHONE_RE.test(v)) errors.contactPhone = 'Enter a valid phone number, e.g. +91 98765 43210.';
    else clean.contact_phone = v;
  }
  if('contactEmail' in input){
    const v = str(input.contactEmail);
    if(!v || v.length > 254 || !EMAIL_RE.test(v)) errors.contactEmail = 'Enter a valid email address.';
    else clean.contact_email = v;
  }
  return { errors, clean };
}

function save(clean){
  const up = db.prepare('INSERT INTO settings (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value');
  db.transaction(() => { for(const [k, v] of Object.entries(clean)) up.run(k, v); })();
}

module.exports = { getForAdmin, getPublic, validate, save, DEFAULTS };

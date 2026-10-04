(function(){

const API = '/api';

let state = {
  screen: 'loading', // loading | landing | login | register | otp | forgot | reset | select | sets | exam | results | history
  loginError: '', loginNotice: '', registerError: '', otpError: '',
  forgotError: '', forgotNotice: '', resetToken: null, resetEmail: '', resetError: '', resetOtp: null,
  token: null, currentUser: null,
  pendingToken: null, emailMasked: '', otpExpiresAt: null, otpResendAt: null,
  exams: [], examSearch: '', examCat: 'all', landingCat: 'all', landingQuery: '', landingShowAll: false, landingExams: null, siteSettings: null, topReviews: null, myReview: undefined,
  enrollBusySlug: null,
  setsExamSlug: null, setsExamMeta: null, availableSets: [],
  examMeta: null, examSetNumber: null, attemptId: null, questions: [], current: 0, answers: {},
  visitedIds: {}, skippedIds: {},
  secondsLeft: 0, timerHandle: null, otpTickHandle: null,
  results: null,
  myAttempts: [],
  busy: false
};

const root = document.getElementById('root');

function safeGetLS(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function safeSetLS(k,v){ try{ localStorage.setItem(k,v); return true; }catch(e){ return false; } }
function safeRemoveLS(k){ try{ localStorage.removeItem(k); }catch(e){} }

function fmtTime(s){
  const m = Math.floor(s/60).toString().padStart(2,'0');
  const sec = (s%60).toString().padStart(2,'0');
  return m+':'+sec;
}

async function api(path, opts){
  opts = opts || {};
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if(state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch(API + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  let data = null;
  try{ data = await res.json(); }catch(e){ data = null; }
  if(!res.ok){
    const err = new Error((data && data.error) || 'Request failed.');
    err.status = res.status;
    if(data && data.fields) err.fields = data.fields;
    throw err;
  }
  return data;
}

function el(tag, attrs, children){
  const e = document.createElement(tag);
  if(attrs){
    for(const k in attrs){
      if(k === 'class') e.className = attrs[k];
      else if(k === 'html') e.innerHTML = attrs[k];
      else if(k.startsWith('on') && typeof attrs[k]==='function') e.addEventListener(k.slice(2), attrs[k]);
      else if(attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    }
  }
  (children||[]).forEach(c=>{
    if(c==null) return;
    if(typeof c === 'string' || typeof c === 'number') e.appendChild(document.createTextNode(String(c)));
    else e.appendChild(c);
  });
  return e;
}

// Wraps a password <input> with an eye button that toggles show/hide.
const EYE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.4 10.4 0 0 1 12 19c-6.4 0-10-7-10-7a18.5 18.5 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.4 0 10 7 10 7a18.6 18.6 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';
function pwToggle(input){
  const btn = el('button',{type:'button', class:'pw-toggle', 'aria-label':'Show password', 'aria-pressed':'false', 'aria-controls':input.id, html:EYE_SVG});
  btn.addEventListener('mousedown', e=>e.preventDefault()); // keep focus/caret in the input
  btn.addEventListener('click', ()=>{
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.innerHTML = show ? EYE_OFF_SVG : EYE_SVG;
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    btn.setAttribute('aria-pressed', show ? 'true' : 'false');
  });
  return el('div',{class:'pw-wrap'},[input, btn]);
}

// ---- CertBench logo: the mark (bench + check) and the "CertBench" wordmark ----
function brandMark(){ return el('img',{class:'brand-mark', src:'/logo-mark.svg', alt:'', width:'28', height:'28'}); }
function brandWord(suffix){
  return el('span',{class:'brand-word'},[ el('strong',{},['Cert']), 'Bench', suffix ? el('span',{class:'brand-suffix'},[' ' + suffix]) : null ]);
}
function brandLogo(){ return el('div',{class:'brand', role:'img', 'aria-label':'CertBench'},[ brandMark(), brandWord() ]); }

function topbar(){
  const saved = safeGetLS('certbench-theme');
  const right = [];
  if(state.currentUser){
    const initial = (state.currentUser.name || '?').trim().charAt(0).toUpperCase();
    right.push(el('span',{class:'user-chip'},[ el('span',{class:'avatar'},[initial]), el('span',{class:'user-name'},[state.currentUser.name]) ]));
    if(state.currentUser.isAdmin && state.screen !== 'exam' && state.screen !== 'review'){
      right.push(el('a',{class:'btn-ghost btn btn-sm', href:'/admin'},['Admin']));
    }
    if(state.screen !== 'exam' && state.screen !== 'review'){
      const historyBtn = el('button',{class:'btn-ghost btn btn-sm'},['My results']);
      historyBtn.addEventListener('click', loadHistory);
      right.push(historyBtn);
    }
    const signOutBtn = el('button',{class:'btn-ghost btn btn-sm'},['Sign out']);
    signOutBtn.addEventListener('click', function(){
      if(state.screen === 'exam' || state.screen === 'review'){
        const ok = window.confirm('You’re in the middle of a timed exam. Signing out now will discard this attempt. Sign out anyway?');
        if(!ok) return;
      }
      signOut();
    });
    right.push(signOutBtn);
  }
  right.push(el('button',{class:'theme-toggle', onclick:toggleTheme},[saved==='light' ? 'Dark mode' : 'Light mode']));
  return el('div',{class:'topbar'},[
    brandLogo(),
    el('div',{class:'topbar-right'}, right)
  ]);
}
function toggleTheme(){
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  safeSetLS('certbench-theme', next);
  render();
}
(function initTheme(){
  const saved = safeGetLS('certbench-theme');
  if(saved) document.documentElement.setAttribute('data-theme', saved);
})();

/* ============ AUTH SCREENS ============ */

function renderLoading(){
  return el('div',{class:'center-notice'},['Loading…']);
}

// ---- Auth links: open sign-in / sign-up in a NEW TAB on the website. ----
// The installed app (PWA "standalone" window, iOS home-screen app, or the
// Capacitor Android wrapper) has no tabs; opening a new browser tab there
// would kick people out of the app, so in those cases we navigate in-app.
function isInstalledApp(){
  try{
    if(window.Capacitor) return true;
    if(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    if(window.navigator && window.navigator.standalone) return true;
  }catch(e){}
  return false;
}
function authLink(screen, className, children){
  const a = el('a',{class:className, href:'/#'+screen, target:'_blank', rel:'noopener'}, children);
  a.addEventListener('click', (e)=>{
    if(isInstalledApp()){
      e.preventDefault();
      state.loginError=''; state.registerError='';
      state.screen = screen;
      render();
    }
  });
  return a;
}

const LANDING_EXAMS = [
  { label: 'AZ',  short: 'Azure',        name: 'Azure Fundamentals', color: '#22c9a3' },
  { label: 'AWS', short: 'AWS',          name: 'AWS Cloud Practitioner', color: '#f7a83f' },
  { label: 'GCP', short: 'Google Cloud', name: 'Google Cloud Platform', color: '#22c9a3' },
  { label: 'K8s', short: 'Kubernetes',   name: 'Kubernetes', color: '#f7a83f' },
  { label: 'DEV', short: 'DevOps',       name: 'DevOps & CI/CD', color: '#22c9a3' },
  { label: 'QA',  short: 'QA Testing',   name: 'Software Testing & QA', color: '#f7a83f' }
];

// ---- Contact details shown in the "Contact us" section (edit them here) ----
// Fallbacks only, used until the server's settings load (or if they can't). The real values are
// edited in the admin panel and read from /api/settings/public.
const CONTACT = {
  intro: 'Questions about an exam, a payment or your account? Reach out and we will get back to you.',
  address: 'F 710, Ayaan Society, Wagholi, Pune',
  phone: '+91 8421603458',
  email: 'swapneeljain@gmail.com'
};
const DEFAULT_ABOUT = [
  'CertBench is a practice platform for people preparing for IT certification exams. Every question is an original practice question written for CertBench, not a copy of real exam content, so you are practicing the concepts rather than memorizing real exam questions.',
  'Answers are graded on the server and your results are saved to your account. Correct answers are only revealed after you submit, just like a real exam.',
  'CertBench is an independent project and is not affiliated with or endorsed by Microsoft, AWS, Google, or the Cloud Native Computing Foundation.'
];

function svgIcon(shapes){
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '22'); svg.setAttribute('height', '22');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  shapes.forEach(sh => {
    const node = document.createElementNS(ns, sh.tag);
    Object.keys(sh.attrs).forEach(k => node.setAttribute(k, sh.attrs[k]));
    svg.appendChild(node);
  });
  return svg;
}
const ICON_PIN = [
  { tag:'path',   attrs:{ d:'M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z' } },
  { tag:'circle', attrs:{ cx:'12', cy:'10', r:'2.5' } }
];
const ICON_PHONE = [
  { tag:'path', attrs:{ d:'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z' } }
];
const ICON_MAIL = [
  { tag:'rect', attrs:{ x:'2', y:'4', width:'20', height:'16', rx:'2' } },
  { tag:'path', attrs:{ d:'m22 7-10 6L2 7' } }
];
const ICON_CLOCK = [
  { tag:'circle', attrs:{ cx:'12', cy:'12', r:'9' } },
  { tag:'path',   attrs:{ d:'M12 7v5l3 2' } }
];
const ICON_GRID = [
  { tag:'rect', attrs:{ x:'3', y:'3', width:'7', height:'7', rx:'1.5' } },
  { tag:'rect', attrs:{ x:'14', y:'3', width:'7', height:'7', rx:'1.5' } },
  { tag:'rect', attrs:{ x:'3', y:'14', width:'7', height:'7', rx:'1.5' } },
  { tag:'rect', attrs:{ x:'14', y:'14', width:'7', height:'7', rx:'1.5' } }
];
const ICON_BOLT = [ { tag:'path', attrs:{ d:'M13 2 4 14h7l-1 8 9-12h-7l1-8z' } } ];
const ICON_LOCK = [
  { tag:'rect', attrs:{ x:'4', y:'11', width:'16', height:'10', rx:'2' } },
  { tag:'path', attrs:{ d:'M8 11V7a4 4 0 0 1 7.5-2' } }
];
const ICON_CHART = [
  { tag:'path', attrs:{ d:'M3 3v18h18' } },
  { tag:'path', attrs:{ d:'m7 15 4-4 3 3 5-6' } }
];
const ICON_PHONE_APP = [
  { tag:'rect', attrs:{ x:'6', y:'2', width:'12', height:'20', rx:'2.5' } },
  { tag:'path', attrs:{ d:'M11 18h2' } }
];
const ICON_SHIELD = [
  { tag:'path', attrs:{ d:'M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3z' } },
  { tag:'path', attrs:{ d:'m9 12 2 2 4-4' } }
];
const ICON_ARROW = [ { tag:'path', attrs:{ d:'M5 12h14M13 6l6 6-6 6' } } ];
const ICON_SEARCH = [
  { tag:'circle', attrs:{ cx:'11', cy:'11', r:'7' } },
  { tag:'path',   attrs:{ d:'m20 20-3.5-3.5' } }
];
const ICON_CHECK = [ { tag:'path', attrs:{ d:'m5 12 5 5L20 7' } } ];
function icon(shapes, size){
  const s = svgIcon(shapes);
  if(size){ s.setAttribute('width', size); s.setAttribute('height', size); }
  return s;
}
function contactCard(icon, title, valueNode){
  return el('div',{class:'contact-card'},[
    el('div',{class:'contact-icon'},[svgIcon(icon)]),
    el('div',{class:'contact-body'},[ el('h3',{},[title]), valueNode ])
  ]);
}

// ---- Ratings: read-only stars (★ filled, ☆ empty) ----
function starRow(rating, cls){
  const r = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return el('span',{class:'stars ' + (cls || ''), role:'img', 'aria-label': r + ' out of 5 stars'},[
    el('span',{class:'stars-on', 'aria-hidden':'true'},['★'.repeat(r)]),
    el('span',{class:'stars-off', 'aria-hidden':'true'},['★'.repeat(5 - r)])
  ]);
}
function reviewDate(s){
  const d = new Date(String(s || '').replace(' ', 'T') + 'Z');
  return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { month:'short', year:'numeric' });
}
function reviewCard(r, featured){
  const initial = (r.name || '?').trim().charAt(0).toUpperCase();
  return el('figure',{class:'review-card' + (featured ? ' featured' : '')},[
    el('div',{class:'review-top'},[
      starRow(r.rating),
      r.exam ? el('span',{class:'verified-tag'},[icon(ICON_CHECK, 13), 'Verified learner']) : null
    ]),
    el('blockquote',{class:'review-text'},[r.comment]),
    el('figcaption',{class:'review-by'},[
      el('span',{class:'avatar review-avatar', 'aria-hidden':'true'},[initial]),
      el('span',{class:'review-who'},[
        el('strong',{},[r.name]),
        el('span',{class:'review-meta'},[ r.exam ? 'Practised ' + r.exam : '', r.exam && reviewDate(r.date) ? ' · ' : '', reviewDate(r.date) ])
      ])
    ])
  ]);
}

// Home page "What learners say" section. Only real, approved reviews are shown; reviewers are
// people who finished at least one practice set, so each one gets a "Verified learner" tag.
function renderLandingReviews(){
  const tr = state.topReviews || { reviews: [], summary: { count: 0, average: null, breakdown: {} } };
  const sum = tr.summary || { count: 0 };
  const sec = el('section',{class:'landing-section', id:'reviews'},[
    el('div',{class:'section-head'},[
      el('span',{class:'eyebrow'},['Reviews']),
      el('h2',{class:'section-title'},['What learners say about CertBench']),
      el('p',{class:'section-sub'},['Ratings come only from people who finished a practice set, and every review is checked before it appears here.'])
    ])
  ]);

  if(!tr.reviews.length){
    sec.appendChild(el('div',{class:'reviews-empty'},[
      el('div',{class:'reviews-empty-stars', 'aria-hidden':'true'},['★★★★★']),
      el('h3',{},['Be among the first to rate CertBench']),
      el('p',{},['Finish any practice set and you can rate us from your results page. The best reviews will be featured right here.']),
      authLink('register','btn btn-primary',['Start practising free', icon(ICON_ARROW, 16)])
    ]));
    return sec;
  }

  // Summary panel: average, stars and a 5-to-1 breakdown.
  const b = sum.breakdown || {};
  const panel = el('aside',{class:'rating-panel', 'aria-label':'Rating summary'},[
    el('div',{class:'rating-big'},[ (sum.average || 0).toFixed(1), el('span',{},['/5']) ]),
    starRow(sum.average, 'stars-lg'),
    el('p',{class:'rating-count'},['From ' + plural(sum.count, 'verified rating')]),
    el('div',{class:'rating-bars'}, [5,4,3,2,1].map(n => {
      const c = b[n] || 0, pct = sum.count ? Math.round(c / sum.count * 100) : 0;
      return el('div',{class:'rating-bar-row', 'aria-label': n + ' stars: ' + c},[
        el('span',{class:'rating-bar-label'},[n + '★']),
        el('span',{class:'rating-bar'},[ el('i',{style:'width:' + pct + '%'}) ]),
        el('span',{class:'rating-bar-count'},[String(c)])
      ]);
    }))
  ]);

  const grid = el('div',{class:'review-grid' + (tr.reviews.length === 1 ? ' single' : '')}, tr.reviews.map((r, i) => reviewCard(r, i === 0)));
  sec.appendChild(el('div',{class:'reviews-layout'},[ panel, grid ]));
  sec.appendChild(el('p',{class:'review-cta'},[
    'Finished a practice set? ',
    authLink('login','review-cta-link',['Sign in']),
    ' and rate CertBench from your results page.'
  ]));
  return sec;
}

// ---- Landing page navigation helpers ----
function scrollToId(id){
  try{
    if(id === 'top'){ window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const node = document.getElementById(id);
    if(node && node.scrollIntoView) node.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }catch(e){}
}
function isNarrowScreen(){
  try{ return !!(window.matchMedia && window.matchMedia('(max-width: 820px)').matches); }catch(e){ return false; }
}
function closeNavDropdowns(exceptInside){
  document.querySelectorAll('.nav-dropdown.open').forEach(d=>{
    if(exceptInside && d.contains(exceptInside)) return;
    d.classList.remove('open');
    const t = d.querySelector('.nav-dd-trigger');
    if(t) t.setAttribute('aria-expanded','false');
  });
}
// Registered once: close an open dropdown on outside click or Escape.
document.addEventListener('click', (e)=> closeNavDropdowns(e.target));
document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closeNavDropdowns(null); });

// Real exam list (with real prices) comes from the public /api/exams endpoint;
// until it loads (or if it fails) we fall back to the static list without prices.
// ---- Wording that comes from the live data, so it never goes stale when exams change ----
function plural(n, word){ return n + ' ' + word + (n === 1 ? '' : 's'); }
function joinNames(names){
  if(names.length <= 1) return names.join('');
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}
function hashText(str){
  let h = 5381;
  for(let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return String(h);
}
function landingFacts(){
  const list = landingExamList();
  const src = state.landingExams && state.landingExams.length ? state.landingExams : null;
  const f = { n: list.length, names: list.map(x => x.short), setCount: 5, perSet: 30, samePerSet: true, passPct: 70, samePass: true };
  f.jee = list.filter(isJee).length;
  f.it = f.n - f.jee;
  f.catLabels = categoriesIn(list, x => x.label).map(c => c.label);
  if(src){
    f.setCount = Math.max.apply(null, src.map(x => x.set_count || 0)) || 5;
    const per = Array.from(new Set(src.map(x => x.question_count)));
    f.samePerSet = per.length === 1; f.perSet = per[0];
    const pass = Array.from(new Set(src.map(x => x.pass_pct)));
    f.samePass = pass.length === 1; f.passPct = pass[0];
  }
  return f;
}
function promoMessage(){
  const p = state.siteSettings && state.siteSettings.promo;
  if(p && p.enabled === false) return null;
  if(p && p.text) return p.text;
  const f = landingFacts();
  if(!f.n) return null;
  return '🎓 ' + plural(f.n, 'exam') + ' ready to practice — ' + joinNames(f.catLabels);
}
function heroSubText(){
  const f = landingFacts();
  const tail = 'results graded the moment you finish — so you know exactly where you stand before the exam that actually counts.';
  if(!f.n) return 'Timed mock exams with ' + tail;
  const what = f.jee && f.it ? plural(f.it, 'IT certification') + ' plus free JEE Main practice'
             : f.jee ? 'JEE Main practice' : plural(f.it, 'IT certification');
  return 'Timed mock exams for ' + what + ', ' + f.setCount + ' fresh practice sets each, and ' + tail;
}
function howStepTexts(){
  const f = landingFacts();
  const itCats = f.catLabels.filter(c => c !== 'JEE Main');
  const one = !f.n ? 'Choose the certification you are preparing for.'
    : (f.it ? 'Choose from ' + plural(f.it, 'IT certification') + ' across ' + joinNames(itCats) : 'Choose your subject')
      + (f.jee && f.it ? ', or practise for JEE Main for free.' : '.');
  const qTxt = f.samePerSet && f.perSet ? ' of ' + f.perSet + ' questions' : '';
  const passTxt = f.samePass ? ' with ' + f.passPct + '% or more' : ' (the pass mark is shown on each exam)';
  const two = 'Every exam has ' + f.setCount + ' practice sets' + qTxt + ' with a countdown timer. Pass a set' + passTxt + ' to unlock the next one.';
  return { one, two };
}
function aboutParagraphs(){
  const a = state.siteSettings && state.siteSettings.about;
  return (a && a.length) ? a : DEFAULT_ABOUT;
}
// Photos uploaded in the admin panel (Site settings -> About Us photos). Click one to see it larger.
function renderAboutPhotos(){
  const photos = (state.siteSettings && state.siteSettings.aboutPhotos) || [];
  if(!photos.length) return null;
  function open(i){
    let idx = i;
    const img = el('img',{class:'photo-lb-img', alt:''});
    const cap = el('p',{class:'photo-lb-cap'});
    function show(){ const p = photos[idx]; img.src = p.url; img.alt = p.caption || 'CertBench photo'; cap.textContent = p.caption || ''; cap.hidden = !p.caption; }
    function close(){ document.removeEventListener('keydown', onKey); box.remove(); }
    function step(d){ idx = (idx + d + photos.length) % photos.length; show(); }
    function onKey(e){ if(e.key === 'Escape') close(); else if(e.key === 'ArrowRight') step(1); else if(e.key === 'ArrowLeft') step(-1); }
    const btn = (label, cls, fn) => { const b = el('button',{class:'photo-lb-btn ' + cls, type:'button', 'aria-label':label},[cls === 'photo-lb-close' ? '×' : (cls === 'photo-lb-prev' ? '‹' : '›')]); b.addEventListener('click', e => { e.stopPropagation(); fn(); }); return b; };
    const box = el('div',{class:'photo-lb', role:'dialog', 'aria-modal':'true', 'aria-label':'Photo'},[
      el('figure',{class:'photo-lb-fig'},[img, cap]),
      btn('Close','photo-lb-close', close),
      photos.length > 1 ? btn('Previous photo','photo-lb-prev', () => step(-1)) : null,
      photos.length > 1 ? btn('Next photo','photo-lb-next', () => step(1)) : null
    ]);
    box.addEventListener('click', e => { if(e.target === box) close(); });
    img.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('keydown', onKey);
    show();
    document.body.appendChild(box);
    box.querySelector('.photo-lb-close').focus();
  }
  return el('div',{class:'about-photos' + (photos.length === 1 ? ' about-photos-one' : '')}, photos.map((p, i) => {
    const b = el('button',{class:'about-photo', type:'button', 'aria-label':'View photo' + (p.caption ? ': ' + p.caption : '')},[
      el('img',{src:p.url, alt:p.caption || '', loading:'lazy', decoding:'async'}),
      p.caption ? el('span',{class:'about-photo-cap'},[p.caption]) : null
    ]);
    b.addEventListener('click', () => open(i));
    return b;
  }));
}
function contactInfo(){
  const c = (state.siteSettings && state.siteSettings.contact) || {};
  const address = c.address || CONTACT.address;
  const phone = c.phone || CONTACT.phone;
  const email = c.email || CONTACT.email;
  // Links are built here from the plain values (never trusted as-is), so a bad value can't become a script link.
  const digits = phone.replace(/[^\d+]/g, '');
  return {
    title: c.title || 'Contact us', intro: c.intro === undefined ? CONTACT.intro : c.intro,
    address, phone, email,
    phoneHref: digits.replace(/\D/g, '').length >= 7 ? 'tel:' + digits : null,
    emailHref: /^[^\s@<>"']+@[^\s@<>"']+$/.test(email) ? 'mailto:' + email : null
  };
}

function landingExamList(){
  if(state.landingExams){   // loaded from the server (may legitimately be empty if every exam is hidden)
    return state.landingExams.map(x => {
      const known = LANDING_EXAMS.find(k => k.label === x.short_label);
      return { label:x.short_label, short: known ? known.short : x.name, name:x.name, color:x.color, price:x.price_inr_paise,
               desc:x.description || '', minutes:x.duration_minutes, sets:x.set_count, perSet:x.question_count, pass:x.pass_pct };
    });
  }
  return LANDING_EXAMS.map(x => ({ label:x.label, short:x.short, name:x.name, color:x.color, price:null, desc:'' }));
}

// ---- Exam categories: keep a long catalogue easy to scan ----
// Matched first on the exam's short label, then on keywords in its name, so a new exam added in
// the admin panel lands in a sensible group without any code change (anything unmatched goes to "More").
const EXAM_CATEGORIES = [
  { id:'cloud',      label:'Cloud',               labels:['AZ','AWS','GCP','SAA'] },
  { id:'devops',     label:'DevOps & Containers', labels:['K8S','DEV'] },
  { id:'testing',    label:'Testing & QA',        labels:['QA','CTFL'] },
  { id:'security',   label:'Security',            labels:['SEC+'] },
  { id:'management', label:'IT Management',       labels:['ITIL','PMP'] },
  { id:'jee',        label:'JEE Main',            labels:['PHY','CHEM','MATH'] },
  { id:'other',      label:'More',                labels:[] }
];
const CATEGORY_KEYWORDS = [
  ['jee', /\bjee\b|\bneet\b/i],
  ['security', /security|cissp|\bceh\b|cyber/i],
  ['management', /\bitil\b|\bpmp\b|project management|scrum|prince2/i],
  ['testing', /testing|\bqa\b|istqb|selenium|tosca/i],
  ['devops', /devops|kubernetes|docker|container|ci\/cd|terraform/i],
  ['cloud', /azure|\baws\b|google cloud|\bgcp\b|cloud/i]
];
function examCategoryId(label, name){
  const L = String(label || '').toUpperCase();
  const byLabel = EXAM_CATEGORIES.find(c => c.labels.includes(L));
  if(byLabel) return byLabel.id;
  const hit = CATEGORY_KEYWORDS.find(([, re]) => re.test(name || ''));
  return hit ? hit[0] : 'other';
}
function categoryLabel(id){ const c = EXAM_CATEGORIES.find(x => x.id === id); return c ? c.label : 'More'; }
function isJee(x){ return examCategoryId(x.label || x.short_label, x.name) === 'jee'; }
// Categories that actually have exams, in display order, with counts.
function categoriesIn(list, getLabel){
  return EXAM_CATEGORIES.map(c => ({ id:c.id, label:c.label,
    count: list.filter(x => examCategoryId(getLabel(x), x.name) === c.id).length })).filter(c => c.count > 0);
}
// A row of filter chips. `extra` adds a "Free" toggle chip when given.
function categoryChips(cats, total, active, onPick, extra){
  const row = el('div',{class:'cat-chips', role:'tablist', 'aria-label':'Filter exams by category'});
  function chip(id, text, count){
    const on = active === id;
    const b = el('button',{class:'cat-chip' + (on ? ' on' : ''), type:'button', role:'tab', 'aria-selected': on ? 'true' : 'false'},[
      text, count !== undefined ? el('span',{class:'cat-count'},[String(count)]) : null
    ]);
    b.addEventListener('click', ()=> onPick(id));
    return b;
  }
  row.appendChild(chip('all', 'All', total));
  cats.forEach(c => row.appendChild(chip(c.id, c.label, c.count)));
  if(extra && extra.freeCount) row.appendChild(chip('free', 'Free', extra.freeCount));
  return row;
}
// One shared sentence for the details every exam has in common, so the cards don't repeat it.
function commonExamFacts(list){
  const uniq = (k) => Array.from(new Set(list.map(x => x[k]).filter(v => v !== undefined && v !== null)));
  const sets = uniq('sets'), per = uniq('perSet'), mins = uniq('minutes'), pass = uniq('pass');
  const parts = [];
  if(sets.length === 1) parts.push(sets[0] + ' practice sets');
  if(per.length === 1) parts.push(per[0] + ' questions per set');
  if(mins.length === 1) parts.push(mins[0] + ' minutes per set');
  if(pass.length === 1) parts.push(pass[0] + '% to pass');
  return { text: parts.length ? 'Every exam: ' + parts.join(' · ') + '.' : '', pass: pass.length === 1 ? pass[0] : null,
           minutes: mins.length === 1 ? mins[0] : null };
}

// ---- Moving visuals: certification badges (our own badges, not the vendors' trademarked logos) ----
// Each exam keeps its own accent colour; CSS reads it from --c.
function safeColor(c){ return /^#[0-9a-fA-F]{3,8}$/.test(c || '') ? c : '#7c6cff'; }
function examBadge(x){
  return el('span',{class:'exam-chip-badge', style:`--c:${safeColor(x.color)}`},[x.label]);
}
function examListLabel(list){
  return 'Certifications you can practice: ' + list.map(x => x.name).join(', ');
}

// Landing hero: a faithful mini-preview of the real exam screen (sample question from the Azure bank).
function renderHeroMockup(){
  const f = landingFacts();
  const total = f.samePerSet && f.perSet ? f.perSet : 30;
  const stage = el('div',{class:'mock-stage', role:'img', 'aria-label':'Preview of the CertBench exam screen'});
  const win = el('div',{class:'mock-window', 'aria-hidden':'true'});
  win.appendChild(el('div',{class:'mock-chrome'},[
    el('span',{class:'mock-dot'}), el('span',{class:'mock-dot'}), el('span',{class:'mock-dot'}),
    el('span',{class:'mock-url'},['certbench · Azure Fundamentals — Set 1'])
  ]));
  const body = el('div',{class:'mock-body'});
  body.appendChild(el('div',{class:'mock-top'},[
    el('span',{class:'mock-q'},['Question 7 of ' + total]),
    el('span',{class:'mock-timer'},[el('i',{}), '42:18'])
  ]));
  body.appendChild(el('div',{class:'mock-progress'},[ el('span',{style:`width:${Math.round(7/total*100)}%`}) ]));
  body.appendChild(el('p',{class:'mock-text'},['What is the purpose of an Azure Resource Manager (ARM) template?']));
  [
    'Defining infrastructure in a JSON file for repeatable deployments',
    'Storing application secrets',
    'Hosting a virtual machine directly'
  ].forEach((t, i)=>{
    body.appendChild(el('div',{class:'mock-opt' + (i===0 ? ' on' : '')},[ el('b',{},[String.fromCharCode(65+i)]), el('span',{},[t]) ]));
  });
  const pal = el('div',{class:'mock-palette'});
  for(let i=0;i<Math.min(total,30);i++){
    pal.appendChild(el('span',{class: i===3 ? 's' : i<6 ? 'a' : i===6 ? 'c' : ''}));
  }
  body.appendChild(pal);
  win.appendChild(body);
  stage.appendChild(win);
  stage.appendChild(el('div',{class:'mock-float mock-float-score', 'aria-hidden':'true'},[
    el('div',{class:'mini-ring'},[ el('span',{},['86%']) ]),
    el('div',{},[ el('div',{class:'mock-float-title'},['Sample result']), el('div',{class:'mock-float-sub'},['Set 1 · Pass']) ])
  ]));
  stage.appendChild(el('div',{class:'mock-float mock-float-graded', 'aria-hidden':'true'},[
    el('span',{class:'mock-float-icon'},[icon(ICON_BOLT, 16)]), 'Graded the moment you submit'
  ]));
  return stage;
}

// Sign-in / sign-up side panel: the same badges as a smooth, endlessly looping ticker.
function renderExamMarquee(){
  const list = landingExamList();
  function group(hidden){
    const g = el('div',{class:'marquee-group'}, list.map(x =>
      el('div',{class:'marquee-chip'},[ examBadge(x), el('span',{},[x.short]) ])
    ));
    if(hidden) g.setAttribute('aria-hidden','true');   // the second copy only exists to make the loop seamless
    return g;
  }
  return el('div',{class:'auth-marquee', role:'img', 'aria-label': examListLabel(list)},[
    el('div',{class:'auth-marquee-track'},[ group(false), group(true) ])
  ]);
}
function priceLabel(paise){
  if(paise === null || paise === undefined) return '';
  return paise > 0 ? formatRupees(paise) : 'Free';
}
async function loadLandingExams(){
  const results = await Promise.allSettled([ api('/exams'), api('/settings/public'), api('/reviews/top') ]);
  let changed = false;
  if(results[0].status === 'fulfilled'){ state.landingExams = results[0].value.exams; changed = true; }
  if(results[1].status === 'fulfilled'){ state.siteSettings = results[1].value; changed = true; }
  if(results[2].status === 'fulfilled'){ state.topReviews = results[2].value; changed = true; }
  if(!changed) return;               // server unreachable: keep the built-in fallbacks
  if(state.screen === 'landing'){
    render();
  }else{
    // Sign-in / sign-up pages: swap just the side panel in place. A full re-render here would
    // wipe whatever the person has already typed into the form.
    const panel = document.querySelector('.auth-visual-col');
    if(panel) panel.replaceWith(renderAuthVisual());
  }
}

function renderLanding(){
  const wrap = el('div',{class:'landing-wrap'});

  // ---- dismissible promo bar (persisted per message, so a NEW message shows again) ----
  const promoText = promoMessage();
  if(promoText && safeGetLS('certbench-promo-dismissed') !== hashText(promoText)){
    const promo = el('div',{class:'promo-bar'},[ el('span',{},[promoText]) ]);
    const closeBtn = el('button',{class:'promo-close', type:'button', 'aria-label':'Dismiss'},['×']);
    closeBtn.addEventListener('click', ()=>{
      safeSetLS('certbench-promo-dismissed', hashText(promoText));
      render();
    });
    promo.appendChild(closeBtn);
    wrap.appendChild(promo);
  }

  // ---- header: brand | nav | sign-in / register ----
  const navExams = landingExamList();
  const ddTrigger = el('button',{class:'nav-link nav-dd-trigger', type:'button', 'aria-haspopup':'true', 'aria-expanded':'false'},[
    'Exams ', el('span',{class:'nav-caret'},['▾'])
  ]);
  const ddMenu = el('div',{class:'nav-dropdown-menu'});
  ddMenu.appendChild(el('div',{class:'nav-dd-title'},['Practice exams']));
  const ddCats = categoriesIn(navExams, x => x.label);
  ddCats.forEach(c=>{
    if(ddCats.length > 1) ddMenu.appendChild(el('div',{class:'nav-dd-group'},[c.label]));
    navExams.filter(x => examCategoryId(x.label, x.name) === c.id).forEach(x=>{
      ddMenu.appendChild(authLink('register','nav-dd-item',[
        examBadge(x),
        el('span',{class:'nav-dd-name'},[x.name]),
        el('span',{class:'nav-dd-price'},[priceLabel(x.price)])
      ]));
    });
  });
  if(!navExams.length) ddMenu.appendChild(el('div',{class:'nav-dd-foot'},['No certificates are available yet.']));
  ddMenu.appendChild(el('div',{class:'nav-dd-foot'},['Create a free account to get started']));
  const dd = el('div',{class:'nav-dropdown'},[ddTrigger, ddMenu]);
  // Picking an exam opens sign-up in a new tab; close the menu here so it isn't left hanging open.
  ddMenu.addEventListener('click', (e)=>{
    if(e.target.closest && e.target.closest('.nav-dd-item')){
      dd.classList.remove('open'); ddTrigger.setAttribute('aria-expanded','false');
    }
  });
  ddTrigger.addEventListener('click', ()=>{
    if(isNarrowScreen()){ scrollToId('exams'); return; }  // no room for a dropdown on phones
    const open = dd.classList.toggle('open');
    ddTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  function navButton(label, id){
    const b = el('button',{class:'nav-link', type:'button'},[label]);
    b.addEventListener('click', ()=> scrollToId(id));
    return b;
  }
  const nav = el('nav',{class:'landing-nav', 'aria-label':'Main'},[
    navButton('Home','top'), dd, navButton('Features','features'), navButton('How it works','how'), navButton('Reviews','reviews'), navButton('About Us','about'), navButton('Contact','contact')
  ]);

  const headerActions = el('div',{class:'landing-header-actions'},[
    authLink('login','pill-btn pill-signin',['Sign in']),
    authLink('register','pill-btn pill-register',['Register'])
  ]);
  const header = el('div',{class:'landing-header'},[
    brandLogo(),
    nav,
    headerActions
  ]);
  wrap.appendChild(header);

  // ---- hero ----
  const facts = landingFacts();
  const hero = el('section',{class:'landing-hero'});
  hero.appendChild(el('div',{class:'hero-bg', 'aria-hidden':'true'},[ el('div',{class:'hero-grid'}), el('div',{class:'hero-glow g1'}), el('div',{class:'hero-glow g2'}) ]));
  const heroInner = el('div',{class:'hero-inner'});
  const heroCopy = el('div',{class:'hero-copy'},[
    el('div',{class:'hero-badge'},[ el('span',{class:'hero-badge-dot'}), 'Practice before the real exam' ]),
    el('h1',{class:'hero-title'},[
      'Walk into your certification exam ',
      el('span',{class:'hero-highlight'},['already knowing you’ll pass']),
      '.'
    ]),
    el('p',{class:'hero-sub'},[ heroSubText() ])
  ]);
  const heroCtas = el('div',{class:'hero-ctas'});
  heroCtas.appendChild(authLink('register', 'btn btn-primary hero-btn', ['Get started free', icon(ICON_ARROW, 18)]));
  heroCtas.appendChild(authLink('login', 'btn btn-ghost hero-btn', ['I already have an account']));
  heroCopy.appendChild(heroCtas);
  const hasFree = navExams.some(x => x.price === 0);
  heroCopy.appendChild(el('ul',{class:'hero-trust'},[
    el('li',{},[icon(ICON_CHECK, 16), 'Server-graded results']),
    el('li',{},[icon(ICON_CHECK, 16), facts.setCount + ' practice sets per exam']),
    hasFree ? el('li',{},[icon(ICON_CHECK, 16), 'Free exam to try']) : el('li',{},[icon(ICON_CHECK, 16), 'Works on your phone'])
  ]));
  heroInner.appendChild(heroCopy);
  heroInner.appendChild(el('div',{class:'hero-visual'},[ renderHeroMockup() ]));
  hero.appendChild(heroInner);
  wrap.appendChild(hero);

  // ---- stats strip: every number comes from the live exam data ----
  function stat(v, label){ return el('div',{class:'stat'},[ el('b',{},[String(v)]), el('span',{},[label]) ]); }
  wrap.appendChild(el('section',{class:'stats-strip'},[
    stat(facts.n || '—', facts.n === 1 ? 'Exam' : 'Exams'),
    stat(facts.setCount, 'Practice sets each'),
    facts.samePerSet && facts.perSet ? stat(facts.perSet, 'Questions per set') : stat('Timed', 'Like the real exam'),
    facts.samePass ? stat(facts.passPct + '%', 'Pass mark') : stat('Instant', 'Results')
  ]));

  // ---- exams: real exams, real prices ----
  // IT certifications get category tabs, a search box and a short "featured" list; JEE has its own section.
  const itExams = navExams.filter(x => !isJee(x));
  const jeeExams = navExams.filter(isJee);
  const FEATURED = 6;

  function landingCard(x, commonPass){
    const showPass = x.pass && x.pass !== commonPass;
    const card = authLink('register','exam-card',[
      el('div',{class:'exam-card-top'},[
        el('span',{class:'exam-card-badge', style:`--c:${safeColor(x.color)}`},[x.label]),
        x.price !== null ? el('span',{class:'exam-card-price' + (x.price === 0 ? ' free' : '')},[priceLabel(x.price)]) : null
      ]),
      el('h3',{},[x.name]),
      x.desc ? el('p',{},[x.desc]) : null,
      showPass ? el('div',{class:'exam-card-meta'},[ el('span',{},[x.pass + '% to pass']) ]) : null,
      el('span',{class:'exam-card-cta'},['Start practicing', icon(ICON_ARROW, 16)])
    ]);
    card.style.setProperty('--c', safeColor(x.color));
    return card;
  }

  const itFacts = commonExamFacts(itExams);
  const examsSec = el('section',{class:'landing-section', id:'exams'},[
    el('div',{class:'section-head'},[
      el('span',{class:'eyebrow'},['Certifications']),
      el('h2',{class:'section-title'},['Pick the exam you’re preparing for']),
      el('p',{class:'section-sub'},['Each track has its own question bank, split into practice sets you unlock one after another. ' + itFacts.text])
    ])
  ]);

  const itCats = categoriesIn(itExams, x => x.label);
  const freeCount = itExams.filter(x => x.price === 0).length;
  const toolbar = el('div',{class:'exam-toolbar'});
  const chipsHolder = el('div',{});
  const landingSearch = el('div',{class:'search-wrap exam-search'},[ el('span',{class:'search-icon'},[icon(ICON_SEARCH, 18)]) ]);
  const landingInput = el('input',{ type:'search', class:'search-input', placeholder:'Search exams, e.g. AWS, ISTQB, PMP…',
    'aria-label':'Search exams', value: state.landingQuery || '' });
  landingSearch.appendChild(landingInput);
  toolbar.appendChild(chipsHolder);
  toolbar.appendChild(landingSearch);
  if(itExams.length > FEATURED) examsSec.appendChild(toolbar);

  const examGrid = el('div',{class:'exam-grid'});
  const moreHolder = el('div',{class:'exam-more'});
  examsSec.appendChild(examGrid);
  examsSec.appendChild(moreHolder);

  function drawLandingExams(){
    chipsHolder.innerHTML = '';
    chipsHolder.appendChild(categoryChips(itCats, itExams.length, state.landingCat, (id)=>{
      state.landingCat = id; state.landingShowAll = false; drawLandingExams();
    }, { freeCount }));

    const q = (state.landingQuery || '').trim().toLowerCase();
    let list = itExams;
    if(state.landingCat === 'free') list = list.filter(x => x.price === 0);
    else if(state.landingCat !== 'all') list = list.filter(x => examCategoryId(x.label, x.name) === state.landingCat);
    if(q) list = list.filter(x => (x.name + ' ' + x.label + ' ' + x.desc + ' ' + categoryLabel(examCategoryId(x.label, x.name))).toLowerCase().includes(q));

    const browsing = state.landingCat === 'all' && !q;
    const shown = browsing && !state.landingShowAll ? list.slice(0, FEATURED) : list;

    examGrid.innerHTML = '';
    shown.forEach(x => examGrid.appendChild(landingCard(x, itFacts.pass)));
    if(!itExams.length) examGrid.appendChild(el('p',{class:'no-results'},['New exams are coming soon.']));
    else if(!list.length) examGrid.appendChild(el('p',{class:'no-results'},[q ? `No exams match "${state.landingQuery}".` : 'No exams in this category yet.']));

    moreHolder.innerHTML = '';
    if(browsing && list.length > FEATURED){
      const btn = el('button',{class:'btn btn-ghost exam-more-btn', type:'button'},[
        state.landingShowAll ? 'Show fewer' : 'View all ' + list.length + ' certifications'
      ]);
      btn.addEventListener('click', ()=>{
        const wasAll = state.landingShowAll;
        state.landingShowAll = !wasAll; drawLandingExams();
        if(wasAll) scrollToId('exams');
      });
      moreHolder.appendChild(btn);
    }
  }
  landingInput.addEventListener('input', function(){
    state.landingQuery = this.value;
    if(this.value.trim()) state.landingCat = 'all';   // search across every category
    drawLandingExams();
  });
  drawLandingExams();
  wrap.appendChild(examsSec);

  // ---- JEE Main: a different audience, so it gets its own short section ----
  if(jeeExams.length){
    const jeeFacts = commonExamFacts(jeeExams);
    const allFree = jeeExams.every(x => x.price === 0);
    const jeeSec = el('section',{class:'landing-section', id:'jee'},[
      el('div',{class:'section-head'},[
        el('span',{class:'eyebrow'},['JEE Main']),
        el('h2',{class:'section-title'},[allFree ? 'Free JEE Main practice' : 'JEE Main practice']),
        el('p',{class:'section-sub'},['Original JEE Main-style questions, subject by subject, weighted to the chapters asked most often. ' + jeeFacts.text])
      ])
    ]);
    const jeeGrid = el('div',{class:'exam-grid'});
    jeeExams.forEach(x => jeeGrid.appendChild(landingCard(x, jeeFacts.pass)));
    jeeSec.appendChild(jeeGrid);
    wrap.appendChild(jeeSec);
  }

  // ---- features bento: every statement here is true of the actual app ----
  function feature(ic, title, text, cls){
    return el('div',{class:'feature' + (cls ? ' ' + cls : '')},[
      el('div',{class:'feature-icon'},[icon(ic, 20)]),
      el('h3',{},[title]),
      el('p',{},[text])
    ]);
  }
  wrap.appendChild(el('section',{class:'landing-section', id:'features'},[
    el('div',{class:'section-head'},[
      el('span',{class:'eyebrow'},['Why CertBench']),
      el('h2',{class:'section-title'},['Built to feel like exam day']),
      el('p',{class:'section-sub'},['A focused practice environment that shows you exactly where you stand.'])
    ]),
    el('div',{class:'bento'},[
      feature(ICON_CLOCK, 'A real countdown', 'Every set runs against the clock, and is submitted automatically when time runs out, just like the real thing.', 'span-2'),
      feature(ICON_GRID, 'Question palette', 'Jump to any question and see at a glance what you have answered, skipped or not yet visited.'),
      feature(ICON_BOLT, 'Instant, trustworthy grading', 'Answers are checked on the server, and you get your score with a full answer breakdown the moment you submit.'),
      feature(ICON_LOCK, 'Unlock as you improve', 'Pass a set to unlock the next one, so you build up from the basics instead of guessing.'),
      feature(ICON_CHART, 'Track your progress', 'Every attempt is saved under My results with your score, date and pass or fail.'),
      feature(ICON_PHONE_APP, 'Practice anywhere', 'Works on your phone and can be installed like an app from your browser.', 'span-2')
    ])
  ]));

  // ---- how it works ----
  function howStep(n, title, text){
    return el('div',{class:'how-step'},[
      el('div',{class:'how-num'},[String(n)]),
      el('h3',{},[title]),
      el('p',{},[text])
    ]);
  }
  const howTexts = howStepTexts();
  wrap.appendChild(el('section',{class:'landing-section', id:'how'},[
    el('div',{class:'section-head'},[
      el('span',{class:'eyebrow'},['How it works']),
      el('h2',{class:'section-title'},['From sign-up to exam-ready in three steps'])
    ]),
    el('div',{class:'how-grid'},[
      howStep(1, 'Pick a certification', howTexts.one),
      howStep(2, 'Take timed practice sets', howTexts.two),
      howStep(3, 'Review and improve', 'Get your score and a full answer breakdown the moment you submit, and track every attempt under My results.')
    ])
  ]));

  // ---- ratings & reviews (top 5 approved 4-5 star reviews, moderated in the admin panel) ----
  wrap.appendChild(renderLandingReviews());

  // ---- about + contact us (both edited in the admin panel under Site settings) ----
  const ci = contactInfo();
  wrap.appendChild(el('section',{class:'landing-section', id:'about'},[
    el('div',{class:'about-wrap'},[
      el('div',{class:'about-main'},[
        el('div',{class:'section-head'},[
          el('span',{class:'eyebrow'},['About Us']),
          el('h2',{class:'section-title'},['About Us'])
        ]),
        el('div',{class:'about-copy'}, aboutParagraphs().map(t => el('p',{},[t]))),
        renderAboutPhotos()
      ]),
      el('aside',{class:'contact-panel', id:'contact', 'aria-labelledby':'contact-title'},[
        el('h3',{class:'contact-panel-title', id:'contact-title'},[ci.title]),
        ci.intro ? el('p',{class:'contact-panel-intro'},[ci.intro]) : null,
        el('div',{class:'contact-list'},[
          contactCard(ICON_PIN,   'Address',        el('p',{},[ci.address])),
          contactCard(ICON_PHONE, 'Phone',          ci.phoneHref ? el('a',{href:ci.phoneHref},[ci.phone]) : el('p',{},[ci.phone])),
          contactCard(ICON_MAIL,  'E-mail Address', ci.emailHref ? el('a',{href:ci.emailHref},[ci.email]) : el('p',{},[ci.email]))
        ])
      ])
    ])
  ]));

  // ---- CTA band ----
  wrap.appendChild(el('section',{class:'cta-band-wrap'},[
    el('div',{class:'cta-band'},[
      el('div',{},[
        el('h2',{},['Ready to find out where you stand?']),
        el('p',{},['Create a free account and start your first practice set in minutes.'])
      ]),
      authLink('register','btn btn-light hero-btn',['Create free account', icon(ICON_ARROW, 18)])
    ])
  ]));

  // ---- footer ----
  function footLink(label, id){
    const b = el('button',{class:'foot-link', type:'button'},[label]);
    b.addEventListener('click', ()=> scrollToId(id));
    return b;
  }
  wrap.appendChild(el('footer',{class:'site-foot'},[
    el('div',{class:'site-foot-inner'},[
      el('div',{class:'site-foot-brand'},[
        brandLogo(),
        el('p',{},['Timed mock exams for IT certifications. Practice, review, and walk in ready.'])
      ]),
      el('div',{class:'site-foot-links'},[
        footLink('Exams','exams'), footLink('Features','features'), footLink('How it works','how'),
        footLink('Reviews','reviews'), footLink('About Us','about'), footLink('Contact','contact'),
        authLink('login','foot-link',['Sign in'])
      ])
    ]),
    el('div',{class:'site-foot-legal'},['© ' + new Date().getFullYear() + ' CertBench. Practice mock exams. Not affiliated with Microsoft, AWS, Google, or the Cloud Native Computing Foundation.'])
  ]));

  return wrap;
}

function renderAuthVisual(){
  const panel = el('div',{class:'auth-visual-col'});
  panel.appendChild(el('div',{class:'auth-visual-brand'},[
    brandMark(), brandWord()
  ]));
  panel.appendChild(el('div',{class:'auth-visual-glow', 'aria-hidden':'true'}));
  panel.appendChild(el('div',{class:'auth-visual-tagline'},['Practice mock exams. ', el('span',{},['Walk in ready.'])]));
  panel.appendChild(el('div',{class:'auth-visual-features'},[
    landingFacts().n ? el('div',{},[plural(landingFacts().n, 'exam') + ' to practice']) : null,
    el('div',{},[landingFacts().setCount + ' fresh practice sets per exam']),
    el('div',{},['Timed, server-graded results'])
  ]));
  panel.appendChild(renderExamMarquee());
  return panel;
}

function renderLogin(){
  const wrap = el('div',{class:'login-wrap'});
  const formCol = el('div',{class:'auth-form-col'});
  const card = el('div',{class:'login-card'},[
    el('div',{class:'login-eyebrow'},['Sign in']),
    el('h1',{},['Welcome to CertBench']),
    el('p',{class:'sub'},['Practice timed mock exams for cloud and platform certifications. Sign in to begin.']),
  ]);

  const form = el('div',{});
  const userField = el('div',{class:'field'},[ el('label',{for:'username'},['Username']), el('input',{id:'username', autocomplete:'username', type:'text'}) ]);
  const passField = el('div',{class:'field'},[ el('label',{for:'password'},['Password']), pwToggle(el('input',{id:'password', autocomplete:'current-password', type:'password'})) ]);
  const noticeDiv = state.loginNotice ? el('div',{class:'login-notice'},[state.loginNotice]) : null;
  const errorDiv = el('div',{class:'login-error'},[state.loginError]);
  const submitBtn = el('button',{class:'btn btn-primary', type:'button'},[state.busy ? 'Signing in…' : 'Sign in']);
  if(state.busy) submitBtn.setAttribute('disabled','disabled');

  form.appendChild(userField);
  form.appendChild(passField);
  if(noticeDiv) form.appendChild(noticeDiv);
  form.appendChild(errorDiv);
  form.appendChild(submitBtn);

  async function attemptLogin(){
    if(state.busy) return;
    const u = document.getElementById('username').value.trim();
    const p = document.getElementById('password').value;
    if(!u || !p){ state.loginError = 'Enter your username and password.'; render(); return; }
    state.busy = true; state.loginError = ''; state.loginNotice = ''; render();
    try{
      const data = await api('/auth/login', { method:'POST', body:{ username:u, password:p } });
      state.busy = false;
      state.pendingToken = data.pendingToken;
      state.emailMasked = data.emailMasked;
      state.otpExpiresAt = Date.now() + data.expiresInSeconds*1000;
      state.otpResendAt = Date.now() + 30*1000;
      state.otpError = '';
      state.devOtp = data.devOtp || null;
      state.screen = 'otp';
      render();
    }catch(err){
      state.busy = false;
      state.loginError = err.message || 'Sign in failed.';
      render();
    }
  }

  submitBtn.addEventListener('click', attemptLogin);
  [userField, passField].forEach(f=>{
    f.querySelector('input').addEventListener('keydown', e=>{ if(e.key==='Enter') attemptLogin(); });
  });

  card.appendChild(form);

  const forgotRow = el('p',{class:'auth-switch'},[]);
  const forgotLink = el('button',{class:'link-btn', type:'button'},['Forgot password?']);
  forgotLink.addEventListener('click', ()=>{ state.forgotError=''; state.forgotNotice=''; state.screen='forgot'; render(); });
  forgotRow.appendChild(forgotLink);
  card.appendChild(forgotRow);

  const switchRow = el('p',{class:'auth-switch'},['New here? ']);
  const switchLink = el('button',{class:'link-btn', type:'button'},['Create an account']);
  switchLink.addEventListener('click', ()=>{ state.registerError=''; state.loginError=''; state.screen='register'; render(); });
  switchRow.appendChild(switchLink);
  card.appendChild(switchRow);

  formCol.appendChild(card);
  wrap.appendChild(formCol);
  wrap.appendChild(renderAuthVisual());
  return wrap;
}

// ---- Registration rules: mirror src/validation.js (the server re-checks everything). ----
const REG_RULES = (function(){
  const EMAIL_RE = /^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;
  const NAME_RE = /^[a-zA-Z]+(?:(?:[ '-]|\. ?)[a-zA-Z]+)*\.?$/;
  const USERNAME_RE = /^[a-z]+(?:[._][a-z]+)*$/;
  const RESERVED = ['admin','administrator','root','superuser','sysadmin','system','support','help','helpdesk',
    'info','contact','billing','security','moderator','owner','staff','team','official',
    'certbench','api','www','mail','null','undefined','test','guest','anonymous'];
  const cleanName = (v) => v.trim().replace(/\s+/g, ' ');
  const cleanMobile = (v) => {
    let d = v.replace(/\D/g, '');
    if(d.length === 12 && d.startsWith('91')) d = d.slice(2);
    else if(d.length === 11 && d.startsWith('0')) d = d.slice(1);
    return d;
  };
  const pwChecks = [
    { id:'len',   label:'8-64 characters',            test:(p)=>p.length >= 8 && p.length <= 64 },
    { id:'upper', label:'An uppercase letter',        test:(p)=>/[A-Z]/.test(p) },
    { id:'lower', label:'A lowercase letter',         test:(p)=>/[a-z]/.test(p) },
    { id:'digit', label:'A number',                   test:(p)=>/[0-9]/.test(p) },
    { id:'special', label:'A special character (e.g. @ # $ !)', test:(p)=>/[^a-zA-Z0-9\s]/.test(p) },
    { id:'space', label:'No spaces',                  test:(p)=>p.length > 0 && !/\s/.test(p) }
  ];
  return {
    pwChecks, cleanName, cleanMobile,
    name(v){
      const n = cleanName(v);
      if(!n) return 'Enter your full name.';
      if(n.length < 2 || n.length > 80) return 'Name must be 2-80 characters.';
      if(!NAME_RE.test(n) || n.replace(/[^a-zA-Z]/g, '').length < 2) return 'Name can only contain letters, spaces, hyphens, apostrophes and dots.';
      return null;
    },
    email(v){
      const e = v.trim();
      if(!e) return 'Enter your email address.';
      if(e.length > 254 || e.split('@')[0].length > 64 || !EMAIL_RE.test(e)) return 'Enter a valid email address.';
      return null;
    },
    mobile(v){
      if(!v.trim()) return 'Enter your mobile number.';
      if(!/^\+?[\d ]+$/.test(v.trim())) return 'Mobile number can only contain digits.';
      const d = cleanMobile(v);
      if(d.length !== 10) return 'Mobile number must be exactly 10 digits.';
      if(!/^[6-9]/.test(d)) return 'Enter a valid Indian mobile number (must start with 6, 7, 8, or 9).';
      if(/^(\d)\1{9}$/.test(d)) return 'Enter a real mobile number.';
      return null;
    },
    username(v){
      const u = v.trim().toLowerCase();
      if(!u) return 'Choose a username.';
      if(/\d/.test(u)) return 'Username cannot contain numbers.';
      if(u.length < 3 || u.length > 20) return 'Username must be 3-20 characters.';
      if(!/^[a-z._]+$/.test(u)) return 'Username can only contain letters, dots and underscores (no spaces or symbols).';
      if(!USERNAME_RE.test(u)) return 'Username must start and end with a letter, with no two dots/underscores in a row.';
      if(RESERVED.indexOf(u) !== -1) return 'That username is reserved. Please choose another.';
      return null;
    },
    password(p, username){
      if(!p) return 'Choose a password.';
      if(p.length < 8) return 'Password must be at least 8 characters.';
      if(p.length > 64) return 'Password must be at most 64 characters.';
      if(/\s/.test(p)) return 'Password cannot contain spaces.';
      if(!/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/[0-9]/.test(p) || !/[^a-zA-Z0-9]/.test(p)) return 'Password must include an uppercase letter, a lowercase letter, a number and a special character.';
      const u = (username || '').trim().toLowerCase();
      if(u.length >= 3 && p.toLowerCase().indexOf(u) !== -1) return 'Password must not contain your username.';
      return null;
    }
  };
})();

function renderRegister(){
  const wrap = el('div',{class:'login-wrap'});
  const formCol = el('div',{class:'auth-form-col'});
  const card = el('div',{class:'login-card'},[
    el('div',{class:'login-eyebrow'},['Create account']),
    el('h1',{},['Register for CertBench']),
    el('p',{class:'sub'},["We’ll email a one-time code to this address each time you sign in."]),
  ]);

  // Typed values and per-field errors live in state so a re-render (e.g. after a server error)
  // never wipes what the user entered. Passwords are kept only in memory, never stored.
  if(!state.regDraft) state.regDraft = { values:{}, errors:{}, touched:{} };
  const draft = state.regDraft;

  const FIELDS = [
    { key:'name',     id:'reg-name',     label:'Full name',           type:'text',     auto:'name',         max:'80',  hint:'Letters, spaces, hyphens, apostrophes and dots.' },
    { key:'email',    id:'reg-email',    label:'Email address',       type:'email',    auto:'email',        max:'254' },
    { key:'mobile',   id:'reg-mobile',   label:'Mobile number (10 digits)', type:'tel', auto:'tel',         max:'10',  hint:'Indian mobile number starting with 6, 7, 8 or 9.' },
    { key:'username', id:'reg-username', label:'Choose a username',   type:'text',     auto:'username',     max:'20',  hint:'3-20 letters. Dots or underscores allowed between letters. No numbers or spaces.' },
    { key:'password', id:'reg-password', label:'Choose a password',   type:'password', auto:'new-password', max:'64' },
    { key:'confirm',  id:'reg-confirm',  label:'Confirm password',    type:'password', auto:'new-password', max:'64' }
  ];

  const form = el('form',{novalidate:'novalidate'});
  const inputs = {}, errEls = {};
  FIELDS.forEach(f=>{
    const errId = f.id + '-error', hintId = f.id + '-hint';
    const input = el('input',{id:f.id, name:f.key, type:f.type, autocomplete:f.auto, maxlength:f.max,
      'aria-describedby': (f.hint ? hintId + ' ' : '') + errId});
    input.value = draft.values[f.key] || '';
    if(f.key === 'username') input.setAttribute('autocapitalize', 'none');
    if(f.key === 'username') input.setAttribute('spellcheck', 'false');
    const errEl = el('div',{class:'field-error', id:errId, role:'alert'},[]);
    inputs[f.key] = input; errEls[f.key] = errEl;
    form.appendChild(el('div',{class:'field', 'data-field':f.key},[
      el('label',{for:f.id},[f.label]), f.type === 'password' ? pwToggle(input) : input,
      f.hint ? el('div',{class:'field-hint', id:hintId},[f.hint]) : null,
      f.key === 'password' ? pwChecklist() : null,
      errEl
    ]));
  });

  function pwChecklist(){
    return el('ul',{class:'pw-checklist', id:'reg-password-checklist', 'aria-label':'Password requirements'},
      REG_RULES.pwChecks.map(c=>el('li',{'data-check':c.id},[c.label])));
  }
  function updateChecklist(){
    const p = inputs.password.value;
    REG_RULES.pwChecks.forEach(c=>{
      const li = form.querySelector('.pw-checklist li[data-check="' + c.id + '"]');
      if(li) li.classList.toggle('ok', c.test(p));
    });
  }

  // Restrict the mobile field to digits only, capped at 10, as the user types.
  inputs.mobile.setAttribute('inputmode', 'numeric');

  function validateField(key){
    const v = inputs[key].value;
    switch(key){
      case 'name': return REG_RULES.name(v);
      case 'email': return REG_RULES.email(v);
      case 'mobile': return REG_RULES.mobile(v);
      case 'username': return REG_RULES.username(v);
      case 'password': return REG_RULES.password(v, inputs.username.value);
      case 'confirm':
        if(!v) return 'Confirm your password.';
        return v === inputs.password.value ? null : 'Passwords do not match.';
    }
    return null;
  }
  function showError(key, msg){
    draft.errors[key] = msg || '';
    errEls[key].textContent = msg || '';
    inputs[key].setAttribute('aria-invalid', msg ? 'true' : 'false');
    inputs[key].closest('.field').classList.toggle('has-error', !!msg);
  }

  FIELDS.forEach(f=>{
    const input = inputs[f.key];
    input.addEventListener('input', ()=>{
      if(f.key === 'mobile') input.value = input.value.replace(/\D/g, '').slice(0, 10);
      draft.values[f.key] = input.value;
      if(f.key === 'password') updateChecklist();
      // Once a field has been left, re-check it live so the error clears as soon as it's fixed.
      if(draft.touched[f.key]) showError(f.key, validateField(f.key));
      if(f.key === 'password' && draft.touched.confirm) showError('confirm', validateField('confirm'));
      if(f.key === 'username' && draft.touched.password) showError('password', validateField('password'));
    });
    input.addEventListener('blur', ()=>{
      if(!input.value && !draft.touched[f.key]) return; // don't nag on an untouched empty field
      draft.touched[f.key] = true;
      showError(f.key, validateField(f.key));
    });
    // Restore errors from the previous render.
    if(draft.errors[f.key]) showError(f.key, draft.errors[f.key]);
  });
  updateChecklist();

  const errorDiv = el('div',{class:'login-error', id:'reg-form-error', role:'alert'},[state.registerError]);
  form.appendChild(errorDiv);
  const submitBtn = el('button',{class:'btn btn-primary', type:'submit'},[state.busy ? 'Creating…' : 'Create account']);
  if(state.busy) submitBtn.setAttribute('disabled','disabled');
  form.appendChild(submitBtn);

  form.addEventListener('submit', async (ev)=>{
    ev.preventDefault();
    if(state.busy) return;
    let firstBad = null;
    FIELDS.forEach(f=>{
      draft.touched[f.key] = true;
      const msg = validateField(f.key);
      showError(f.key, msg);
      if(msg && !firstBad) firstBad = f.key;
    });
    if(firstBad){
      state.registerError = 'Please fix the highlighted fields.';
      errorDiv.textContent = state.registerError;
      inputs[firstBad].focus();
      return;
    }
    const body = {
      name: REG_RULES.cleanName(inputs.name.value),
      email: inputs.email.value.trim(),
      mobile: REG_RULES.cleanMobile(inputs.mobile.value),
      username: inputs.username.value.trim().toLowerCase(),
      password: inputs.password.value
    };

    state.busy = true; state.registerError=''; render();
    try{
      await api('/auth/register', { method:'POST', body });
      state.busy = false;
      state.registerError = '';
      state.regDraft = null; // clear the form (and the password) once the account exists
      state.loginError = '';
      state.loginNotice = 'Account created. Sign in with your new username and password.';
      state.screen = 'login';
      render();
    }catch(err){
      state.busy = false;
      // The server reports per-field problems (e.g. username already taken); show them on the fields.
      if(err.fields) Object.keys(err.fields).forEach(k=>{ draft.errors[k] = err.fields[k]; draft.touched[k] = true; });
      state.registerError = err.message || 'Could not create your account.';
      render();
      const bad = err.fields && FIELDS.find(f=>err.fields[f.key]);
      if(bad){ const i = document.getElementById(bad.id); if(i) i.focus(); }
    }
  });

  card.appendChild(form);
  const switchRow = el('p',{class:'auth-switch'},['Already registered? ']);
  const switchLink = el('button',{class:'link-btn', type:'button'},['Sign in']);
  switchLink.addEventListener('click', ()=>{ state.registerError=''; state.regDraft=null; state.screen='login'; render(); });
  switchRow.appendChild(switchLink);
  card.appendChild(switchRow);

  formCol.appendChild(card);
  wrap.appendChild(formCol);
  wrap.appendChild(renderAuthVisual());
  return wrap;
}

function renderOtp(){
  const wrap = el('div',{class:'login-wrap'});
  const formCol = el('div',{class:'auth-form-col'});
  const card = el('div',{class:'login-card'},[
    el('div',{class:'login-eyebrow'},['Verify it’s you']),
    el('h1',{},['Enter your one-time code']),
    el('p',{class:'sub'},[`We sent a 6-digit code to ${state.emailMasked}.`]),
  ]);

  if(state.devOtp){
    card.appendChild(el('div',{class:'otp-demo'},[
      el('div',{class:'otp-demo-label'},['No email provider is configured on this server']),
      el('div',{class:'otp-demo-sub'},['Set EMAIL_USER / EMAIL_PASS (a Gmail address + app password) on the server to send real emails. Until then, here’s the code so you can keep testing:']),
      el('div',{class:'otp-demo-code'},[state.devOtp])
    ]));
  }

  const form = el('div',{});
  const otpField = el('div',{class:'field'},[ el('label',{for:'otp-input'},['One-time code']), el('input',{id:'otp-input', type:'text', inputmode:'numeric', maxlength:'6', autocomplete:'one-time-code'}) ]);
  form.appendChild(otpField);
  const errorDiv = el('div',{class:'login-error'},[state.otpError]);
  form.appendChild(errorDiv);
  const verifyBtn = el('button',{class:'btn btn-primary', type:'button'},[state.busy ? 'Verifying…' : 'Verify and sign in']);
  if(state.busy) verifyBtn.setAttribute('disabled','disabled');
  form.appendChild(verifyBtn);

  async function attemptVerify(){
    if(state.busy) return;
    const code = document.getElementById('otp-input').value.trim();
    if(!code){ state.otpError = 'Enter the 6-digit code.'; render(); return; }
    state.busy = true; state.otpError=''; render();
    try{
      const data = await api('/auth/verify-otp', { method:'POST', body:{ pendingToken: state.pendingToken, code } });
      state.busy = false;
      state.token = data.token;
      state.currentUser = data.user;
      safeSetLS('certbench-token', state.token);
      state.pendingToken = null; state.devOtp = null;
      await loadExams();
      state.screen = 'select';
      render();
    }catch(err){
      state.busy = false;
      state.otpError = err.message || 'Verification failed.';
      render();
    }
  }

  verifyBtn.addEventListener('click', attemptVerify);
  otpField.querySelector('input').addEventListener('keydown', e=>{ if(e.key==='Enter') attemptVerify(); });

  card.appendChild(form);

  const resendRow = el('p',{class:'auth-switch'},[]);
  const canResend = Date.now() >= (state.otpResendAt||0);
  const resendLink = el('button',{class:'link-btn otp-resend-btn', type:'button', disabled: canResend?undefined:'disabled'},[canResend ? 'Resend code' : 'Resend available shortly']);
  resendLink.addEventListener('click', async ()=>{
    if(Date.now() < (state.otpResendAt||0) || state.busy) return;
    state.busy = true; render();
    try{
      const data = await api('/auth/resend-otp', { method:'POST', body:{ pendingToken: state.pendingToken } });
      state.busy = false;
      state.otpExpiresAt = Date.now() + data.expiresInSeconds*1000;
      state.otpResendAt = Date.now() + 30*1000;
      state.devOtp = data.devOtp || null;
      state.otpError = '';
      render();
    }catch(err){
      state.busy = false;
      state.otpError = err.message || 'Could not resend the code.';
      render();
    }
  });
  resendRow.appendChild(resendLink);
  card.appendChild(resendRow);

  const cancelRow = el('p',{class:'auth-switch'},['Wrong account? ']);
  const cancelLink = el('button',{class:'link-btn', type:'button'},['Back to sign in']);
  cancelLink.addEventListener('click', ()=>{ state.pendingToken=null; state.devOtp=null; state.otpError=''; state.loginError=''; state.screen='login'; render(); });
  cancelRow.appendChild(cancelLink);
  card.appendChild(cancelRow);

  formCol.appendChild(card);
  wrap.appendChild(formCol);
  wrap.appendChild(renderAuthVisual());
  return wrap;
}

/* ============ EXAM SCREENS ============ */

async function loadExams(){
  const data = await api('/exams');
  state.exams = data.exams;
}

function formatRupees(paise){
  return '₹' + (paise/100).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

let razorpayScriptPromise = null;

let lastCelebratedAttemptId = null;
function celebrateSuccess(attemptId){
  if(lastCelebratedAttemptId === attemptId) return; // don't re-burst on every re-render of the same result
  lastCelebratedAttemptId = attemptId;

  const colors = ['#8b7dff', '#5b8cff', '#38bdf8', '#34d399', '#f5b04a'];
  const overlay = el('div',{class:'confetti-overlay'});
  const pieceCount = 60;
  for(let i = 0; i < pieceCount; i++){
    const piece = el('div',{class:'confetti-piece'});
    const left = Math.random() * 100;
    const duration = 2.4 + Math.random() * 1.6;
    const delay = Math.random() * 0.4;
    const color = colors[Math.floor(Math.random() * colors.length)];
    piece.style.left = left + 'vw';
    piece.style.background = color;
    piece.style.animationDuration = duration + 's';
    piece.style.animationDelay = delay + 's';
    piece.style.borderRadius = Math.random() > 0.5 ? '2px' : '50%';
    overlay.appendChild(piece);
  }
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 4500);
}
function loadRazorpayScript(){
  if(window.Razorpay) return Promise.resolve();
  if(razorpayScriptPromise) return razorpayScriptPromise;
  razorpayScriptPromise = new Promise((resolve, reject)=>{
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the payment gateway. Check your connection and try again.'));
    document.head.appendChild(s);
  });
  return razorpayScriptPromise;
}

function markExamEnrolled(slug){
  const bank = state.exams.find(b => b.slug === slug);
  if(bank) bank.enrolled = true;
}

async function enrollInExam(slug){
  if(state.enrollBusySlug) return;
  const bank = state.exams.find(b => b.slug === slug);
  if(!bank) return;

  state.enrollBusySlug = slug;
  render();

  try{
    const data = await api('/payments/enroll', { method:'POST', body:{ examSlug: slug } });

    if(data.alreadyEnrolled || data.free){
      markExamEnrolled(slug);
      state.enrollBusySlug = null;
      render();
      return;
    }

    if(data.devMode){
      // No real gateway configured on the server yet — enrollment was
      // completed instantly server-side so the flow can still be tested.
      markExamEnrolled(slug);
      state.enrollBusySlug = null;
      render();
      alert('No live payment gateway is configured on this server yet, so you were enrolled for free in dev mode. Add Razorpay keys to .env to require real payment.');
      return;
    }

    // Real gateway: open Razorpay Checkout.
    await loadRazorpayScript();
    state.enrollBusySlug = null;
    render();

    const rzp = new window.Razorpay({
      key: data.keyId,
      amount: data.amountPaise,
      currency: data.currency,
      name: 'CertBench',
      description: `Enrollment: ${data.examName}`,
      order_id: data.orderId,
      prefill: {
        name: state.currentUser ? state.currentUser.name : '',
        email: state.currentUser ? state.currentUser.email : '',
        contact: state.currentUser ? state.currentUser.mobile : ''
      },
      theme: { color: bank.color },
      handler: async function(response){
        try{
          await api('/payments/verify', { method:'POST', body:{
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature
          }});
          markExamEnrolled(slug);
          render();
        }catch(err){
          alert(err.message || 'Payment verification failed. If money was deducted, contact support with your payment ID.');
        }
      },
      modal: {
        ondismiss: function(){ /* user closed the payment window; nothing to do */ }
      }
    });
    rzp.on('payment.failed', function(){
      alert('Payment failed. Please try again.');
    });
    rzp.open();
  }catch(err){
    state.enrollBusySlug = null;
    render();
    alert(err.message || 'Could not start enrollment.');
  }
}

function renderForgot(){
  const wrap = el('div',{class:'login-wrap'});
  const formCol = el('div',{class:'auth-form-col'});
  const card = el('div',{class:'login-card'},[
    el('div',{class:'login-eyebrow'},['Reset password']),
    el('h1',{},['Forgot your password?']),
    el('p',{class:'sub'},['Enter the email on your account and we’ll send a reset code.']),
  ]);

  const form = el('div',{});
  const emailField = el('div',{class:'field'},[ el('label',{for:'forgot-email'},['Email address']), el('input',{id:'forgot-email', type:'email', autocomplete:'email'}) ]);
  form.appendChild(emailField);
  const errorDiv = el('div',{class:'login-error'},[state.forgotError]);
  form.appendChild(errorDiv);
  const submitBtn = el('button',{class:'btn btn-primary', type:'button'},[state.busy ? 'Sending…' : 'Send reset code']);
  if(state.busy) submitBtn.setAttribute('disabled','disabled');
  form.appendChild(submitBtn);

  async function attemptForgot(){
    if(state.busy) return;
    const email = document.getElementById('forgot-email').value.trim();
    if(!email){ state.forgotError = 'Enter your email address.'; render(); return; }
    state.busy = true; state.forgotError=''; render();
    try{
      const data = await api('/auth/forgot-password', { method:'POST', body:{ email } });
      state.busy = false;
      state.resetEmail = email;
      state.resetToken = data.resetToken || null;
      state.resetOtp = data.devOtp || null;
      state.resetError = '';
      // Whether or not the email exists, move forward to the same next
      // screen — the server deliberately doesn't reveal which case it was.
      state.screen = 'reset';
      render();
    }catch(err){
      state.busy = false;
      state.forgotError = err.message || 'Could not send the reset code.';
      render();
    }
  }

  submitBtn.addEventListener('click', attemptForgot);
  emailField.querySelector('input').addEventListener('keydown', e=>{ if(e.key==='Enter') attemptForgot(); });

  card.appendChild(form);
  const backRow = el('p',{class:'auth-switch'},[]);
  const backLink = el('button',{class:'link-btn', type:'button'},['Back to sign in']);
  backLink.addEventListener('click', ()=>{ state.loginError=''; state.screen='login'; render(); });
  backRow.appendChild(backLink);
  card.appendChild(backRow);

  formCol.appendChild(card);
  wrap.appendChild(formCol);
  wrap.appendChild(renderAuthVisual());
  return wrap;
}

function renderReset(){
  const wrap = el('div',{class:'login-wrap'});
  const formCol = el('div',{class:'auth-form-col'});
  const card = el('div',{class:'login-card'},[
    el('div',{class:'login-eyebrow'},['Reset password']),
    el('h1',{},['Enter your reset code']),
    el('p',{class:'sub'},[`If an account exists for ${state.resetEmail}, a 6-digit code was just emailed to it.`]),
  ]);

  if(state.resetOtp){
    card.appendChild(el('div',{class:'otp-demo'},[
      el('div',{class:'otp-demo-label'},['No email provider is configured on this server']),
      el('div',{class:'otp-demo-sub'},['Here’s the code so you can keep testing:']),
      el('div',{class:'otp-demo-code'},[state.resetOtp])
    ]));
  }

  const form = el('div',{});
  const codeField = el('div',{class:'field'},[ el('label',{for:'reset-code'},['Reset code']), el('input',{id:'reset-code', type:'text', inputmode:'numeric', maxlength:'6'}) ]);
  const pwField = el('div',{class:'field'},[ el('label',{for:'reset-newpw'},['New password (8-64 chars: upper & lower case, number, special character)']), pwToggle(el('input',{id:'reset-newpw', type:'password', autocomplete:'new-password', maxlength:'64'})) ]);
  const pwConfirmField = el('div',{class:'field'},[ el('label',{for:'reset-newpw2'},['Confirm new password']), pwToggle(el('input',{id:'reset-newpw2', type:'password', autocomplete:'new-password'})) ]);
  form.appendChild(codeField);
  form.appendChild(pwField);
  form.appendChild(pwConfirmField);

  const errorDiv = el('div',{class:'login-error'},[state.resetError]);
  form.appendChild(errorDiv);
  const submitBtn = el('button',{class:'btn btn-primary', type:'button'},[state.busy ? 'Updating…' : 'Reset password']);
  if(state.busy) submitBtn.setAttribute('disabled','disabled');
  form.appendChild(submitBtn);

  async function attemptReset(){
    if(state.busy) return;
    const code = document.getElementById('reset-code').value.trim();
    const pw = document.getElementById('reset-newpw').value;
    const pw2 = document.getElementById('reset-newpw2').value;
    if(!code){ state.resetError = 'Enter the 6-digit code.'; render(); return; }
    const pwProblem = REG_RULES.password(pw);
    if(pwProblem){ state.resetError = pwProblem; render(); return; }
    if(pw !== pw2){ state.resetError = 'Passwords do not match.'; render(); return; }

    state.busy = true; state.resetError=''; render();
    try{
      await api('/auth/reset-password', { method:'POST', body:{ resetToken: state.resetToken, code, newPassword: pw } });
      state.busy = false;
      state.resetToken = null; state.resetOtp = null;
      state.loginError = '';
      state.loginNotice = 'Password updated. Sign in with your new password.';
      state.screen = 'login';
      render();
    }catch(err){
      state.busy = false;
      state.resetError = err.message || 'Could not reset your password.';
      render();
    }
  }

  submitBtn.addEventListener('click', attemptReset);

  card.appendChild(form);
  const backRow = el('p',{class:'auth-switch'},[]);
  const backLink = el('button',{class:'link-btn', type:'button'},['Back to sign in']);
  backLink.addEventListener('click', ()=>{ state.resetToken=null; state.resetOtp=null; state.loginError=''; state.screen='login'; render(); });
  backRow.appendChild(backLink);
  card.appendChild(backRow);

  formCol.appendChild(card);
  wrap.appendChild(formCol);
  wrap.appendChild(renderAuthVisual());
  return wrap;
}

function renderSelect(){
  const wrap = el('div',{class:'select-wrap'});
  const who = state.currentUser ? state.currentUser.name.split(' ')[0] : '';
  wrap.appendChild(el('div',{class:'select-head'},[
    el('h1',{},[who ? `Choose a mock exam, ${who}` : 'Choose a mock exam']),
    el('p',{},['Each exam includes ' + (Math.max.apply(null, [0].concat(state.exams.map(e => e.set_count || 0))) || 5) + ' separate practice sets so you can retake it with fresh questions. Answers are graded on the server, so results are trustworthy.'])
  ]));

  const searchWrap = el('div',{class:'search-wrap'},[ el('span',{class:'search-icon'},[icon(ICON_SEARCH, 18)]) ]);
  const searchInput = el('input',{
    type:'text', class:'search-input',
    placeholder:'Search exams by name, e.g. "Azure", "AWS", "Kubernetes"…',
    value: state.examSearch || ''
  });
  searchInput.addEventListener('input', function(){
    state.examSearch = this.value;
    if(this.value.trim()) state.examCat = 'all';   // search across every category
    renderExamGrid();
  });
  searchWrap.appendChild(searchInput);
  wrap.appendChild(searchWrap);

  const selCats = categoriesIn(state.exams, b => b.short_label);
  const chipsHolder = el('div',{});
  if(selCats.length > 1) wrap.appendChild(chipsHolder);
  const gridHolder = el('div',{});
  wrap.appendChild(gridHolder);

  function renderExamGrid(){
    gridHolder.innerHTML = '';
    chipsHolder.innerHTML = '';
    if(!selCats.some(c => c.id === state.examCat) && state.examCat !== 'free') state.examCat = 'all';
    chipsHolder.appendChild(categoryChips(selCats, state.exams.length, state.examCat, (id)=>{ state.examCat = id; renderExamGrid(); },
      { freeCount: state.exams.filter(b => !(b.price_inr_paise > 0)).length }));
    const q = (state.examSearch || '').trim().toLowerCase();
    let filtered = state.exams;
    if(state.examCat === 'free') filtered = filtered.filter(b => !(b.price_inr_paise > 0));
    else if(state.examCat !== 'all') filtered = filtered.filter(b => examCategoryId(b.short_label, b.name) === state.examCat);
    if(q) filtered = filtered.filter(bank =>
      bank.name.toLowerCase().includes(q) || bank.description.toLowerCase().includes(q) || bank.short_label.toLowerCase().includes(q)
    );

    if(!filtered.length){
      gridHolder.appendChild(el('p',{class:'no-results'},[q ? `No exams match "${state.examSearch}".` : 'No exams in this category yet.']));
      return;
    }

    const grid = el('div',{class:'cert-grid'});
    filtered.forEach(bank=>{
      const isPaid = bank.price_inr_paise > 0;
      const isEnrolled = bank.enrolled || !isPaid;
      const isBusy = state.enrollBusySlug === bank.slug;

      const priceBadge = el('span',{class:'price-badge '+(isPaid ? '' : 'free')},[
        isPaid ? formatRupees(bank.price_inr_paise) : 'Free'
      ]);

      const actionBtn = isEnrolled
        ? el('button',{class:'btn btn-primary'},['Choose a practice set', icon(ICON_ARROW, 16)])
        : el('button',{class:'btn btn-primary', disabled: isBusy?'disabled':undefined},[isBusy ? 'Starting…' : `Enroll — ${formatRupees(bank.price_inr_paise)}`]);

      actionBtn.addEventListener('click', ()=>{
        if(isEnrolled) loadSets(bank.slug);
        else enrollInExam(bank.slug);
      });

      const card = el('div',{class:'cert-card', style:`--c:${safeColor(bank.color)}`},[
        el('div',{class:'cert-top-row'},[
          el('div',{class:'cert-badge'},[bank.short_label]),
          priceBadge
        ]),
        el('h3',{class:'cert-name'},[bank.name]),
        el('p',{class:'cert-desc'},[bank.description]),
        el('div',{class:'cert-meta'},[
          el('span',{},[el('b',{},[String(bank.question_count)]), 'questions per set']),
          el('span',{},[el('b',{},[String(bank.set_count||5)]), 'practice sets']),
          el('span',{},[el('b',{},[bank.duration_minutes+' min']), 'time limit']),
          el('span',{},[el('b',{},[bank.pass_pct+'%']), 'to pass'])
        ]),
        isEnrolled && isPaid ? el('div',{class:'enrolled-tag'},['✓ Enrolled']) : null,
        actionBtn
      ]);
      grid.appendChild(card);
    });
    gridHolder.appendChild(grid);
  }

  renderExamGrid();
  return wrap;
}

// ---- "Rate CertBench" card for signed-in users (one review each; admins approve before it goes public) ----
function renderMyReview(){
  const box = el('section',{class:'my-review', id:'my-review', 'aria-labelledby':'my-review-title'});
  function fill(){
    box.innerHTML = '';
    if(!state.canReview && !state.myReview){ box.remove(); return; }
    const mine = state.myReview;
    let editing = !mine;
    let picked = mine ? mine.rating : 0;

    box.appendChild(el('div',{class:'my-review-head'},[
      el('h2',{id:'my-review-title'},[mine ? 'Your review of CertBench' : 'How was your practice? Rate CertBench']),
      el('p',{},[mine ? 'Thanks for rating us. You can update your review at any time.' : 'Your rating helps other learners choose. Approved 4 and 5 star reviews can appear on the CertBench home page, showing only your first name and last initial.'])
    ]));
    const body = el('div',{});
    box.appendChild(body);

    function statusPill(st){
      const map = { pending:['Waiting for approval','pending'], approved:['Approved','approved'], hidden:['Not shown publicly','hidden'] };
      const m = map[st] || map.pending;
      return el('span',{class:'review-status review-status-' + m[1]},[m[0]]);
    }

    function draw(){
      body.innerHTML = '';
      if(!editing && mine){
        body.appendChild(el('div',{class:'my-review-view'},[
          el('div',{class:'my-review-meta'},[ starRow(mine.rating, 'stars-lg'), statusPill(mine.status) ]),
          el('p',{class:'my-review-text'},[mine.comment]),
          el('div',{class:'my-review-actions'},[
            el('button',{class:'btn btn-ghost btn-sm', type:'button', onclick:()=>{ editing = true; draw(); }},['Edit review']),
            el('button',{class:'btn btn-ghost btn-sm', type:'button', onclick:async ()=>{
              if(!window.confirm('Delete your review?')) return;
              try{ await api('/reviews/mine', { method:'DELETE' }); state.myReview = null; fill(); }
              catch(e){ alert(e.message || 'Could not delete your review.'); }
            }},['Delete'])
          ])
        ]));
        return;
      }
      const err = el('div',{class:'field-error', role:'alert'});
      const starsWrap = el('div',{class:'star-input', role:'radiogroup', 'aria-label':'Your rating'});
      const labels = ['Poor','Fair','Good','Very good','Excellent'];
      const hint = el('span',{class:'star-hint'},[picked ? labels[picked-1] : 'Tap a star']);
      function paint(n){
        Array.prototype.forEach.call(starsWrap.children, (b, i)=>{ b.classList.toggle('on', i < n); });
        hint.textContent = n ? labels[n-1] : 'Tap a star';
      }
      for(let i = 1; i <= 5; i++){
        const b = el('button',{type:'button', class:'star-btn', role:'radio', 'aria-checked': String(i === picked), 'aria-label': i + ' star' + (i > 1 ? 's' : '') + ' — ' + labels[i-1]},['★']);
        b.addEventListener('click', ()=>{
          picked = i; paint(i);
          Array.prototype.forEach.call(starsWrap.children, (x, j)=> x.setAttribute('aria-checked', String(j + 1 === i)));
        });
        b.addEventListener('mouseenter', ()=> paint(i));
        b.addEventListener('mouseleave', ()=> paint(picked));
        starsWrap.appendChild(b);
      }
      paint(picked);
      const ta = el('textarea',{class:'review-input', rows:'4', maxlength:'500', placeholder:'What did you like? Did it help you prepare for your exam?', 'aria-label':'Your review'});
      ta.value = mine ? mine.comment : '';
      const count = el('span',{class:'char-count'},[ta.value.length + '/500']);
      ta.addEventListener('input', ()=>{ count.textContent = ta.value.length + '/500'; });
      const submit = el('button',{class:'btn btn-primary', type:'button'},[mine ? 'Update review' : 'Submit review']);
      submit.addEventListener('click', async ()=>{
        err.textContent = '';
        if(!picked){ err.textContent = 'Pick a rating from 1 to 5 stars.'; return; }
        if(ta.value.trim().length < 10){ err.textContent = 'Please write at least 10 characters about your experience.'; return; }
        submit.disabled = true; submit.textContent = 'Saving…';
        try{
          const d = await api('/reviews/mine', { method:'PUT', body:{ rating: picked, comment: ta.value } });
          state.myReview = d.review; fill();
          const t = document.querySelector('.my-review .my-review-meta');
          if(t) t.appendChild(el('span',{class:'review-thanks'},['Thanks! An admin will review it shortly.']));
        }catch(e){
          submit.disabled = false; submit.textContent = mine ? 'Update review' : 'Submit review';
          err.textContent = (e.fields && (e.fields.rating || e.fields.comment)) || e.message || 'Could not save your review.';
        }
      });
      body.appendChild(el('div',{class:'my-review-form'},[
        el('div',{class:'star-row'},[starsWrap, hint]),
        ta,
        el('div',{class:'my-review-foot'},[
          count, err,
          el('div',{class:'my-review-actions'},[
            mine ? el('button',{class:'btn btn-ghost btn-sm', type:'button', onclick:()=>{ editing = false; picked = mine.rating; draw(); }},['Cancel']) : null,
            submit
          ])
        ]),
        mine ? el('p',{class:'my-review-note'},['Editing sends your review back for approval.']) : null
      ]));
    }
    draw();
  }
  if(state.myReview === undefined){
    box.appendChild(el('p',{class:'my-review-loading'},['Loading your review…']));
    api('/reviews/mine').then(d => { state.myReview = d.review; state.canReview = !!d.canReview; fill(); }).catch(() => { box.remove(); });
  } else fill();
  return box;
}

async function loadSets(slug){
  try{
    const data = await api(`/exams/${slug}/sets`);
    state.setsExamSlug = slug;
    state.setsExamMeta = data.exam;
    state.availableSets = data.sets;
    state.screen = 'sets';
    render();
  }catch(err){
    if(err.status === 402){
      alert('Please enroll and complete payment before accessing this exam.');
      await loadExams();
      render();
      return;
    }
    alert(err.message || 'Could not load the practice sets for this exam.');
  }
}

function renderSets(){
  const wrap = el('div',{class:'select-wrap'});
  const meta = state.setsExamMeta;

  const backBtn = el('button',{class:'back-link'},['← Back to exams']);
  backBtn.addEventListener('click', ()=>{ state.screen='select'; render(); });
  wrap.appendChild(backBtn);

  wrap.appendChild(el('div',{class:'select-head'},[
    el('h1',{},[meta.name]),
    el('p',{},['Pick a practice set below. Each set has its own ' + (new Set(state.availableSets.map(x => x.questionCount)).size === 1 ? state.availableSets[0].questionCount + ' ' : '') + 'questions, so retaking the exam with a different set gives you fresh material to practice with.'])
  ]));

  const grid = el('div',{class:'cert-grid'});
  state.availableSets.forEach(s=>{
    const isLocked = !!s.locked;
    const startBtn = el('button',{
      class: isLocked ? 'btn btn-ghost' : 'btn btn-primary',
      disabled: isLocked ? 'disabled' : undefined
    },[isLocked ? 'Locked' : (s.attemptCount > 0 ? 'Retake this set' : 'Start this set')]);
    if(!isLocked){
      startBtn.addEventListener('click', ()=> startExam(state.setsExamSlug, s.setNumber));
    }

    const best = s.bestScorePct !== null && s.bestScorePct !== undefined ? s.bestScorePct : null;
    const card = el('div',{class:'cert-card set-card'+(isLocked ? ' locked-card' : ''), style:`--c:${safeColor(meta.color)}`},[
      el('div',{class:'cert-top-row'},[
        el('div',{class:'cert-badge'},[`S${s.setNumber}`]),
        isLocked ? el('span',{class:'set-state locked'},[icon(ICON_LOCK, 14), 'Locked'])
          : best !== null && best >= meta.passPct ? el('span',{class:'set-state passed'},[icon(ICON_CHECK, 14), 'Passed'])
          : el('span',{class:'set-state open'},['Unlocked'])
      ]),
      el('h3',{class:'cert-name'},[`Set ${s.setNumber}`]),
      el('div',{class:'cert-meta'},[
        el('span',{},[el('b',{},[String(s.questionCount)]), 'questions']),
        el('span',{},[el('b',{},[s.bestScorePct!==null ? s.bestScorePct+'%' : '—']), 'best score']),
        el('span',{},[el('b',{},[String(s.attemptCount)]), s.attemptCount===1 ? 'attempt' : 'attempts'])
      ]),
      el('div',{class:'set-bar', title:'Best score'},[ el('span',{style:`width:${best||0}%`}), el('i',{style:`left:${meta.passPct}%`}) ]),
      isLocked ? el('p',{class:'lock-note'},[`Pass Set ${s.setNumber-1} (score ≥ ${meta.passPct}%) to unlock this set.`]) : null,
      startBtn
    ]);
    grid.appendChild(card);
  });
  wrap.appendChild(grid);
  return wrap;
}

async function loadHistory(){
  try{
    const data = await api('/exams/attempts/mine');
    state.myAttempts = data.attempts;
    state.screen = 'history';
    render();
  }catch(err){
    alert(err.message || 'Could not load your exam history.');
  }
}

function fmtDate(iso){
  if(!iso) return '—';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  if(isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' }) + ' '
       + d.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
}

function renderHistory(){
  const wrap = el('div',{class:'select-wrap'});

  const backBtn = el('button',{class:'back-link'},['← Back to exams']);
  backBtn.addEventListener('click', ()=>{ state.screen='select'; render(); });
  wrap.appendChild(backBtn);

  wrap.appendChild(el('div',{class:'select-head'},[
    el('h1',{},['My results']),
    el('p',{},['Every completed attempt across every exam and practice set, most recent first.'])
  ]));

  if(!state.myAttempts.length){
    wrap.appendChild(el('p',{class:'no-results'},['You haven’t completed any exams yet. Once you finish one, it’ll show up here.']));
    return wrap;
  }

  const totalAttempts = state.myAttempts.length;
  const totalPassed = state.myAttempts.filter(a=>a.passed).length;
  const avgScore = Math.round(state.myAttempts.reduce((sum,a)=>sum+a.scorePct,0) / totalAttempts);

  wrap.appendChild(el('div',{class:'history-stats'},[
    el('div',{},[el('b',{},[String(totalAttempts)]), el('span',{},['Attempts'])]),
    el('div',{},[el('b',{},[String(totalPassed)]), el('span',{},['Passed'])]),
    el('div',{},[el('b',{},[avgScore+'%']), el('span',{},['Average score'])])
  ]));

  const table = el('div',{class:'history-table'});
  state.myAttempts.forEach(a=>{
    const row = el('div',{class:'history-row'},[
      el('div',{class:'history-cell history-exam'},[
        el('span',{class:'history-badge', style:`--c:${safeColor(a.color)}`},[a.shortLabel]),
        el('span',{},[a.examName, ' — Set ', String(a.setNumber)])
      ]),
      el('div',{class:'history-cell'},[fmtDate(a.finishedAt)]),
      el('div',{class:'history-cell history-score'},[`${a.correctCount}/${a.total} (${a.scorePct}%)`]),
      el('div',{class:'history-cell'},[
        el('span',{class:'pass-tag '+(a.passed?'pass':'fail')},[a.passed ? 'PASS' : 'FAIL'])
      ])
    ]);
    table.appendChild(row);
  });
  wrap.appendChild(table);

  return wrap;
}

async function startExam(slug, setNumber){
  try{
    const data = await api(`/exams/${slug}/start`, { method:'POST', body:{ setNumber } });
    state.attemptId = data.attemptId;
    state.examMeta = data.exam;
    state.examSetNumber = data.setNumber;
    state.questions = data.questions;
    state.current = 0;
    state.answers = {};
    state.visitedIds = {};
    state.skippedIds = {};
    state.secondsLeft = data.exam.durationMinutes * 60;
    state.screen = 'exam';
    render();
    startTimer();
  }catch(err){
    if(err.status === 402){
      alert('Please enroll and complete payment before starting this exam.');
      await loadExams();
      state.screen = 'select';
      render();
      return;
    }
    if(err.status === 423){
      alert(err.message || 'That set is locked until you pass the previous one.');
      await loadSets(slug);
      return;
    }
    alert(err.message || 'Could not start the exam.');
  }
}

function startTimer(){
  clearInterval(state.timerHandle);
  state.timerHandle = setInterval(()=>{
    state.secondsLeft--;
    if(state.secondsLeft <= 0){
      state.secondsLeft = 0;
      clearInterval(state.timerHandle);
      submitExam();
      return;
    }
    const timerEl = document.querySelector('.timer');
    if(timerEl){
      const label = timerEl.querySelector('.time-label');
      if(label) label.textContent = fmtTime(state.secondsLeft);
      if(state.secondsLeft <= 60) timerEl.classList.add('warn');
    }
  }, 1000);
}

function questionStatus(q){
  if(state.answers[q.id] !== undefined) return 'answered';
  if(state.skippedIds[q.id]) return 'skipped';
  if(state.visitedIds[q.id]) return 'not-answered';
  return 'not-visited';
}

function goToQuestion(index){
  state.current = index;
  render();
}

function renderExam(){
  const bank = state.examMeta;
  const q = state.questions[state.current];
  state.visitedIds[q.id] = true; // mark visited as soon as it's shown

  const wrap = el('div',{class:'exam-wrap'});

  wrap.appendChild(el('div',{class:'exam-bar'},[
    el('div',{class:'exam-title'},[el('span',{class:'exam-title-badge', style:`--c:${safeColor(bank.color)}`},[bank.shortLabel || bank.short_label || 'Exam']), el('span',{},['Now taking ', el('b',{},[bank.name]), state.examSetNumber ? ` — Set ${state.examSetNumber}` : ''])]),
    el('div',{class:`timer${state.secondsLeft<=60?' warn':''}`},[ el('span',{class:'dot'}), el('span',{class:'time-label'},[fmtTime(state.secondsLeft)]) ])
  ]));

  const answeredCount = state.questions.filter(qq => state.answers[qq.id] !== undefined).length;
  wrap.appendChild(el('div',{class:'exam-progress', title: answeredCount + ' of ' + state.questions.length + ' answered'},[
    el('span',{style:`width:${(answeredCount/state.questions.length*100).toFixed(1)}%`})
  ]));
  const layout = el('div',{class:'exam-layout'});

  // ---- left sidebar: question palette ----
  const sidebar = el('div',{class:'question-sidebar'});
  sidebar.appendChild(el('div',{class:'sidebar-heading'},['Questions']));

  const legend = el('div',{class:'palette-legend'},[
    el('span',{},[el('i',{class:'dot-answered'}), 'Answered']),
    el('span',{},[el('i',{class:'dot-skipped'}), 'Skipped']),
    el('span',{},[el('i',{class:'dot-not-answered'}), 'Visited']),
    el('span',{},[el('i',{class:'dot-not-visited'}), 'Not visited'])
  ]);
  sidebar.appendChild(legend);

  const paletteGrid = el('div',{class:'palette-grid'});
  state.questions.forEach((qq,i)=>{
    const status = questionStatus(qq);
    const btn = el('button',{class:`palette-item ${status}${i===state.current?' current':''}`, type:'button'},[String(i+1)]);
    btn.addEventListener('click', ()=>goToQuestion(i));
    paletteGrid.appendChild(btn);
  });
  sidebar.appendChild(paletteGrid);

  const reviewBtn = el('button',{class:'btn btn-ghost', style:'width:100%;margin-top:1rem;'},['Review & submit']);
  reviewBtn.addEventListener('click', goToReview);
  sidebar.appendChild(reviewBtn);

  const exitBtn = el('button',{class:'btn btn-danger', style:'width:100%;margin-top:.6rem;'},['Exit exam']);
  exitBtn.addEventListener('click', exitExam);
  sidebar.appendChild(exitBtn);

  layout.appendChild(sidebar);

  // ---- main question panel ----
  const body = el('div',{class:'exam-body'});
  const panel = el('div',{class:'question-panel'});
  panel.appendChild(el('div',{class:'q-index'},[`QUESTION ${state.current+1} OF ${state.questions.length}`]));
  panel.appendChild(el('div',{class:'q-text'},[q.text]));

  const optionsWrap = el('div',{class:'options'});
  q.options.forEach((opt, idx)=>{
    const selected = state.answers[q.id] === idx;
    const optBtn = el('button',{class:'option'+(selected?' selected':''), type:'button'},[
      el('span',{class:'option-mark'},[String.fromCharCode(65+idx)]),
      el('span',{},[opt])
    ]);
    optBtn.addEventListener('click', ()=>{
      state.answers[q.id] = idx;
      delete state.skippedIds[q.id]; // picking an answer un-skips it
      render();
    });
    optionsWrap.appendChild(optBtn);
  });
  panel.appendChild(optionsWrap);

  const nav = el('div',{class:'exam-nav'});
  const prevBtn = el('button',{class:'btn btn-ghost'},['Previous']);
  if(state.current === 0){ prevBtn.setAttribute('disabled','disabled'); prevBtn.style.opacity='.4'; }
  prevBtn.addEventListener('click', ()=>{ if(state.current>0){ state.current--; render(); } });

  const isLast = state.current === state.questions.length - 1;

  const skipBtn = el('button',{class:'btn btn-ghost'},['Skip question']);
  skipBtn.addEventListener('click', ()=>{
    delete state.answers[q.id];
    state.skippedIds[q.id] = true;
    if(isLast) goToReview(); else { state.current++; render(); }
  });

  const nextBtn = el('button',{class:'btn btn-primary'},[isLast ? 'Review answers' : 'Next question']);
  nextBtn.addEventListener('click', ()=>{ if(isLast) goToReview(); else { state.current++; render(); } });

  nav.appendChild(prevBtn);
  nav.appendChild(el('div',{class:'spacer'}));
  nav.appendChild(skipBtn);
  nav.appendChild(nextBtn);
  panel.appendChild(nav);

  body.appendChild(panel);
  layout.appendChild(body);
  wrap.appendChild(layout);
  return wrap;
}

function goToReview(){
  state.screen = 'review';
  render();
}

function exitExam(){
  const ok = window.confirm('Exit this exam? Your progress on this set won’t be saved, and you can start it again later.');
  if(!ok) return;
  clearInterval(state.timerHandle);
  const slug = state.setsExamSlug || (state.examMeta && state.examMeta.slug);
  state.attemptId = null;
  state.examMeta = null;
  state.examSetNumber = null;
  state.questions = [];
  state.current = 0;
  state.answers = {};
  state.visitedIds = {};
  state.skippedIds = {};
  if(slug) loadSets(slug);
  else { state.screen = 'select'; render(); }
}

function renderReview(){
  const bank = state.examMeta;
  const wrap = el('div',{class:'exam-wrap'});

  wrap.appendChild(el('div',{class:'exam-bar'},[
    el('div',{class:'exam-title'},['Reviewing ', el('b',{},[bank.name]), state.examSetNumber ? ` — Set ${state.examSetNumber}` : '']),
    el('div',{class:`timer${state.secondsLeft<=60?' warn':''}`},[ el('span',{class:'dot'}), el('span',{class:'time-label'},[fmtTime(state.secondsLeft)]) ])
  ]));

  const body = el('div',{class:'exam-body'});
  const panel = el('div',{class:'question-panel', style:'max-width:800px;'});

  const counts = { answered:0, skipped:0, 'not-answered':0, 'not-visited':0 };
  state.questions.forEach(q => counts[questionStatus(q)]++);

  panel.appendChild(el('div',{class:'q-index'},['BEFORE YOU SUBMIT']));
  panel.appendChild(el('div',{class:'q-text', style:'font-size:1.15rem;'},['Review your answers']));

  panel.appendChild(el('div',{class:'review-summary'},[
    el('div',{class:'review-stat answered'},[el('b',{},[String(counts.answered)]), el('span',{},['Answered'])]),
    el('div',{class:'review-stat skipped'},[el('b',{},[String(counts.skipped)]), el('span',{},['Skipped'])]),
    el('div',{class:'review-stat not-answered'},[el('b',{},[String(counts['not-answered'])]), el('span',{},['Visited, no answer'])]),
    el('div',{class:'review-stat not-visited'},[el('b',{},[String(counts['not-visited'])]), el('span',{},['Not visited'])])
  ]));

  const missed = counts.skipped + counts['not-answered'] + counts['not-visited'];
  if(missed > 0){
    panel.appendChild(el('div',{class:'review-warning'},[
      `You have ${missed} question${missed===1?'':'s'} without an answer. Tap any number below to go back and answer it, or submit as-is.`
    ]));
  }

  const paletteGrid = el('div',{class:'palette-grid', style:'margin:1.25rem 0 1.75rem;'});
  state.questions.forEach((qq,i)=>{
    const status = questionStatus(qq);
    const btn = el('button',{class:`palette-item ${status}`, type:'button'},[String(i+1)]);
    btn.addEventListener('click', ()=>{ state.current = i; state.screen = 'exam'; render(); });
    paletteGrid.appendChild(btn);
  });
  panel.appendChild(paletteGrid);

  const nav = el('div',{class:'exam-nav'});
  const backBtn = el('button',{class:'btn btn-ghost'},['← Back to exam']);
  backBtn.addEventListener('click', ()=>{ state.screen='exam'; render(); });
  const exitBtn = el('button',{class:'btn btn-danger'},['Exit exam']);
  exitBtn.addEventListener('click', exitExam);
  const submitBtn = el('button',{class:'btn btn-primary'},['Submit exam']);
  submitBtn.addEventListener('click', ()=>{
    if(missed > 0){
      const ok = window.confirm(`You still have ${missed} question${missed===1?'':'s'} without an answer. Submit anyway?`);
      if(!ok) return;
    }
    submitExam();
  });
  nav.appendChild(backBtn);
  nav.appendChild(exitBtn);
  nav.appendChild(el('div',{class:'spacer'}));
  nav.appendChild(submitBtn);
  panel.appendChild(nav);

  body.appendChild(panel);
  wrap.appendChild(body);
  return wrap;
}

async function submitExam(){
  clearInterval(state.timerHandle);
  try{
    const data = await api(`/exams/attempts/${state.attemptId}/submit`, { method:'POST', body:{ answers: state.answers } });
    state.results = data;
    state.myReview = undefined;   // re-check: finishing a set is what unlocks rating
    state.screen = 'results';
    render();
  }catch(err){
    alert(err.message || 'Could not submit the exam.');
  }
}

function renderResults(){
  const r = state.results;
  const total = r.total, correctCount = r.correctCount, pct = r.scorePct, pass = r.passed;
  const incorrect = total - correctCount;
  const circumference = 2*Math.PI*50;
  const dash = circumference * (pct/100);
  const ringColor = pass ? 'var(--success)' : 'var(--danger)';

  if(pass) celebrateSuccess(r.attemptId);

  const wrap = el('div',{class:'results-wrap'});

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS,'svg');
  svg.setAttribute('width','116'); svg.setAttribute('height','116'); svg.setAttribute('viewBox','0 0 116 116');
  const bg = document.createElementNS(svgNS,'circle');
  bg.setAttribute('cx','58'); bg.setAttribute('cy','58'); bg.setAttribute('r','50');
  bg.setAttribute('fill','none'); bg.setAttribute('stroke','var(--hairline)'); bg.setAttribute('stroke-width','10');
  const fg = document.createElementNS(svgNS,'circle');
  fg.setAttribute('cx','58'); fg.setAttribute('cy','58'); fg.setAttribute('r','50');
  fg.setAttribute('fill','none'); fg.setAttribute('stroke',ringColor); fg.setAttribute('stroke-width','10');
  fg.setAttribute('stroke-linecap', pct > 0 ? 'round' : 'butt');
  fg.setAttribute('stroke-dasharray', `${dash} ${circumference}`);
  svg.appendChild(bg); svg.appendChild(fg);

  const ring = el('div',{class:'score-ring'},[svg, el('div',{class:'pct'},[pct+'%', el('small',{},['score'])])]);
  const info = el('div',{class:'score-info'},[
    el('div',{class:'pass-tag '+(pass?'pass':'fail')},[pass ? 'PASS' : 'FAIL']),
    el('h2',{},[r.examName]),
    el('p',{},[pass ? 'You met the passing threshold for this mock exam.' : `You did not reach the ${r.passPct}% passing threshold this time.`]),
    el('div',{class:'score-stats'},[
      el('div',{},[el('b',{},[String(correctCount)]), el('span',{},['Correct'])]),
      el('div',{},[el('b',{},[String(incorrect)]), el('span',{},['Incorrect'])]),
      el('div',{},[el('b',{},[String(total)]), el('span',{},['Total'])])
    ])
  ]);
  wrap.appendChild(el('div',{class:'score-panel ' + (pass ? 'is-pass' : 'is-fail')},[ring, info]));
  wrap.appendChild(renderMyReview());

  wrap.appendChild(el('div',{class:'review-head'},[ el('h3',{},['Answer breakdown']) ]));
  r.detail.forEach((d,i)=>{
    const item = el('div',{class:'review-item '+(d.isCorrect?'correct':'incorrect')});
    item.appendChild(el('p',{class:'review-q'},[`${i+1}. ${d.text}`]));
    const yourText = (d.selectedIndex===null||d.selectedIndex===undefined) ? 'No answer selected' : d.options[d.selectedIndex];
    item.appendChild(el('div',{class:'review-row your '+(d.isCorrect?'right':'wrong')},[
      el('span',{class:'lbl'},['Your answer']), el('span',{},[yourText, d.isCorrect ? '  ✓' : '  ✗'])
    ]));
    if(!d.isCorrect){
      item.appendChild(el('div',{class:'review-row correctans'},[
        el('span',{class:'lbl'},['Correct answer']), el('span',{},[d.options[d.correctIndex]])
      ]));
    }
    wrap.appendChild(item);
  });

  const actions = el('div',{class:'results-actions'},[
    el('button',{class:'btn btn-primary'},['Retake this set']),
    el('button',{class:'btn btn-ghost'},['Choose another set']),
    el('button',{class:'btn btn-ghost'},['Choose another exam']),
    el('button',{class:'btn btn-danger'},['Sign out'])
  ]);
  actions.children[0].addEventListener('click', ()=>startExam(state.examMeta.slug, state.examSetNumber));
  actions.children[1].addEventListener('click', ()=>loadSets(state.examMeta.slug));
  actions.children[2].addEventListener('click', ()=>{ state.screen='select'; render(); });
  actions.children[3].addEventListener('click', signOut);
  wrap.appendChild(actions);

  return wrap;
}

function signOut(){
  clearInterval(state.timerHandle);
  safeRemoveLS('certbench-token');
  state = Object.assign({}, state, {
    screen:'login', token:null, currentUser:null, pendingToken:null,
    setsExamSlug:null, setsExamMeta:null, availableSets:[],
    attemptId:null, examMeta:null, examSetNumber:null, questions:[], current:0, answers:{},
    visitedIds:{}, skippedIds:{},
    results:null, myAttempts:[], examSearch:'', examCat:'all', myReview:undefined, canReview:false,
    resetToken:null, resetEmail:'', resetError:'', resetOtp:null, forgotError:'', forgotNotice:'',
    loginError:'', loginNotice:'', otpError:'', registerError:'', regDraft:null
  });
  render();
  loadLandingExams();
}

/* ============ RENDER ============ */
function render(){
  root.innerHTML = '';
  const container = el('div',{});
  container.style.display='flex'; container.style.flexDirection='column'; container.style.minHeight='100vh';
  if(state.screen !== 'landing') container.appendChild(topbar());

  const main = el('main',{});
  if(state.screen === 'loading') main.appendChild(renderLoading());
  else if(state.screen === 'landing') main.appendChild(renderLanding());
  else if(state.screen === 'login') main.appendChild(renderLogin());
  else if(state.screen === 'register') main.appendChild(renderRegister());
  else if(state.screen === 'otp') main.appendChild(renderOtp());
  else if(state.screen === 'forgot') main.appendChild(renderForgot());
  else if(state.screen === 'reset') main.appendChild(renderReset());
  else if(state.screen === 'select') main.appendChild(renderSelect());
  else if(state.screen === 'sets') main.appendChild(renderSets());
  else if(state.screen === 'history') main.appendChild(renderHistory());
  else if(state.screen === 'exam') main.appendChild(renderExam());
  else if(state.screen === 'review') main.appendChild(renderReview());
  else if(state.screen === 'results') main.appendChild(renderResults());

  container.appendChild(main);
  if(state.screen !== 'landing'){
    container.appendChild(el('footer',{class:'app-foot'},['CertBench — practice mock exams. Not affiliated with Microsoft, AWS, or the Cloud Native Computing Foundation.']));
  }
  root.appendChild(container);

  if(state.screen === 'login'){ const f=document.getElementById('username'); if(f) f.focus(); }
  else if(state.screen === 'register'){ const f=document.getElementById('reg-name'); if(f) f.focus(); }
  else if(state.screen === 'forgot'){ const f=document.getElementById('forgot-email'); if(f) f.focus(); }
  else if(state.screen === 'reset'){ const f=document.getElementById('reset-code'); if(f) f.focus(); }
  else if(state.screen === 'otp'){
    const f=document.getElementById('otp-input'); if(f) f.focus();
    clearInterval(state.otpTickHandle);
    state.otpTickHandle = setInterval(function(){
      if(state.screen !== 'otp'){ clearInterval(state.otpTickHandle); return; }
      const btn = document.querySelector('.otp-resend-btn');
      if(btn && Date.now() >= (state.otpResendAt||0) && btn.textContent.trim() !== 'Resend code'){
        render();
      }
    }, 1000);
  } else {
    clearInterval(state.otpTickHandle);
  }
}

/* ============ BOOT ============ */
function registerServiceWorker(){
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/service-worker.js').catch(()=>{
      // Non-fatal: the app works fine without offline support, e.g. if
      // running in an environment without a secure context.
    });
  }
}

// Which logged-out screen to open first: the sign-in / sign-up links on the
// landing page open the site in a new tab at /#login or /#register.
function initialLoggedOutScreen(){
  let hash = '';
  try{ hash = (window.location.hash || '').replace('#','').toLowerCase(); }catch(e){}
  // Clear the hash so a later refresh doesn't jump back to a stale screen.
  try{ if(hash) window.history.replaceState(null, '', window.location.pathname); }catch(e){}
  if(hash === 'login' || hash === 'register') return hash;
  return 'landing';
}

async function boot(){
  registerServiceWorker();
  const loggedOutScreen = initialLoggedOutScreen(); // also clears the URL hash
  const saved = safeGetLS('certbench-token');
  if(saved){
    state.token = saved;
    try{
      const me = await api('/auth/me');
      state.currentUser = me.user;
      await loadExams();
      state.screen = 'select';
    }catch(e){
      safeRemoveLS('certbench-token');
      state.token = null;
      state.screen = loggedOutScreen;
    }
  } else {
    state.screen = loggedOutScreen;
  }
  render();
  if(state.screen === 'landing' || state.screen === 'login' || state.screen === 'register') loadLandingExams();
}

boot();

})();

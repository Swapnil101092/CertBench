(function(){

const API = '/api';

let state = {
  screen: 'loading', // loading | landing | login | register | otp | forgot | reset | select | sets | exam | results | history
  loginError: '', loginNotice: '', registerError: '', otpError: '',
  forgotError: '', forgotNotice: '', resetToken: null, resetEmail: '', resetError: '', resetOtp: null,
  token: null, currentUser: null,
  pendingToken: null, emailMasked: '', otpExpiresAt: null, otpResendAt: null,
  exams: [], examSearch: '', landingExams: null, siteSettings: null,
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
    const nameSpan = el('span',{style:'font-size:.85rem;color:var(--text-dim);'},[state.currentUser.name]);
    right.push(nameSpan);
    if(state.currentUser.isAdmin && state.screen !== 'exam' && state.screen !== 'review'){
      right.push(el('a',{class:'btn-ghost btn', href:'/admin', style:'padding:.5em 1em;font-size:.82rem;'},['Admin']));
    }
    if(state.screen !== 'exam' && state.screen !== 'review'){
      const historyBtn = el('button',{class:'btn-ghost btn', style:'padding:.5em 1em;font-size:.82rem;'},['My results']);
      historyBtn.addEventListener('click', loadHistory);
      right.push(historyBtn);
    }
    const signOutBtn = el('button',{class:'btn-ghost btn', style:'padding:.5em 1em;font-size:.82rem;'},['Sign out']);
    signOutBtn.addEventListener('click', function(){
      if(state.screen === 'exam' || state.screen === 'review'){
        const ok = window.confirm('You\u2019re in the middle of a timed exam. Signing out now will discard this attempt. Sign out anyway?');
        if(!ok) return;
      }
      signOut();
    });
    right.push(signOutBtn);
  }
  right.push(el('button',{class:'theme-toggle', onclick:toggleTheme},[saved==='light' ? 'Dark mode' : 'Light mode']));
  return el('div',{class:'topbar'},[
    brandLogo(),
    el('div',{style:'display:flex;gap:.9rem;align-items:center;'}, right)
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
  return el('div',{class:'center-notice'},['Loading\u2026']);
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
function contactCard(icon, title, valueNode){
  return el('div',{class:'contact-card'},[
    el('div',{class:'contact-icon'},[svgIcon(icon)]),
    el('div',{class:'contact-body'},[ el('h3',{},[title]), valueNode ])
  ]);
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
  return '\uD83C\uDF93 ' + plural(f.n, 'certification') + ' ready to practice \u2014 ' + joinNames(f.names);
}
function heroSubText(){
  const f = landingFacts();
  const tail = 'results graded the moment you finish \u2014 so you know exactly where you stand before the exam that actually counts.';
  if(!f.n) return 'Timed mock exams with ' + tail;
  return 'Timed mock exams for ' + plural(f.n, 'IT certification') + ', ' + f.setCount + ' fresh practice sets each, and ' + tail;
}
function howStepTexts(){
  const f = landingFacts();
  const one = f.n ? 'Choose from ' + plural(f.n, 'IT track') + ': ' + joinNames(f.names) + '.' : 'Choose the certification you are preparing for.';
  const qTxt = f.samePerSet && f.perSet ? ' of ' + f.perSet + ' questions' : '';
  const passTxt = f.samePass ? ' with ' + f.passPct + '% or more' : ' (the pass mark is shown on each exam)';
  const two = 'Every exam has ' + f.setCount + ' practice sets' + qTxt + ' with a countdown timer. Pass a set' + passTxt + ' to unlock the next one.';
  return { one, two };
}
function aboutParagraphs(){
  const a = state.siteSettings && state.siteSettings.about;
  return (a && a.length) ? a : DEFAULT_ABOUT;
}
function contactInfo(){
  const c = (state.siteSettings && state.siteSettings.contact) || {};
  const address = c.address || CONTACT.address;
  const phone = c.phone || CONTACT.phone;
  const email = c.email || CONTACT.email;
  // Links are built here from the plain values (never trusted as-is), so a bad value can't become a script link.
  const digits = phone.replace(/[^\d+]/g, '');
  return {
    address, phone, email,
    phoneHref: digits.replace(/\D/g, '').length >= 7 ? 'tel:' + digits : null,
    emailHref: /^[^\s@<>"']+@[^\s@<>"']+$/.test(email) ? 'mailto:' + email : null
  };
}

function landingExamList(){
  if(state.landingExams){   // loaded from the server (may legitimately be empty if every exam is hidden)
    return state.landingExams.map(x => {
      const known = LANDING_EXAMS.find(k => k.label === x.short_label);
      return { label:x.short_label, short: known ? known.short : x.name, name:x.name, color:x.color, price:x.price_inr_paise };
    });
  }
  return LANDING_EXAMS.map(x => ({ label:x.label, short:x.short, name:x.name, color:x.color, price:null }));
}

// ---- Moving visuals: certification badges (our own badges, not the vendors' trademarked logos) ----
function examBadge(x){
  return el('span',{class:'exam-chip-badge', style:`background:${x.color}22;color:${x.color};border:1px solid ${x.color}55;`},[x.label]);
}
function examListLabel(list){
  return 'Certifications you can practice: ' + list.map(x => x.name).join(', ');
}

// Landing hero: the badges slowly orbit a glowing CertBench mark.
function renderOrbit(){
  const list = landingExamList();
  const n = list.length;
  // With more than 6 exams the name badges would start to overlap, so switch to compact badges.
  const stage = el('div',{class:'orbit-stage' + (n > 6 ? ' orbit-dense' : ''), role:'img', 'aria-label': examListLabel(list)});
  stage.appendChild(el('div',{class:'orbit-ring', 'aria-hidden':'true'}));
  stage.appendChild(el('div',{class:'orbit-ring orbit-ring-inner', 'aria-hidden':'true'}));
  stage.appendChild(el('div',{class:'orbit-core', 'aria-hidden':'true'},[
    el('img',{class:'orbit-core-mark', src:'/logo-mark.svg', alt:''}),
    el('div',{class:'orbit-core-text'},[n ? plural(n, 'certification') : 'New exams coming soon'])
  ]));
  const orbit = el('div',{class:'orbit', 'aria-hidden':'true'});
  list.forEach((x, i)=>{
    orbit.appendChild(el('div',{class:'orbit-item', style:`--angle:${(i * 360 / n).toFixed(2)}deg`},[
      el('div',{class:'orbit-badge-inner'},[
        el('div',{class:'orbit-chip'},[ examBadge(x), el('span',{class:'orbit-chip-name'},[x.short]) ])
      ])
    ]));
  });
  stage.appendChild(orbit);
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
  const results = await Promise.allSettled([ api('/exams'), api('/settings/public') ]);
  let changed = false;
  if(results[0].status === 'fulfilled'){ state.landingExams = results[0].value.exams; changed = true; }
  if(results[1].status === 'fulfilled'){ state.siteSettings = results[1].value; changed = true; }
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
    const closeBtn = el('button',{class:'promo-close', type:'button', 'aria-label':'Dismiss'},['\u00d7']);
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
    'Exams ', el('span',{class:'nav-caret'},['\u25BE'])
  ]);
  const ddMenu = el('div',{class:'nav-dropdown-menu'});
  ddMenu.appendChild(el('div',{class:'nav-dd-title'},['Practice exams']));
  navExams.forEach(x=>{
    ddMenu.appendChild(authLink('register','nav-dd-item',[
      el('span',{class:'exam-chip-badge', style:`background:${x.color}22;color:${x.color};border:1px solid ${x.color}55;`},[x.label]),
      el('span',{class:'nav-dd-name'},[x.name]),
      el('span',{class:'nav-dd-price'},[priceLabel(x.price)])
    ]));
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
    navButton('Home','top'), dd, navButton('How it works','how'), navButton('About','about'), navButton('Contact','contact')
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
  const hero = el('div',{class:'landing-hero'});
  const heroCopy = el('div',{class:'hero-copy'},[
    el('div',{class:'hero-badge'},['\u2713 Practice before the real exam']),
    el('h1',{class:'hero-title'},[
      'Walk into your certification exam ',
      el('span',{class:'hero-highlight'},['already knowing you\u2019ll pass']),
      '.'
    ]),
    el('p',{class:'hero-sub'},[
      heroSubText()
    ])
  ]);
  const heroCtas = el('div',{class:'hero-ctas'});
  const heroPrimary = authLink('register', 'btn btn-primary hero-btn', ['Get started free']);
  const heroSecondary = authLink('login', 'btn btn-ghost hero-btn', ['I already have an account']);
  heroCtas.appendChild(heroPrimary);
  heroCtas.appendChild(heroSecondary);
  heroCopy.appendChild(heroCtas);
  hero.appendChild(heroCopy);

  // ---- hero visual: an honest mockup of the actual product, not a stock photo ----
  const heroVisual = el('div',{class:'hero-visual'});
  heroVisual.appendChild(renderOrbit());
  hero.appendChild(heroVisual);
  wrap.appendChild(hero);

  // ---- exam strip: real exams and real prices, not fabricated testimonials ----
  const stripWrap = el('div',{class:'exam-strip-wrap', id:'exams'});
  stripWrap.appendChild(el('p',{class:'exam-strip-label'},['Practice for']));
  const strip = el('div',{class:'exam-strip'});
  navExams.forEach(x=>{
    strip.appendChild(el('div',{class:'exam-chip'},[
      el('span',{class:'exam-chip-badge', style:`background:${x.color}22;color:${x.color};border:1px solid ${x.color}55;`},[x.label]),
      el('span',{},[x.name]),
      x.price !== null ? el('span',{class:'exam-chip-price'},[priceLabel(x.price)]) : null
    ]));
  });
  stripWrap.appendChild(strip);
  wrap.appendChild(stripWrap);

  // ---- how it works: every statement here is true of the actual app ----
  function howStep(n, title, text){
    return el('div',{class:'how-step'},[
      el('div',{class:'how-num'},[String(n)]),
      el('h3',{},[title]),
      el('p',{},[text])
    ]);
  }
  const howTexts = howStepTexts();
  wrap.appendChild(el('div',{class:'landing-section', id:'how'},[
    el('h2',{class:'section-title'},['How it works']),
    el('div',{class:'how-grid'},[
      howStep(1, 'Pick a certification', howTexts.one),
      howStep(2, 'Take timed practice sets', howTexts.two),
      howStep(3, 'Review and improve', 'Get your score and a full answer breakdown the moment you submit, and track every attempt under My results.')
    ])
  ]));

  // ---- about ----
  wrap.appendChild(el('div',{class:'landing-section', id:'about'},[
    el('h2',{class:'section-title'},['About CertBench']),
    el('div',{class:'about-copy'}, aboutParagraphs().map(t => el('p',{},[t])))
  ]));

  // ---- contact us (edited in the admin panel) ----
  const ci = contactInfo();
  wrap.appendChild(el('div',{class:'landing-section', id:'contact'},[
    el('h2',{class:'section-title'},['Contact us']),
    el('div',{class:'contact-grid'},[
      contactCard(ICON_PIN,   'Address',        el('p',{},[ci.address])),
      contactCard(ICON_PHONE, 'Phone',          ci.phoneHref ? el('a',{href:ci.phoneHref},[ci.phone]) : el('p',{},[ci.phone])),
      contactCard(ICON_MAIL,  'E-mail Address', ci.emailHref ? el('a',{href:ci.emailHref},[ci.email]) : el('p',{},[ci.email]))
    ])
  ]));

  wrap.appendChild(el('footer',{class:'app-foot'},['CertBench \u2014 practice mock exams. Not affiliated with Microsoft, AWS, Google, or the Cloud Native Computing Foundation.']));

  return wrap;
}

function renderAuthVisual(){
  const panel = el('div',{class:'auth-visual-col'});
  panel.appendChild(el('div',{class:'auth-visual-brand'},[
    brandMark(), brandWord()
  ]));
  panel.appendChild(el('div',{class:'auth-visual-tagline'},['Practice mock exams. Walk in ready.']));
  panel.appendChild(el('div',{class:'auth-visual-features'},[
    landingFacts().n ? el('div',{},[plural(landingFacts().n, 'IT certification') + ' to practice']) : null,
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
  const passField = el('div',{class:'field'},[ el('label',{for:'password'},['Password']), el('input',{id:'password', autocomplete:'current-password', type:'password'}) ]);
  const noticeDiv = state.loginNotice ? el('div',{class:'login-notice'},[state.loginNotice]) : null;
  const errorDiv = el('div',{class:'login-error'},[state.loginError]);
  const submitBtn = el('button',{class:'btn btn-primary', type:'button'},[state.busy ? 'Signing in\u2026' : 'Sign in']);
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

function renderRegister(){
  const wrap = el('div',{class:'login-wrap'});
  const formCol = el('div',{class:'auth-form-col'});
  const card = el('div',{class:'login-card'},[
    el('div',{class:'login-eyebrow'},['Create account']),
    el('h1',{},['Register for CertBench']),
    el('p',{class:'sub'},["We\u2019ll email a one-time code to this address each time you sign in."]),
  ]);

  const form = el('div',{});
  [
    ['reg-name','Full name','text','name'],
    ['reg-email','Email address','email','email'],
    ['reg-mobile','Mobile number (10 digits)','tel','tel'],
    ['reg-username','Choose a username','text','username'],
    ['reg-password','Choose a password (min 6 chars, letters + numbers)','password','new-password'],
    ['reg-confirm','Confirm password','password','new-password']
  ].forEach(([id,label,type,auto])=>{
    form.appendChild(el('div',{class:'field'},[ el('label',{for:id},[label]), el('input',{id, type, autocomplete:auto}) ]));
  });

  // Restrict the mobile field to digits only, capped at 10, as the user types.
  const mobileInput = form.querySelector('#reg-mobile');
  mobileInput.setAttribute('inputmode', 'numeric');
  mobileInput.setAttribute('maxlength', '10');
  mobileInput.addEventListener('input', function(){
    this.value = this.value.replace(/\D/g, '').slice(0, 10);
  });

  const errorDiv = el('div',{class:'login-error'},[state.registerError]);
  form.appendChild(errorDiv);
  const submitBtn = el('button',{class:'btn btn-primary', type:'button'},[state.busy ? 'Creating\u2026' : 'Create account']);
  if(state.busy) submitBtn.setAttribute('disabled','disabled');
  form.appendChild(submitBtn);

  function val(id){ const e = document.getElementById(id); return e ? e.value.trim() : ''; }

  const NAME_RE = /^[a-zA-Z][a-zA-Z .'-]{1,79}$/;
  const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

  submitBtn.addEventListener('click', async ()=>{
    if(state.busy) return;
    const name = val('reg-name'), email = val('reg-email'), mobile = val('reg-mobile'), username = val('reg-username');
    const password = document.getElementById('reg-password').value;
    const confirm = document.getElementById('reg-confirm').value;

    if(!name || !email || !mobile || !username || !password || !confirm){
      state.registerError = 'Please fill in every field.'; render(); return;
    }
    if(!NAME_RE.test(name)){
      state.registerError = 'Enter a valid name (letters only, 2-80 characters).'; render(); return;
    }
    if(!EMAIL_RE.test(email)){
      state.registerError = 'Enter a valid email address.'; render(); return;
    }
    if(mobile.length !== 10){
      state.registerError = 'Mobile number must be exactly 10 digits.'; render(); return;
    }
    if(!/^[6-9]/.test(mobile)){
      state.registerError = 'Enter a valid Indian mobile number (must start with 6, 7, 8, or 9).'; render(); return;
    }
    if(username.length < 3 || username.length > 32 || !/^[a-zA-Z0-9_.]+$/.test(username)){
      state.registerError = 'Username must be 3-32 characters: letters, numbers, dot or underscore.'; render(); return;
    }
    if(password.length < 6){
      state.registerError = 'Password must be at least 6 characters.'; render(); return;
    }
    if(!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)){
      state.registerError = 'Password must include at least one letter and one number.'; render(); return;
    }
    if(password !== confirm){ state.registerError = 'Passwords do not match.'; render(); return; }

    state.busy = true; state.registerError=''; render();
    try{
      await api('/auth/register', { method:'POST', body:{ name, email, mobile, username, password } });
      state.busy = false;
      state.registerError = '';
      state.loginError = '';
      state.loginNotice = 'Account created. Sign in with your new username and password.';
      state.screen = 'login';
      render();
    }catch(err){
      state.busy = false;
      state.registerError = err.message || 'Could not create your account.';
      render();
    }
  });

  card.appendChild(form);
  const switchRow = el('p',{class:'auth-switch'},['Already registered? ']);
  const switchLink = el('button',{class:'link-btn', type:'button'},['Sign in']);
  switchLink.addEventListener('click', ()=>{ state.registerError=''; state.screen='login'; render(); });
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
    el('div',{class:'login-eyebrow'},['Verify it\u2019s you']),
    el('h1',{},['Enter your one-time code']),
    el('p',{class:'sub'},[`We sent a 6-digit code to ${state.emailMasked}.`]),
  ]);

  if(state.devOtp){
    card.appendChild(el('div',{class:'otp-demo'},[
      el('div',{class:'otp-demo-label'},['No email provider is configured on this server']),
      el('div',{class:'otp-demo-sub'},['Set EMAIL_USER / EMAIL_PASS (a Gmail address + app password) on the server to send real emails. Until then, here\u2019s the code so you can keep testing:']),
      el('div',{class:'otp-demo-code'},[state.devOtp])
    ]));
  }

  const form = el('div',{});
  const otpField = el('div',{class:'field'},[ el('label',{for:'otp-input'},['One-time code']), el('input',{id:'otp-input', type:'text', inputmode:'numeric', maxlength:'6', autocomplete:'one-time-code'}) ]);
  form.appendChild(otpField);
  const errorDiv = el('div',{class:'login-error'},[state.otpError]);
  form.appendChild(errorDiv);
  const verifyBtn = el('button',{class:'btn btn-primary', type:'button'},[state.busy ? 'Verifying\u2026' : 'Verify and sign in']);
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
  return '\u20B9' + (paise/100).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

let razorpayScriptPromise = null;

let lastCelebratedAttemptId = null;
function celebrateSuccess(attemptId){
  if(lastCelebratedAttemptId === attemptId) return; // don't re-burst on every re-render of the same result
  lastCelebratedAttemptId = attemptId;

  const colors = ['#4257c4', '#8a9cf0', '#5cb88f', '#d2a15a', '#c9cfdc'];
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
      // No real gateway configured on the server yet \u2014 enrollment was
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
    el('p',{class:'sub'},['Enter the email on your account and we\u2019ll send a reset code.']),
  ]);

  const form = el('div',{});
  const emailField = el('div',{class:'field'},[ el('label',{for:'forgot-email'},['Email address']), el('input',{id:'forgot-email', type:'email', autocomplete:'email'}) ]);
  form.appendChild(emailField);
  const errorDiv = el('div',{class:'login-error'},[state.forgotError]);
  form.appendChild(errorDiv);
  const submitBtn = el('button',{class:'btn btn-primary', type:'button'},[state.busy ? 'Sending\u2026' : 'Send reset code']);
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
      el('div',{class:'otp-demo-sub'},['Here\u2019s the code so you can keep testing:']),
      el('div',{class:'otp-demo-code'},[state.resetOtp])
    ]));
  }

  const form = el('div',{});
  const codeField = el('div',{class:'field'},[ el('label',{for:'reset-code'},['Reset code']), el('input',{id:'reset-code', type:'text', inputmode:'numeric', maxlength:'6'}) ]);
  const pwField = el('div',{class:'field'},[ el('label',{for:'reset-newpw'},['New password (min 6 chars, letters + numbers)']), el('input',{id:'reset-newpw', type:'password', autocomplete:'new-password'}) ]);
  const pwConfirmField = el('div',{class:'field'},[ el('label',{for:'reset-newpw2'},['Confirm new password']), el('input',{id:'reset-newpw2', type:'password', autocomplete:'new-password'}) ]);
  form.appendChild(codeField);
  form.appendChild(pwField);
  form.appendChild(pwConfirmField);

  const errorDiv = el('div',{class:'login-error'},[state.resetError]);
  form.appendChild(errorDiv);
  const submitBtn = el('button',{class:'btn btn-primary', type:'button'},[state.busy ? 'Updating\u2026' : 'Reset password']);
  if(state.busy) submitBtn.setAttribute('disabled','disabled');
  form.appendChild(submitBtn);

  async function attemptReset(){
    if(state.busy) return;
    const code = document.getElementById('reset-code').value.trim();
    const pw = document.getElementById('reset-newpw').value;
    const pw2 = document.getElementById('reset-newpw2').value;
    if(!code){ state.resetError = 'Enter the 6-digit code.'; render(); return; }
    if(pw.length < 6){ state.resetError = 'Password must be at least 6 characters.'; render(); return; }
    if(!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)){ state.resetError = 'Password must include at least one letter and one number.'; render(); return; }
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

  const searchWrap = el('div',{class:'search-wrap'});
  const searchInput = el('input',{
    type:'text', class:'search-input',
    placeholder:'Search exams by name, e.g. "Azure", "AWS", "Kubernetes"\u2026',
    value: state.examSearch || ''
  });
  searchInput.addEventListener('input', function(){
    state.examSearch = this.value;
    renderExamGrid();
  });
  searchWrap.appendChild(searchInput);
  wrap.appendChild(searchWrap);

  const gridHolder = el('div',{});
  wrap.appendChild(gridHolder);

  function renderExamGrid(){
    gridHolder.innerHTML = '';
    const q = (state.examSearch || '').trim().toLowerCase();
    const filtered = !q ? state.exams : state.exams.filter(bank =>
      bank.name.toLowerCase().includes(q) || bank.description.toLowerCase().includes(q) || bank.short_label.toLowerCase().includes(q)
    );

    if(!filtered.length){
      gridHolder.appendChild(el('p',{class:'no-results'},[`No exams match "${state.examSearch}".`]));
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
        ? el('button',{class:'btn btn-primary'},['Choose a practice set'])
        : el('button',{class:'btn btn-primary', disabled: isBusy?'disabled':undefined},[isBusy ? 'Starting\u2026' : `Enroll \u2014 ${formatRupees(bank.price_inr_paise)}`]);

      actionBtn.addEventListener('click', ()=>{
        if(isEnrolled) loadSets(bank.slug);
        else enrollInExam(bank.slug);
      });

      const card = el('div',{class:'cert-card'},[
        el('div',{class:'cert-top-row'},[
          el('div',{class:'cert-badge', style:`background:${bank.color}22; color:${bank.color}; border:1px solid ${bank.color}55;`},[bank.short_label]),
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
        isEnrolled && isPaid ? el('div',{class:'enrolled-tag'},['\u2713 Enrolled']) : null,
        actionBtn
      ]);
      grid.appendChild(card);
    });
    gridHolder.appendChild(grid);
  }

  renderExamGrid();
  return wrap;
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

  const backBtn = el('button',{class:'btn btn-ghost', style:'margin-bottom:1.25rem;'},['\u2190 Back to exams']);
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
    },[isLocked ? '\uD83D\uDD12 Locked' : (s.attemptCount > 0 ? 'Retake this set' : 'Start this set')]);
    if(!isLocked){
      startBtn.addEventListener('click', ()=> startExam(state.setsExamSlug, s.setNumber));
    }

    const card = el('div',{class:'cert-card'+(isLocked ? ' locked-card' : '')},[
      el('div',{class:'cert-top-row'},[
        el('div',{class:'cert-badge', style:`background:${meta.color}22; color:${meta.color}; border:1px solid ${meta.color}55;`},[`S${s.setNumber}`]),
      ]),
      el('h3',{class:'cert-name'},[`Set ${s.setNumber}`]),
      el('div',{class:'cert-meta'},[
        el('span',{},[el('b',{},[String(s.questionCount)]), 'questions']),
        el('span',{},[el('b',{},[s.bestScorePct!==null ? s.bestScorePct+'%' : '\u2014']), 'best score']),
        el('span',{},[el('b',{},[String(s.attemptCount)]), s.attemptCount===1 ? 'attempt' : 'attempts'])
      ]),
      isLocked ? el('p',{class:'lock-note'},[`Pass Set ${s.setNumber-1} (score \u2265 ${meta.passPct}%) to unlock this set.`]) : null,
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
  if(!iso) return '\u2014';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  if(isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' }) + ' '
       + d.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
}

function renderHistory(){
  const wrap = el('div',{class:'select-wrap'});

  const backBtn = el('button',{class:'btn btn-ghost', style:'margin-bottom:1.25rem;'},['\u2190 Back to exams']);
  backBtn.addEventListener('click', ()=>{ state.screen='select'; render(); });
  wrap.appendChild(backBtn);

  wrap.appendChild(el('div',{class:'select-head'},[
    el('h1',{},['My results']),
    el('p',{},['Every completed attempt across every exam and practice set, most recent first.'])
  ]));

  if(!state.myAttempts.length){
    wrap.appendChild(el('p',{class:'no-results'},['You haven\u2019t completed any exams yet. Once you finish one, it\u2019ll show up here.']));
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
        el('span',{class:'history-badge', style:`background:${a.color}22;color:${a.color};border:1px solid ${a.color}55;`},[a.shortLabel]),
        el('span',{},[a.examName, ' \u2014 Set ', String(a.setNumber)])
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
    el('div',{class:'exam-title'},['Now taking ', el('b',{},[bank.name]), state.examSetNumber ? ` \u2014 Set ${state.examSetNumber}` : '']),
    el('div',{class:`timer${state.secondsLeft<=60?' warn':''}`},[ el('span',{class:'dot'}), el('span',{class:'time-label'},[fmtTime(state.secondsLeft)]) ])
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

  const exitBtn = el('button',{class:'btn btn-ghost', style:'width:100%;margin-top:.6rem;color:var(--danger);border-color:var(--danger);'},['Exit exam']);
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
  const ok = window.confirm('Exit this exam? Your progress on this set won\u2019t be saved, and you can start it again later.');
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
    el('div',{class:'exam-title'},['Reviewing ', el('b',{},[bank.name]), state.examSetNumber ? ` \u2014 Set ${state.examSetNumber}` : '']),
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
  const backBtn = el('button',{class:'btn btn-ghost'},['\u2190 Back to exam']);
  backBtn.addEventListener('click', ()=>{ state.screen='exam'; render(); });
  const exitBtn = el('button',{class:'btn btn-ghost', style:'color:var(--danger);border-color:var(--danger);'},['Exit exam']);
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
  fg.setAttribute('stroke-linecap','round');
  fg.setAttribute('stroke-dasharray', `${dash} ${circumference}`);
  svg.appendChild(bg); svg.appendChild(fg);

  const ring = el('div',{class:'score-ring'},[svg, el('div',{class:'pct'},[pct+'%'])]);
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
  wrap.appendChild(el('div',{class:'score-panel'},[ring, info]));

  wrap.appendChild(el('div',{class:'review-head'},[ el('h3',{},['Answer breakdown']) ]));
  r.detail.forEach((d,i)=>{
    const item = el('div',{class:'review-item '+(d.isCorrect?'correct':'incorrect')});
    item.appendChild(el('p',{class:'review-q'},[`${i+1}. ${d.text}`]));
    const yourText = (d.selectedIndex===null||d.selectedIndex===undefined) ? 'No answer selected' : d.options[d.selectedIndex];
    item.appendChild(el('div',{class:'review-row your '+(d.isCorrect?'right':'wrong')},[
      el('span',{class:'lbl'},['Your answer']), el('span',{},[yourText, d.isCorrect ? '  \u2713' : '  \u2717'])
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
    results:null, myAttempts:[], examSearch:'',
    resetToken:null, resetEmail:'', resetError:'', resetOtp:null, forgotError:'', forgotNotice:'',
    loginError:'', loginNotice:'', otpError:'', registerError:''
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

(function(){
'use strict';

var TOKEN_KEY = 'certbench-token';
var root = document.getElementById('adm-root');
try{ var savedTheme = localStorage.getItem('certbench-theme'); if(savedTheme) document.documentElement.setAttribute('data-theme', savedTheme); }catch(e){}

// ---------------------------------------------------------------- tiny helpers
// Everything is built with text nodes (never innerHTML), so nothing typed into the panel
// or stored in the database can ever be interpreted as markup.
function el(tag, attrs, children){
  var node = document.createElement(tag);
  var pendingValue;
  if(attrs){
    Object.keys(attrs).forEach(function(k){
      var v = attrs[k];
      if(v === undefined || v === null || v === false) return;
      if(k === 'class') node.className = v;
      else if(k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if(k === 'value') pendingValue = v;
      else if(k === 'checked') node.checked = true;
      else if(k === 'disabled') node.disabled = true;
      else node.setAttribute(k, v === true ? '' : String(v));
    });
  }
  (children || []).forEach(function(c){
    if(c === null || c === undefined || c === false) return;
    node.appendChild((typeof c === 'string' || typeof c === 'number') ? document.createTextNode(String(c)) : c);
  });
  if(pendingValue !== undefined) node.value = pendingValue;   // after children, so <select> can find its option
  return node;
}

// CertBench logo with an "Admin" label (same mark as the main site)
function brandLogo(){
  return el('div', { class: 'brand', role: 'img', 'aria-label': 'CertBench Admin' }, [
    el('img', { class: 'brand-mark', src: '/logo-mark.svg', alt: '', width: '28', height: '28' }),
    el('span', { class: 'brand-word' }, [ el('strong', {}, ['Cert']), 'Bench', el('span', { class: 'brand-suffix' }, [' Admin']) ])
  ]);
}
function clear(node){ while(node.firstChild) node.removeChild(node.firstChild); }
function getToken(){ try{ return localStorage.getItem(TOKEN_KEY); }catch(e){ return null; } }
function rupees(n){ return n > 0 ? '₹' + Number(n).toLocaleString('en-IN') : 'Free'; }

function api(path, opts){
  opts = opts || {};
  var headers = { 'Content-Type': 'application/json' };
  var t = getToken();
  if(t) headers.Authorization = 'Bearer ' + t;
  return fetch('/api/admin' + path, {
    method: opts.method || 'GET', headers: headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  }).then(function(res){
    return res.json().catch(function(){ return null; }).then(function(data){
      if(!res.ok){
        var err = new Error((data && data.error) || ('Request failed (' + res.status + ')'));
        err.status = res.status; err.data = data;
        throw err;
      }
      return data;
    });
  });
}

var toastTimer = null;
function toast(msg, type){
  var box = document.getElementById('adm-toast');
  if(!box){ box = el('div', { id: 'adm-toast', role: 'status' }); document.body.appendChild(box); }
  box.className = 'adm-toast adm-toast-' + (type || 'ok');
  box.textContent = msg;
  box.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ box.style.display = 'none'; }, 7000);
}

// Runs an action; turns "not signed in / not an admin / server error" into the right screen or message.
function guard(promise){
  return promise.catch(function(err){
    if(err && err.status === 401) return renderGate('expired');
    if(err && err.status === 403) return renderGate('notadmin');
    toast((err && err.message) || 'Something went wrong.', 'err');
  });
}

// ---------------------------------------------------------------- state
var S = {
  view: 'overview',            // overview | exams | exam | exam-new | settings
  overview: null, exams: [], exam: null, questions: [], settings: null,
  setFilter: 'all', search: '', editingQ: null, showAdd: false, showImport: false, meName: '',
  users: null, userQuery: '', userDetail: null,
  reviews: null, reviewFilter: 'pending'
};

// ---------------------------------------------------------------- gate (not signed in / not an admin)
function renderGate(kind){
  clear(root);
  var msgs = {
    signin:  ['Sign in to continue', 'The admin panel uses your normal CertBench login. Sign in on the main site with an admin account, then come back to this page.'],
    expired: ['Your session has ended', 'Please sign in again on the main site, then reload this page.'],
    notadmin:['This account is not an admin', 'Only accounts that have been given admin access can use this page.']
  };
  var m = msgs[kind];
  var card = el('div', { class: 'adm-gate' }, [
    brandLogo(),
    el('h1', {}, [m[0]]),
    el('p', {}, [m[1]])
  ]);
  if(kind === 'notadmin'){
    card.appendChild(el('p', { class: 'adm-hint' }, ['The site owner can grant access by running this command on the server (replace the name with the account’s username):']));
    card.appendChild(el('code', { class: 'adm-code' }, ['npm run make-admin -- username']));
  }
  card.appendChild(el('div', { class: 'adm-gate-actions' }, [
    el('a', { class: 'btn btn-primary', href: '/#login' }, ['Go to sign in']),
    el('a', { class: 'btn btn-ghost', href: '/' }, ['Back to the site'])
  ]));
  root.appendChild(card);
}

// ---------------------------------------------------------------- layout
function header(){
  function tab(view, label, activeViews){
    var active = activeViews.indexOf(S.view) !== -1;
    return el('button', { class: 'adm-tab' + (active ? ' active' : ''), type: 'button', onclick: function(){ navigate(view); } }, [label]);
  }
  return el('header', { class: 'adm-top' }, [
    brandLogo(),
    el('nav', { class: 'adm-nav', 'aria-label': 'Admin sections' }, [
      tab('overview', 'Overview', ['overview']),
      tab('exams', 'Certificates', ['exams', 'exam', 'exam-new']),
      tab('users', 'Users', ['users', 'user', 'user-new']),
      tab('reviews', 'Reviews', ['reviews']),
      tab('settings', 'Site settings', ['settings'])
    ]),
    el('div', { class: 'adm-top-right' }, [
      S.meName ? el('span', { class: 'adm-who' }, [S.meName]) : null,
      el('a', { class: 'btn btn-ghost adm-small', href: '/' }, ['← Back to site'])
    ])
  ]);
}

function renderApp(){
  clear(root);
  root.appendChild(header());
  var main = el('main', { class: 'adm-main' });
  if(S.view === 'overview') main.appendChild(viewOverview());
  else if(S.view === 'exams') main.appendChild(viewExams());
  else if(S.view === 'exam-new') main.appendChild(viewExamNew());
  else if(S.view === 'exam') main.appendChild(viewExam());
  else if(S.view === 'settings') main.appendChild(viewSettings());
  else if(S.view === 'users') main.appendChild(viewUsers());
  else if(S.view === 'user') main.appendChild(viewUser());
  else if(S.view === 'user-new') main.appendChild(viewUserNew());
  else if(S.view === 'reviews') main.appendChild(viewReviews());
  root.appendChild(main);
}

function navigate(view){
  return guard((function(){
    if(view === 'overview') return api('/overview').then(function(d){ S.overview = d; S.view = 'overview'; renderApp(); });
    if(view === 'exams') return api('/exams').then(function(d){ S.exams = d.exams; S.view = 'exams'; renderApp(); });
    if(view === 'settings') return Promise.all([api('/settings'), api('/photos')]).then(function(r){ S.settings = r[0].settings; S.photos = r[1]; S.view = 'settings'; renderApp(); });
    if(view === 'exam-new'){ S.view = 'exam-new'; renderApp(); return Promise.resolve(); }
    if(view === 'users') return loadUsers(1).then(function(){ S.view = 'users'; renderApp(); });
    if(view === 'user-new'){ S.view = 'user-new'; renderApp(); return Promise.resolve(); }
    if(view === 'reviews') return loadReviews().then(function(){ S.view = 'reviews'; renderApp(); });
    return Promise.resolve();
  })());
}

function openExam(id){
  return guard(Promise.all([ api('/exams/' + id), api('/exams/' + id + '/questions') ]).then(function(r){
    S.exam = r[0].exam; S.questions = r[1].questions;
    S.setFilter = 'all'; S.search = ''; S.editingQ = null; S.showAdd = false; S.showImport = false;
    S.view = 'exam'; renderApp();
  }));
}

// ---------------------------------------------------------------- overview
function viewOverview(){
  var c = S.overview.counts;
  var cards = [
    ['Students', c.users], ['Active now (' + S.overview.activeWindowMinutes + ' min)', c.activeUsers],
    ['Certificates live', c.examsLive], ['Hidden / draft', c.examsHidden],
    ['Questions', c.questions], ['Completed attempts', c.attemptsCompleted],
    ['Paid enrolments', c.paidEnrollments], ['Revenue', '₹' + Number(c.revenueInr).toLocaleString('en-IN')],
    ['Reviews to approve', c.reviewsPending || 0]
  ];
  var wrap = el('div', {});
  wrap.appendChild(el('h1', { class: 'adm-h1' }, ['Overview']));
  wrap.appendChild(el('div', { class: 'adm-stats' }, cards.map(function(x){
    return el('div', { class: 'adm-stat' }, [ el('div', { class: 'adm-stat-num' }, [String(x[1])]), el('div', { class: 'adm-stat-label' }, [x[0]]) ]);
  })));
  wrap.appendChild(el('div', { class: 'adm-card' }, [
    el('h2', {}, ['How to add a new certificate']),
    el('ol', { class: 'adm-steps' }, [
      el('li', {}, [ el('b', {}, ['Certificates → Add certificate. ']), 'Give it a name, badge, price and pass mark. It starts hidden (a draft).' ]),
      el('li', {}, [ el('b', {}, ['Add questions. ']), 'One at a time, or paste/upload a CSV to add many at once. Every one of the 5 sets needs at least one question.' ]),
      el('li', {}, [ el('b', {}, ['Publish. ']), 'It appears on the website straight away. You can hide it again at any time.' ])
    ])
  ]));
  var rows = S.overview.recentActivity;
  wrap.appendChild(el('div', { class: 'adm-card' }, [
    el('h2', {}, ['Recent admin activity']),
    rows.length ? el('div', { class: 'adm-table-wrap' }, [ el('table', { class: 'adm-table' }, [
      el('thead', {}, [ el('tr', {}, ['When (UTC)', 'Who', 'What', 'Details'].map(function(h){ return el('th', {}, [h]); })) ]),
      el('tbody', {}, rows.map(function(r){
        return el('tr', {}, [ el('td', {}, [r.created_at]), el('td', {}, [r.username || '']), el('td', {}, [r.action]), el('td', {}, [r.detail || '']) ]);
      }))
    ]) ]) : el('p', { class: 'adm-hint' }, ['Nothing yet. Changes you make here are logged.'])
  ]));
  return wrap;
}

// ---------------------------------------------------------------- certificates list
function statusPill(exam){
  return el('span', { class: 'adm-pill ' + (exam.active ? 'adm-pill-live' : 'adm-pill-off') }, [exam.active ? 'Live' : 'Hidden']);
}
function badge(exam){
  return el('span', { class: 'exam-chip-badge', style: 'background:' + exam.color + '22;color:' + exam.color + ';border:1px solid ' + exam.color + '55;' }, [exam.shortLabel]);
}
function viewExams(){
  var wrap = el('div', {});
  wrap.appendChild(el('div', { class: 'adm-row-between' }, [
    el('h1', { class: 'adm-h1' }, ['Certificates']),
    el('button', { class: 'btn btn-primary', type: 'button', onclick: function(){ navigate('exam-new'); } }, ['+ Add certificate'])
  ]));
  wrap.appendChild(el('div', { class: 'adm-card adm-table-wrap' }, [ el('table', { class: 'adm-table' }, [
    el('thead', {}, [ el('tr', {}, ['Certificate', 'Price', 'Time / pass', 'Questions per set', 'Status', 'Students', ''].map(function(h){ return el('th', {}, [h]); })) ]),
    el('tbody', {}, S.exams.map(function(e){
      return el('tr', {}, [
        el('td', {}, [ el('div', { class: 'adm-name-cell' }, [ badge(e), el('div', {}, [ el('div', { class: 'adm-strong' }, [e.name]), el('div', { class: 'adm-hint' }, ['/' + e.slug]) ]) ]) ]),
        el('td', {}, [rupees(e.priceInr)]),
        el('td', {}, [e.durationMinutes + ' min · ' + e.passPct + '%']),
        el('td', {}, [ el('span', { class: 'adm-mono' }, [e.setCounts.join(' / ')]), ' (' + e.totalQuestions + ' total)' ]),
        el('td', {}, [statusPill(e)]),
        el('td', {}, [e.paidEnrollments + ' paid · ' + e.attempts + ' attempts']),
        el('td', {}, [ el('button', { class: 'btn btn-ghost adm-small', type: 'button', onclick: function(){ openExam(e.id); } }, ['Manage']) ])
      ]);
    }))
  ]) ]));
  return wrap;
}

// ---------------------------------------------------------------- certificate form (create + edit)
function slugify(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); }

function examFormFields(exam, creating){
  var inputs = {};
  function field(key, label, input, hint){
    return el('div', { class: 'adm-field' }, [
      el('label', {}, [label, input]),
      hint ? el('div', { class: 'adm-hint' }, [hint]) : null,
      el('div', { class: 'adm-err', 'data-for': key })
    ]);
  }
  var e = exam || { name: '', description: '', shortLabel: '', color: '#22c9a3', durationMinutes: 60, passPct: 70, priceInr: 0, slug: '' };
  inputs.name = el('input', { class: 'adm-input', type: 'text', maxlength: '80', value: e.name });
  inputs.description = el('textarea', { class: 'adm-input', rows: '3', maxlength: '300', value: e.description });
  inputs.shortLabel = el('input', { class: 'adm-input adm-narrow', type: 'text', maxlength: '4', value: e.shortLabel });
  inputs.color = el('input', { class: 'adm-color', type: 'color', value: e.color });
  inputs.durationMinutes = el('input', { class: 'adm-input adm-narrow', type: 'number', min: '5', max: '300', step: '1', value: String(e.durationMinutes) });
  inputs.passPct = el('input', { class: 'adm-input adm-narrow', type: 'number', min: '1', max: '100', step: '1', value: String(e.passPct) });
  inputs.priceInr = el('input', { class: 'adm-input adm-narrow', type: 'number', min: '0', max: '100000', step: '0.01', value: String(e.priceInr) });

  var slugField = null;
  if(creating){
    inputs.slug = el('input', { class: 'adm-input', type: 'text', maxlength: '40', value: '' });
    var touched = false;
    inputs.slug.addEventListener('input', function(){ touched = true; });
    inputs.name.addEventListener('input', function(){ if(!touched) inputs.slug.value = slugify(inputs.name.value); });
    slugField = field('slug', 'Short name (used in the address, cannot be changed later)', inputs.slug, 'Lowercase letters, numbers and hyphens, e.g. azure-ai-900');
  } else {
    slugField = el('div', { class: 'adm-field' }, [ el('label', {}, ['Short name']), el('div', { class: 'adm-readonly' }, ['/' + e.slug + '  (cannot be changed)']) ]);
  }

  var preview = el('span', { class: 'exam-chip-badge adm-preview' }, [e.shortLabel || 'AB']);
  function updatePreview(){
    var c = inputs.color.value;
    preview.textContent = inputs.shortLabel.value || 'AB';
    preview.setAttribute('style', 'background:' + c + '22;color:' + c + ';border:1px solid ' + c + '55;');
  }
  inputs.shortLabel.addEventListener('input', updatePreview);
  inputs.color.addEventListener('input', updatePreview);
  updatePreview();

  var node = el('div', { class: 'adm-form' }, [
    field('name', 'Certificate name', inputs.name),
    slugField,
    field('description', 'Description (shown on the exam card)', inputs.description),
    el('div', { class: 'adm-grid2' }, [
      field('shortLabel', 'Badge text (1-4 characters)', inputs.shortLabel, 'Shown in the small coloured badge, e.g. AZ'),
      el('div', { class: 'adm-field' }, [ el('label', {}, ['Badge colour', inputs.color]), el('div', { class: 'adm-hint' }, ['Preview: ', preview]), el('div', { class: 'adm-err', 'data-for': 'color' }) ])
    ]),
    el('div', { class: 'adm-grid3' }, [
      field('durationMinutes', 'Time limit (minutes)', inputs.durationMinutes),
      field('passPct', 'Pass mark (%)', inputs.passPct),
      field('priceInr', 'Price (₹)', inputs.priceInr, '0 = free')
    ])
  ]);

  function num(input){ return input.value.trim() === '' ? null : Number(input.value); }
  return {
    node: node,
    read: function(){
      var body = {
        name: inputs.name.value, description: inputs.description.value, shortLabel: inputs.shortLabel.value,
        color: inputs.color.value, durationMinutes: num(inputs.durationMinutes), passPct: num(inputs.passPct), priceInr: num(inputs.priceInr)
      };
      if(inputs.slug) body.slug = inputs.slug.value;
      return body;
    },
    showErrors: function(fields){
      Array.prototype.forEach.call(node.querySelectorAll('.adm-err'), function(n){ n.textContent = ''; });
      Object.keys(fields || {}).forEach(function(k){
        var n = node.querySelector('.adm-err[data-for="' + k + '"]');
        if(n) n.textContent = fields[k];
      });
    }
  };
}

function viewExamNew(){
  var form = examFormFields(null, true);
  var wrap = el('div', {});
  wrap.appendChild(el('button', { class: 'adm-back', type: 'button', onclick: function(){ navigate('exams'); } }, ['← All certificates']));
  wrap.appendChild(el('h1', { class: 'adm-h1' }, ['Add a certificate']));
  wrap.appendChild(el('div', { class: 'adm-card' }, [
    form.node,
    el('p', { class: 'adm-hint' }, ['It will be created as a hidden draft. Add questions, then publish it when you are ready.']),
    el('div', { class: 'adm-actions' }, [
      el('button', { class: 'btn btn-primary', type: 'button', onclick: function(){
        guard(api('/exams', { method: 'POST', body: form.read() }).then(function(d){
          toast('Created “' + d.exam.name + '” as a draft. Now add its questions.', 'ok');
          return openExam(d.exam.id);
        }).catch(function(err){
          if(err.data && err.data.fields){ form.showErrors(err.data.fields); toast(err.message, 'err'); return; }
          throw err;
        }));
      } }, ['Create certificate']),
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: function(){ navigate('exams'); } }, ['Cancel'])
    ])
  ]));
  return wrap;
}

// ---------------------------------------------------------------- one certificate
function refreshExamData(){
  return Promise.all([ api('/exams/' + S.exam.id), api('/exams/' + S.exam.id + '/questions') ]).then(function(r){
    S.exam = r[0].exam; S.questions = r[1].questions;
  });
}
function replaceQuestionsSection(){
  var old = document.getElementById('adm-questions');
  if(old) old.replaceWith(buildQuestionsSection());
}

function viewExam(){
  var e = S.exam;
  var wrap = el('div', {});
  wrap.appendChild(el('button', { class: 'adm-back', type: 'button', onclick: function(){ navigate('exams'); } }, ['← All certificates']));
  wrap.appendChild(el('div', { class: 'adm-row-between' }, [
    el('div', { class: 'adm-title-row' }, [ badge(e), el('h1', { class: 'adm-h1' }, [e.name]), statusPill(e) ]),
    el('button', { class: e.active ? 'btn btn-ghost' : 'btn btn-primary', type: 'button', onclick: function(){
      guard(api('/exams/' + e.id + '/publish', { method: 'POST', body: { active: !e.active } }).then(function(d){
        S.exam = d.exam; renderApp();
        toast(d.exam.active ? 'Published. Students can see it now.' : 'Hidden. Students can no longer see or start it.', 'ok');
      }));
    } }, [e.active ? 'Hide from students' : 'Publish'])
  ]));

  // details
  var form = examFormFields(e, false);
  wrap.appendChild(el('div', { class: 'adm-card' }, [
    el('h2', {}, ['Details']),
    form.node,
    e.active ? el('p', { class: 'adm-hint' }, ['This certificate is live: changes to price, time limit and pass mark apply to students straight away (attempts already in progress keep going).']) : null,
    el('div', { class: 'adm-actions' }, [
      el('button', { class: 'btn btn-primary', type: 'button', onclick: function(){
        guard(api('/exams/' + e.id, { method: 'PUT', body: form.read() }).then(function(d){
          S.exam = d.exam; renderApp(); toast('Saved.', 'ok');
        }).catch(function(err){
          if(err.data && err.data.fields){ form.showErrors(err.data.fields); toast(err.message, 'err'); return; }
          throw err;
        }));
      } }, ['Save changes'])
    ])
  ]));

  wrap.appendChild(buildQuestionsSection());

  // danger zone
  var confirmInput = el('input', { class: 'adm-input', type: 'text', placeholder: 'Type the certificate name to confirm' });
  var delBtn = el('button', { class: 'btn btn-danger', type: 'button', disabled: true, onclick: function(){
    if(!window.confirm('Permanently delete “' + e.name + '”, its ' + e.totalQuestions + ' questions and ' + e.attempts + ' recorded attempts? This cannot be undone.')) return;
    guard(api('/exams/' + e.id, { method: 'DELETE', body: { confirmName: confirmInput.value } }).then(function(){
      toast('Deleted “' + e.name + '”.', 'ok');
      return navigate('exams');
    }));
  } }, ['Delete permanently']);
  confirmInput.addEventListener('input', function(){ delBtn.disabled = confirmInput.value.trim() !== e.name; });
  wrap.appendChild(el('div', { class: 'adm-card adm-danger' }, [
    el('h2', {}, ['Delete this certificate']),
    e.paidEnrollments > 0
      ? el('p', {}, [e.paidEnrollments + ' student(s) have paid for this certificate, so it cannot be deleted. Use “Hide from students” instead: it disappears from the website, and every payment and result record is kept.'])
      : el('div', {}, [
          el('p', {}, ['This removes the certificate, all ' + e.totalQuestions + ' questions and ' + e.attempts + ' recorded attempts for good. If you just want it off the website for now, use “Hide from students” instead.']),
          confirmInput, delBtn
        ])
  ]));
  return wrap;
}

// ---------------------------------------------------------------- questions
function buildQuestionsSection(){
  var e = S.exam;
  var sec = el('section', { class: 'adm-card', id: 'adm-questions' });
  var counts = e.setCounts;
  var empties = counts.map(function(c, i){ return c === 0 ? i + 1 : null; }).filter(Boolean);
  sec.appendChild(el('h2', {}, ['Questions']));
  sec.appendChild(el('p', { class: 'adm-hint' }, [
    counts.map(function(c, i){ return 'Set ' + (i + 1) + ': ' + c; }).join('   ·   '),
    '.  Students get exactly what is in each set (sets do not have to be the same size).'
  ]));
  if(empties.length) sec.appendChild(el('p', { class: 'adm-warn' }, ['Empty: Set ' + empties.join(', Set ') + '. Every set needs at least one question before this certificate can be published.']));

  // set tabs + search + actions
  var tabs = ['all', 1, 2, 3, 4, 5].map(function(k){
    var label = k === 'all' ? 'All (' + e.totalQuestions + ')' : 'Set ' + k + ' (' + counts[k - 1] + ')';
    return el('button', { class: 'adm-chip' + (S.setFilter === k ? ' active' : ''), type: 'button', onclick: function(){ S.setFilter = k; replaceQuestionsSection(); } }, [label]);
  });
  var search = el('input', { class: 'adm-input adm-search', type: 'search', placeholder: 'Search questions', value: S.search });
  var listHolder = el('div', { class: 'adm-qlist' });
  search.addEventListener('input', function(){ S.search = search.value; fillList(listHolder); });
  sec.appendChild(el('div', { class: 'adm-toolbar' }, [
    el('div', { class: 'adm-chips' }, tabs),
    search,
    el('button', { class: 'btn btn-primary adm-small', type: 'button', onclick: function(){ S.showAdd = !S.showAdd; S.showImport = false; replaceQuestionsSection(); } }, ['+ Add question']),
    el('button', { class: 'btn btn-ghost adm-small', type: 'button', onclick: function(){ S.showImport = !S.showImport; S.showAdd = false; replaceQuestionsSection(); } }, ['Import CSV'])
  ]));
  if(S.showAdd) sec.appendChild(buildAddPanel());
  if(S.showImport) sec.appendChild(buildImportPanel());
  fillList(listHolder);
  sec.appendChild(listHolder);
  return sec;
}

function fillList(holder){
  clear(holder);
  var q = S.search.trim().toLowerCase();
  var rows = S.questions.filter(function(x){
    if(S.setFilter !== 'all' && x.set !== S.setFilter) return false;
    return !q || (x.text + ' ' + x.options.join(' ')).toLowerCase().indexOf(q) !== -1;
  });
  if(!rows.length){
    holder.appendChild(el('p', { class: 'adm-empty' }, [S.questions.length ? 'No questions match.' : 'No questions yet. Add one, or import a CSV.']));
    return;
  }
  var LIMIT = 100;
  rows.slice(0, LIMIT).forEach(function(x){
    holder.appendChild(S.editingQ === x.id ? buildEditForm(x) : buildQuestionRow(x));
  });
  if(rows.length > LIMIT) holder.appendChild(el('p', { class: 'adm-hint' }, ['Showing the first ' + LIMIT + ' of ' + rows.length + '. Use the set tabs or search to narrow it down.']));
}

function buildQuestionRow(x){
  return el('div', { class: 'adm-q' }, [
    el('div', { class: 'adm-q-meta' }, [
      el('span', { class: 'adm-pill' }, ['Set ' + x.set]),
      x.alsoInSets.length ? el('span', { class: 'adm-pill adm-pill-warn', title: 'The same question also appears in another set' }, ['also in Set ' + x.alsoInSets.join(', ')]) : null,
      el('span', { class: 'adm-q-id' }, ['#' + x.id])
    ]),
    el('div', { class: 'adm-q-text' }, [x.text]),
    el('ol', { class: 'adm-q-opts', type: 'A' }, x.options.map(function(o, i){
      return el('li', { class: i === x.correctIndex ? 'correct' : '' }, [o + (i === x.correctIndex ? '  ✓ correct' : '')]);
    })),
    el('div', { class: 'adm-q-actions' }, [
      el('button', { class: 'btn btn-ghost adm-small', type: 'button', onclick: function(){ S.editingQ = x.id; replaceQuestionsSection(); } }, ['Edit']),
      el('button', { class: 'btn btn-danger adm-small', type: 'button', onclick: function(){ removeQuestion(x); } }, ['Delete'])
    ])
  ]);
}

function removeQuestion(x){
  if(!window.confirm('Remove this question from Set ' + x.set + '?\n\n“' + x.text.slice(0, 120) + '”')) return;
  var everywhere = false;
  if(x.alsoInSets.length){
    everywhere = window.confirm('The same question also appears in Set ' + x.alsoInSets.join(', ') + '.\n\nOK = remove it from ALL sets.\nCancel = remove it from Set ' + x.set + ' only.');
  }
  guard(api('/questions/' + x.id + (everywhere ? '?everywhere=1' : ''), { method: 'DELETE' }).then(function(d){
    toast('Removed ' + d.removed + ' question' + (d.removed === 1 ? '' : 's') + '. Anyone already taking that exam keeps the version they were given.', 'ok');
    return refreshExamData();
  }).then(function(){ replaceQuestionsSection(); }));
}

// A question form used both for adding and editing.
function questionFields(q){
  var text = el('textarea', { class: 'adm-input', rows: '3', maxlength: '500', placeholder: 'Type the question', value: q ? q.text : '' });
  var opts = [], radios = [];
  var group = 'correct-' + Math.random().toString(36).slice(2);
  var rows = [0, 1, 2, 3].map(function(i){
    var input = el('input', { class: 'adm-input', type: 'text', maxlength: '200', placeholder: 'Answer ' + 'ABCD'.charAt(i), value: q ? q.options[i] : '' });
    var radio = el('input', { type: 'radio', name: group, value: String(i), checked: q ? q.correctIndex === i : i === 0, 'aria-label': 'Answer ' + 'ABCD'.charAt(i) + ' is correct' });
    opts.push(input); radios.push(radio);
    return el('div', { class: 'adm-opt' }, [ radio, el('span', { class: 'adm-opt-letter' }, ['ABCD'.charAt(i)]), input ]);
  });
  var node = el('div', { class: 'adm-qform' }, [ text ].concat(rows, [ el('div', { class: 'adm-hint' }, ['Select the circle next to the correct answer.']) ]));
  return {
    node: node,
    read: function(){
      var idx = -1; radios.forEach(function(r, i){ if(r.checked) idx = i; });
      return { text: text.value, options: opts.map(function(o){ return o.value; }), correctIndex: idx };
    },
    reset: function(){ text.value = ''; opts.forEach(function(o){ o.value = ''; }); radios.forEach(function(r, i){ r.checked = i === 0; }); text.focus(); }
  };
}

function buildEditForm(x){
  var f = questionFields(x);
  var copies = null;
  if(x.alsoInSets.length){
    copies = el('input', { type: 'checkbox', checked: true });
  }
  return el('div', { class: 'adm-q adm-q-editing' }, [
    el('div', { class: 'adm-q-meta' }, [ el('span', { class: 'adm-pill' }, ['Set ' + x.set]), el('span', { class: 'adm-q-id' }, ['Editing #' + x.id]) ]),
    f.node,
    copies ? el('label', { class: 'adm-check' }, [copies, ' Also apply to the copies in Set ' + x.alsoInSets.join(', ')]) : null,
    el('div', { class: 'adm-q-actions' }, [
      el('button', { class: 'btn btn-primary adm-small', type: 'button', onclick: function(){
        var body = f.read(); body.applyToCopies = copies ? copies.checked : false;
        guard(api('/questions/' + x.id, { method: 'PUT', body: body }).then(function(d){
          toast('Saved' + (d.updated > 1 ? ' (' + d.updated + ' copies updated)' : '') + '.', 'ok');
          S.editingQ = null;
          return refreshExamData();
        }).then(function(){ replaceQuestionsSection(); }));
      } }, ['Save']),
      el('button', { class: 'btn btn-ghost adm-small', type: 'button', onclick: function(){ S.editingQ = null; replaceQuestionsSection(); } }, ['Cancel'])
    ])
  ]);
}

function buildAddPanel(){
  var f = questionFields(null);
  var setSel = el('select', { class: 'adm-input adm-narrow', value: 'auto' }, [
    el('option', { value: 'auto' }, ['Auto (emptiest set)'])
  ].concat([1, 2, 3, 4, 5].map(function(n){ return el('option', { value: String(n) }, ['Set ' + n]); })));
  return el('div', { class: 'adm-panel' }, [
    el('h3', {}, ['Add a question']),
    f.node,
    el('div', { class: 'adm-field' }, [ el('label', {}, ['Put it in', setSel]) ]),
    el('div', { class: 'adm-actions' }, [
      el('button', { class: 'btn btn-primary adm-small', type: 'button', onclick: function(){
        var body = f.read();
        body.set = setSel.value === 'auto' ? 'auto' : Number(setSel.value);
        guard(api('/exams/' + S.exam.id + '/questions', { method: 'POST', body: body }).then(function(d){
          toast('Added to Set ' + d.set + '.', 'ok');
          return refreshExamData().then(function(){ f.reset(); var keep = S.showAdd; replaceQuestionsSection(); S.showAdd = keep; });
        }));
      } }, ['Add question'])
    ])
  ]);
}

var TEMPLATE_CSV = 'question,option_a,option_b,option_c,option_d,correct\n' +
  '"Which AWS service stores objects?","Amazon S3","Amazon EC2","AWS Lambda","Amazon VPC",A\n' +
  '"What does CI stand for in CI/CD?","Continuous Integration","Central Intelligence","Code Inspection","Container Isolation",A\n';

function buildImportPanel(){
  var area = el('textarea', { class: 'adm-input adm-csv', rows: '8', placeholder: 'Paste CSV here, or choose a file below' });
  var file = el('input', { type: 'file', accept: '.csv,.txt,text/csv' });
  file.addEventListener('change', function(){
    var f = file.files && file.files[0];
    if(!f) return;
    var reader = new FileReader();
    reader.onload = function(){ area.value = String(reader.result || ''); };
    reader.readAsText(f);
  });
  var target = el('select', { class: 'adm-input adm-narrow', value: 'spread' }, [
    el('option', { value: 'spread' }, ['Spread evenly across all sets'])
  ].concat([1, 2, 3, 4, 5].map(function(n){ return el('option', { value: String(n) }, ['All into Set ' + n]); })));
  var errBox = el('div', { class: 'adm-import-errors' });

  return el('div', { class: 'adm-panel' }, [
    el('h3', {}, ['Import questions from CSV']),
    el('p', { class: 'adm-hint' }, ['Columns: question, option_a, option_b, option_c, option_d, correct (A, B, C or D). Save from Excel or Google Sheets as CSV. If any row has a problem, nothing is imported and you will see exactly which rows to fix.']),
    el('div', { class: 'adm-hint' }, ['Only add questions you wrote yourself or have the right to use. Copying real exam questions from the certification providers breaks their rules, and this site tells students its questions are original.']),
    el('div', { class: 'adm-actions' }, [
      el('button', { class: 'btn btn-ghost adm-small', type: 'button', onclick: function(){
        try{
          var url = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: 'text/csv' }));
          var a = el('a', { href: url, download: 'certbench-questions-template.csv' });
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
        }catch(e){ area.value = TEMPLATE_CSV; }
      } }, ['Download template'])
    ]),
    file, area,
    el('div', { class: 'adm-field' }, [ el('label', {}, ['Put them in', target]) ]),
    errBox,
    el('div', { class: 'adm-actions' }, [
      el('button', { class: 'btn btn-primary adm-small', type: 'button', onclick: function(){
        clear(errBox);
        api('/exams/' + S.exam.id + '/import', { method: 'POST', body: { csv: area.value, target: target.value } }).then(function(d){
          toast('Imported ' + d.added + ' questions (added per set: ' + d.perSet.join(' / ') + ').', 'ok');
          return refreshExamData().then(function(){ S.showImport = false; replaceQuestionsSection(); });
        }).catch(function(err){
          if(err.status === 401 || err.status === 403) return guard(Promise.reject(err));
          errBox.appendChild(el('p', { class: 'adm-warn' }, [err.message]));
          var list = (err.data && err.data.rowErrors) || [];
          if(list.length){
            errBox.appendChild(el('ul', { class: 'adm-errlist' }, list.map(function(r){ return el('li', {}, ['Row ' + r.row + ': ' + r.message]); })));
            if(err.data.totalErrors > list.length) errBox.appendChild(el('p', { class: 'adm-hint' }, ['…and ' + (err.data.totalErrors - list.length) + ' more.']));
          }
        });
      } }, ['Import'])
    ])
  ]);
}

// ---------------------------------------------------------------- users
function loadUsers(page){
  return api('/users?page=' + (page || 1) + '&q=' + encodeURIComponent(S.userQuery)).then(function(d){ S.users = d; });
}
function rolePill(u){
  if(!u.isAdmin) return el('span', { class: 'adm-pill' }, ['Student']);
  var how = u.adminVia.map(function(v){ return v === 'panel' ? 'panel' : 'ADMIN_EMAILS setting'; }).join(' + ');
  return el('span', { class: 'adm-pill adm-pill-live', title: 'Admin access comes from: ' + how }, ['Admin']);
}
function youTag(u){ return S.users && u.id === S.users.meId ? el('span', { class: 'adm-pill adm-pill-you' }, ['You']) : null; }

function buildUsersTable(){
  var d = S.users;
  var box = el('div', { id: 'adm-users-table' });
  if(!d.users.length){
    box.appendChild(el('p', { class: 'adm-empty' }, [S.userQuery ? 'No users match “' + S.userQuery + '”.' : 'No users yet.']));
    return box;
  }
  box.appendChild(el('div', { class: 'adm-card adm-table-wrap' }, [ el('table', { class: 'adm-table' }, [
    el('thead', {}, [ el('tr', {}, ['Name', 'Email', 'Mobile', 'Joined (UTC)', 'Role', 'Activity', ''].map(function(h){ return el('th', {}, [h]); })) ]),
    el('tbody', {}, d.users.map(function(u){
      return el('tr', {}, [
        el('td', {}, [ el('div', { class: 'adm-strong' }, [u.name, ' ', youTag(u), ' ', u.activeNow ? el('span', { class: 'adm-pill adm-pill-live', title: 'Used the site in the last few minutes' }, ['Active now']) : null]), el('div', { class: 'adm-hint' }, ['@' + u.username]) ]),
        el('td', {}, [u.email]),
        el('td', {}, [u.mobile]),
        el('td', {}, [String(u.createdAt || '').slice(0, 10)]),
        el('td', {}, [rolePill(u)]),
        el('td', {}, [u.paidEnrollments + ' paid · ' + u.attempts + ' attempts']),
        el('td', {}, [ el('button', { class: 'btn btn-ghost adm-small', type: 'button', onclick: function(){ openUser(u.id); } }, ['Manage']) ])
      ]);
    }))
  ]) ]));
  if(d.pages > 1){
    box.appendChild(el('div', { class: 'adm-pager' }, [
      el('button', { class: 'btn btn-ghost adm-small', type: 'button', disabled: d.page <= 1, onclick: function(){ guard(loadUsers(d.page - 1).then(refreshUsersTable)); } }, ['← Previous']),
      el('span', { class: 'adm-hint' }, ['Page ' + d.page + ' of ' + d.pages + '  ·  ' + d.total + ' users']),
      el('button', { class: 'btn btn-ghost adm-small', type: 'button', disabled: d.page >= d.pages, onclick: function(){ guard(loadUsers(d.page + 1).then(refreshUsersTable)); } }, ['Next →'])
    ]));
  }
  return box;
}
function refreshUsersTable(){
  var old = document.getElementById('adm-users-table');
  if(old) old.replaceWith(buildUsersTable());
}

var userSearchTimer = null;
function viewUsers(){
  var wrap = el('div', {});
  wrap.appendChild(el('div', { class: 'adm-row-between' }, [
    el('h1', { class: 'adm-h1' }, ['Users']),
    el('button', { class: 'btn btn-primary', type: 'button', onclick: function(){ navigate('user-new'); } }, ['+ Add user'])
  ]));
  var search = el('input', { class: 'adm-input adm-search adm-user-search', type: 'search', placeholder: 'Search by name, email, username or mobile', value: S.userQuery });
  search.addEventListener('input', function(){
    clearTimeout(userSearchTimer);
    userSearchTimer = setTimeout(function(){
      S.userQuery = search.value.trim();
      guard(loadUsers(1).then(refreshUsersTable));      // only the table is redrawn, so typing isn't interrupted
    }, 300);
  });
  wrap.appendChild(el('div', { class: 'adm-toolbar' }, [ search, el('span', { class: 'adm-hint' }, [S.users.total + ' total']) ]));
  wrap.appendChild(buildUsersTable());
  return wrap;
}

function userFormFields(u, creating){
  var inputs = {
    name: el('input', { class: 'adm-input', type: 'text', maxlength: '80', value: u ? u.name : '' }),
    email: el('input', { class: 'adm-input', type: 'email', maxlength: '254', value: u ? u.email : '' }),
    mobile: el('input', { class: 'adm-input', type: 'tel', maxlength: '14', value: u ? u.mobile : '' }),
    // New accounts: 3-20 letters. Editing allows up to 32 so older usernames still fit.
    username: el('input', { class: 'adm-input', type: 'text', maxlength: creating ? '20' : '32', value: u ? u.username : '' })
  };
  if(creating) inputs.password = el('input', { class: 'adm-input', type: 'text', maxlength: '64', autocomplete: 'new-password', value: '' });
  function f(key, label, hint){
    return el('div', { class: 'adm-field' }, [ el('label', {}, [label, inputs[key]]), hint ? el('div', { class: 'adm-hint' }, [hint]) : null, el('div', { class: 'adm-err', 'data-for': key }) ]);
  }
  var node = el('div', { class: 'adm-form' }, [
    el('div', { class: 'adm-grid2' }, [ f('name', 'Full name'), f('username', 'Username', 'Used to sign in. 3-20 letters; single dots or underscores between letters. No numbers.') ]),
    el('div', { class: 'adm-grid2' }, [ f('email', 'Email', 'Login codes are sent here.'), f('mobile', 'Mobile (10 digits)') ]),
    creating ? f('password', 'Starting password', '8-64 characters with an uppercase letter, a lowercase letter, a number and a special character; must not contain the username. Share it with them privately; they can change it later with “Forgot password?”.') : null
  ]);
  return {
    node: node,
    read: function(){ var b = {}; Object.keys(inputs).forEach(function(k){ b[k] = inputs[k].value; }); return b; },
    showErrors: function(fields){
      Array.prototype.forEach.call(node.querySelectorAll('.adm-err'), function(n){ n.textContent = ''; });
      Object.keys(fields || {}).forEach(function(k){ var n = node.querySelector('.adm-err[data-for="' + k + '"]'); if(n) n.textContent = fields[k]; });
    }
  };
}
function withFieldErrors(form){
  return function(err){
    if(err && err.data && err.data.fields){ form.showErrors(err.data.fields); toast(err.message, 'err'); return; }
    throw err;
  };
}

function viewUserNew(){
  var form = userFormFields(null, true);
  return el('div', {}, [
    el('button', { class: 'adm-back', type: 'button', onclick: function(){ navigate('users'); } }, ['← All users']),
    el('h1', { class: 'adm-h1' }, ['Add a user']),
    el('div', { class: 'adm-card' }, [
      form.node,
      el('p', { class: 'adm-hint' }, ['They join as a normal student. You can make them an admin afterwards.']),
      el('div', { class: 'adm-actions' }, [
        el('button', { class: 'btn btn-primary', type: 'button', onclick: function(){
          guard(api('/users', { method: 'POST', body: form.read() }).then(function(d){
            toast('Added ' + d.user.name + ' (@' + d.user.username + ').', 'ok');
            return openUser(d.user.id);
          }).catch(withFieldErrors(form)));
        } }, ['Add user']),
        el('button', { class: 'btn btn-ghost', type: 'button', onclick: function(){ navigate('users'); } }, ['Cancel'])
      ])
    ])
  ]);
}

function openUser(id){
  return guard(api('/users/' + id).then(function(d){ S.userDetail = d; S.view = 'user'; renderApp(); }));
}

function viewUser(){
  var D = S.userDetail, u = D.user;
  var wrap = el('div', {});
  wrap.appendChild(el('button', { class: 'adm-back', type: 'button', onclick: function(){ navigate('users'); } }, ['← All users']));
  wrap.appendChild(el('div', { class: 'adm-title-row' }, [
    el('h1', { class: 'adm-h1' }, [u.name]), rolePill(u), D.isSelf ? el('span', { class: 'adm-pill adm-pill-you' }, ['You']) : null
  ]));
  wrap.appendChild(el('p', { class: 'adm-hint' }, ['@' + u.username + '  ·  joined ' + String(u.createdAt || '').slice(0, 10) + '  ·  ' + u.paidEnrollments + ' paid enrolment(s)' + (u.paidTotalInr ? ' (' + rupees(u.paidTotalInr) + ')' : '') + '  ·  ' + u.attempts + ' completed attempt(s)']));

  // ---- details
  var form = userFormFields(u, false);
  wrap.appendChild(el('div', { class: 'adm-card' }, [
    el('h2', {}, ['Details']),
    form.node,
    el('div', { class: 'adm-actions' }, [
      el('button', { class: 'btn btn-primary', type: 'button', onclick: function(){
        guard(api('/users/' + u.id, { method: 'PUT', body: form.read() }).then(function(d){
          S.userDetail.user = d.user; renderApp();
          toast(d.adminChanged ? 'Saved. Note: the new email changed their admin access (ADMIN_EMAILS setting).' : 'Saved.', 'ok');
        }).catch(withFieldErrors(form)));
      } }, ['Save changes'])
    ])
  ]));

  // ---- admin access
  var viaPanel = u.adminVia.indexOf('panel') !== -1, viaSetting = u.adminVia.indexOf('ADMIN_EMAILS') !== -1;
  var adminCard = el('div', { class: 'adm-card' }, [ el('h2', {}, ['Admin access']) ]);
  if(!u.isAdmin){
    adminCard.appendChild(el('p', {}, ['This is a normal student account. Admins can manage certificates, questions, site settings and all users, including other admins.']));
    adminCard.appendChild(el('button', { class: 'btn btn-ghost', type: 'button', onclick: function(){
      if(!window.confirm('Make ' + u.name + ' (@' + u.username + ') an admin? They will be able to change everything in this panel, including removing other admins.')) return;
      setAdmin(u, true);
    } }, ['Make admin']));
  } else {
    adminCard.appendChild(el('p', {}, [
      'This account is an admin' + (viaPanel && viaSetting ? ', granted both here in the panel and through the ADMIN_EMAILS setting.' : viaPanel ? ' (granted here in the panel or with make-admin).' : ' through the ADMIN_EMAILS setting in your host’s dashboard.')
    ]));
    if(viaSetting) adminCard.appendChild(el('p', { class: 'adm-warn' }, ['To fully remove admin access, also delete ' + u.email + ' from ADMIN_EMAILS in your host’s dashboard and redeploy. It can’t be changed from here.']));
    if(D.isSelf) adminCard.appendChild(el('p', { class: 'adm-hint' }, ['You can’t remove your own admin access, so nobody gets locked out by accident. Ask another admin if you want it removed.']));
    else if(viaPanel) adminCard.appendChild(el('button', { class: 'btn btn-danger', type: 'button', onclick: function(){
      if(!window.confirm('Remove admin access from ' + u.name + '? They stay signed in as a normal student and lose the admin panel on their next click.')) return;
      setAdmin(u, false);
    } }, ['Remove admin access']));
  }
  wrap.appendChild(adminCard);

  // ---- password + sessions
  var pw = el('input', { class: 'adm-input adm-narrow', type: 'text', maxlength: '64', autocomplete: 'new-password', placeholder: 'New password' });
  var pwErr = el('div', { class: 'adm-err' });
  wrap.appendChild(el('div', { class: 'adm-card' }, D.isSelf ? [
    el('h2', {}, ['Password and sign-ins']),
    el('p', { class: 'adm-hint' }, ['To change your own password, sign out and use “Forgot password?” on the sign-in page.'])
  ] : [
    el('h2', {}, ['Password and sign-ins']),
    el('p', {}, ['Set a new password if they are locked out. This also signs them out on every device.']),
    el('div', { class: 'adm-inline' }, [ pw,
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: function(){
        pwErr.textContent = '';
        if(!window.confirm('Set a new password for ' + u.name + ' and sign them out everywhere?')) return;
        api('/users/' + u.id + '/password', { method: 'POST', body: { password: pw.value } }).then(function(){
          pw.value = ''; toast('Password changed and ' + u.name + ' signed out everywhere. Share the new password with them privately.', 'ok');
        }).catch(function(e){ if(e.status === 400){ pwErr.textContent = e.message; return; } guard(Promise.reject(e)); });
      } }, ['Set new password'])
    ]),
    pwErr,
    el('p', { class: 'adm-hint' }, ['8-64 characters with an uppercase letter, a lowercase letter, a number and a special character; no spaces; must not contain their username.']),
    el('div', { class: 'adm-actions' }, [
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: function(){
        if(!window.confirm('Sign ' + u.name + ' out on every device? Their password stays the same.')) return;
        guard(api('/users/' + u.id + '/signout', { method: 'POST' }).then(function(){ toast(u.name + ' has been signed out everywhere.', 'ok'); }));
      } }, ['Sign out of all devices'])
    ])
  ]));

  // ---- their enrolments and results
  var act = el('div', { class: 'adm-card' }, [ el('h2', {}, ['Enrolments']) ]);
  act.appendChild(D.enrollments.length ? el('div', { class: 'adm-table-wrap' }, [ el('table', { class: 'adm-table' }, [
    el('thead', {}, [ el('tr', {}, ['Certificate', 'Amount', 'Status', 'Paid at (UTC)', 'Payment ID'].map(function(h){ return el('th', {}, [h]); })) ]),
    el('tbody', {}, D.enrollments.map(function(e){
      return el('tr', {}, [ el('td', {}, [e.exam]), el('td', {}, [rupees(e.amountInr) + (e.devMode && e.amountInr > 0 ? ' (test mode)' : '')]), el('td', {}, [e.status]), el('td', {}, [e.paidAt || '—']), el('td', { class: 'adm-mono' }, [e.paymentId || '—']) ]);
    }))
  ]) ]) : el('p', { class: 'adm-hint' }, ['None.']));
  act.appendChild(el('h2', {}, ['Latest results']));
  act.appendChild(D.attempts.length ? el('div', { class: 'adm-table-wrap' }, [ el('table', { class: 'adm-table' }, [
    el('thead', {}, [ el('tr', {}, ['Certificate', 'Set', 'Score', 'Result', 'Finished (UTC)'].map(function(h){ return el('th', {}, [h]); })) ]),
    el('tbody', {}, D.attempts.map(function(a){
      return el('tr', {}, [ el('td', {}, [a.exam]), el('td', {}, [String(a.set)]), el('td', {}, [a.scorePct + '%']), el('td', {}, [a.passed ? 'Pass' : 'Fail']), el('td', {}, [a.finishedAt]) ]);
    }))
  ]) ]) : el('p', { class: 'adm-hint' }, ['No completed exams yet.']));
  wrap.appendChild(act);

  // ---- delete
  if(D.isSelf){
    wrap.appendChild(el('div', { class: 'adm-card adm-danger' }, [ el('h2', {}, ['Delete this account']), el('p', {}, ['You can’t delete your own account while signed in as it.']) ]));
  } else {
    var confirmInput = el('input', { class: 'adm-input', type: 'text', placeholder: 'Type the username (' + u.username + ') to confirm' });
    var delBtn = el('button', { class: 'btn btn-danger', type: 'button', disabled: true, onclick: function(){
      var msg = 'Permanently delete ' + u.name + ' (@' + u.username + ')?\n\nThis removes their account, ' + u.attempts + ' result(s)' +
        (u.paidEnrollments ? ' and the record of ' + u.paidEnrollments + ' PAID enrolment(s)' : '') + '. They are signed out immediately. This cannot be undone.';
      if(!window.confirm(msg)) return;
      guard(api('/users/' + u.id, { method: 'DELETE', body: { confirmUsername: confirmInput.value } }).then(function(d){
        toast(d.stillInAdminEmails
          ? 'Deleted. Their email is still listed in ADMIN_EMAILS: remove it in your host’s dashboard, or anyone registering with that email would get admin access.'
          : 'Deleted ' + u.name + '.', d.stillInAdminEmails ? 'err' : 'ok');
        return navigate('users');
      }));
    } }, ['Delete permanently']);
    confirmInput.addEventListener('input', function(){ delBtn.disabled = confirmInput.value.trim().toLowerCase() !== u.username; });
    wrap.appendChild(el('div', { class: 'adm-card adm-danger' }, [
      el('h2', {}, ['Delete this account']),
      el('p', {}, ['Removes the account and all of their results and enrolments, and signs them out immediately.' +
        (u.paidEnrollments ? ' They have ' + u.paidEnrollments + ' paid enrolment(s): the payment itself stays in your Razorpay dashboard, but this site will no longer have a record of it.' : '')]),
      confirmInput, delBtn
    ]));
  }
  return wrap;
}

function setAdmin(u, want){
  guard(api('/users/' + u.id + '/admin', { method: 'POST', body: { isAdmin: want } }).then(function(d){
    S.userDetail.user = d.user; renderApp();
    if(want) toast(u.name + ' is now an admin.', 'ok');
    else if(d.stillAdminViaSetting) toast('Removed here, but ' + u.name + ' is STILL an admin through the ADMIN_EMAILS setting. Remove their email there too.', 'err');
    else toast(u.name + ' is no longer an admin.', 'ok');
  }));
}

// ---------------------------------------------------------------- ratings & reviews
function loadReviews(){
  var q = S.reviewFilter === 'all' ? '' : '?status=' + S.reviewFilter;
  return api('/reviews' + q).then(function(d){ S.reviews = d; });
}
function stars(n){
  return el('span', { class: 'adm-stars', title: n + ' out of 5' }, [ '★'.repeat(n), el('span', { class: 'adm-stars-off' }, ['★'.repeat(5 - n)]) ]);
}
function reviewStatusPill(st){
  var map = { pending: ['Waiting', 'adm-pill-warn'], approved: ['Approved', 'adm-pill-live'], hidden: ['Hidden', ''] };
  var m = map[st] || map.pending;
  return el('span', { class: 'adm-pill ' + m[1] }, [m[0]]);
}
function reviewAction(r, path, opts, msg){
  var q = S.reviewFilter === 'all' ? '' : '?status=' + S.reviewFilter;
  return guard(api('/reviews/' + r.id + path + q, opts).then(function(d){ S.reviews = d; renderApp(); toast(msg, 'ok'); }));
}
function viewReviews(){
  var d = S.reviews;
  var wrap = el('div', {});
  wrap.appendChild(el('h1', { class: 'adm-h1' }, ['Ratings & reviews']));
  wrap.appendChild(el('p', { class: 'adm-hint' }, ['Signed-in students can rate CertBench from their exam list. New and edited reviews wait here until you approve them. The home page shows the top 5 approved reviews with 4 or 5 stars (highest rating first, then newest), with the reviewer’s first name and last initial.']));
  var total = d.counts.pending + d.counts.approved + d.counts.hidden;
  var filters = [['pending', 'Waiting', d.counts.pending], ['approved', 'Approved', d.counts.approved], ['hidden', 'Hidden', d.counts.hidden], ['all', 'All', total]];
  wrap.appendChild(el('div', { class: 'adm-toolbar' }, [ el('div', { class: 'adm-chips' }, filters.map(function(f){
    return el('button', { class: 'adm-chip' + (S.reviewFilter === f[0] ? ' active' : ''), type: 'button', onclick: function(){
      S.reviewFilter = f[0]; guard(loadReviews().then(renderApp));
    } }, [f[1] + ' (' + f[2] + ')']);
  })) ]));
  if(!d.reviews.length){
    wrap.appendChild(el('p', { class: 'adm-empty' }, [S.reviewFilter === 'pending' ? 'Nothing waiting for approval.' : 'No reviews here yet.']));
    return wrap;
  }
  d.reviews.forEach(function(r){
    var actions = [];
    if(r.status !== 'approved') actions.push(el('button', { class: 'btn btn-primary adm-small', type: 'button', onclick: function(){ reviewAction(r, '/status', { method: 'POST', body: { status: 'approved' } }, 'Approved.' + (r.rating >= 4 ? ' It can now appear on the home page.' : ' (Only 4-5 star reviews are featured on the home page.)')); } }, ['Approve']));
    if(r.status !== 'hidden') actions.push(el('button', { class: 'btn btn-ghost adm-small', type: 'button', onclick: function(){ reviewAction(r, '/status', { method: 'POST', body: { status: 'hidden' } }, 'Hidden from the website.'); } }, ['Hide']));
    actions.push(el('button', { class: 'btn btn-ghost adm-small adm-danger-btn', type: 'button', onclick: function(){
      if(!window.confirm('Delete this review by ' + r.user.name + ' permanently?')) return;
      reviewAction(r, '', { method: 'DELETE' }, 'Review deleted.');
    } }, ['Delete']));
    wrap.appendChild(el('div', { class: 'adm-card adm-review' }, [
      el('div', { class: 'adm-review-top' }, [
        stars(r.rating), reviewStatusPill(r.status),
        r.featured ? el('span', { class: 'adm-pill adm-pill-you' }, ['On home page']) : null,
        el('span', { class: 'adm-hint adm-review-when' }, ['Updated ' + String(r.updatedAt || '').slice(0, 16) + ' UTC'])
      ]),
      el('p', { class: 'adm-review-text' }, [r.comment]),
      el('div', { class: 'adm-review-foot' }, [
        el('div', { class: 'adm-hint' }, [ el('span', { class: 'adm-strong' }, [r.user.name]), ' · @' + r.user.username + ' · ' + r.user.email + ' · shown as “' + r.publicName + '”' ]),
        el('div', { class: 'adm-q-actions' }, actions)
      ])
    ]));
  });
  return wrap;
}

// ---------------------------------------------------------------- site settings
function viewSettings(){
  var s = S.settings;
  var promoOn = el('input', { type: 'checkbox', checked: s.promoEnabled });
  var promoText = el('input', { class: 'adm-input', type: 'text', maxlength: '200', value: s.promoText, placeholder: 'Leave blank for the automatic message' });
  var about = el('textarea', { class: 'adm-input', rows: '9', maxlength: '2000', value: s.aboutText });
  var cTitle = el('input', { class: 'adm-input', type: 'text', maxlength: '60', value: s.contactTitle, placeholder: 'Contact us' });
  var cIntro = el('input', { class: 'adm-input', type: 'text', maxlength: '300', value: s.contactIntro, placeholder: 'Optional one-line message under the heading' });
  var address = el('input', { class: 'adm-input', type: 'text', maxlength: '200', value: s.contactAddress });
  var phone = el('input', { class: 'adm-input', type: 'text', maxlength: '20', value: s.contactPhone });
  var email = el('input', { class: 'adm-input', type: 'text', maxlength: '254', value: s.contactEmail });
  var wrap = el('div', {});
  function err(key){ return el('div', { class: 'adm-err', 'data-for': key }); }
  var card = el('div', { class: 'adm-card' }, [
    el('h2', {}, ['Announcement banner']),
    el('label', { class: 'adm-check' }, [promoOn, ' Show the banner at the top of the landing page']),
    el('div', { class: 'adm-field' }, [ el('label', {}, ['Message', promoText]), el('div', { class: 'adm-hint' }, ['Blank = an automatic line such as “6 certifications ready to practice”. If you change the message, people who closed the old one will see it again.']), err('promoText') ]),
    el('h2', {}, ['About Us text']),
    el('div', { class: 'adm-field' }, [ el('label', {}, ['About Us', about]), el('div', { class: 'adm-hint' }, ['Separate paragraphs with a blank line. Leave empty to use the standard text.']), err('aboutText') ]),
    el('div', { class: 'adm-actions' }, [ el('button', { class: 'btn btn-ghost adm-small', type: 'button', onclick: function(){ about.value = s.defaults.aboutText; } }, ['Fill in the standard text to edit it']) ]),
    el('h2', {}, ['Contact us panel']),
    el('p', { class: 'adm-hint' }, ['Shown next to the About Us section on the home page.']),
    el('div', { class: 'adm-field' }, [ el('label', {}, ['Heading', cTitle]), err('contactTitle') ]),
    el('div', { class: 'adm-field' }, [ el('label', {}, ['Intro line', cIntro]), err('contactIntro') ]),
    el('div', { class: 'adm-field' }, [ el('label', {}, ['Address', address]), err('contactAddress') ]),
    el('div', { class: 'adm-grid2' }, [
      el('div', { class: 'adm-field' }, [ el('label', {}, ['Phone', phone]), err('contactPhone') ]),
      el('div', { class: 'adm-field' }, [ el('label', {}, ['Email', email]), err('contactEmail') ])
    ]),
    el('div', { class: 'adm-actions' }, [
      el('button', { class: 'btn btn-primary', type: 'button', onclick: function(){
        Array.prototype.forEach.call(card.querySelectorAll('.adm-err'), function(n){ n.textContent = ''; });
        api('/settings', { method: 'PUT', body: {
          promoEnabled: promoOn.checked, promoText: promoText.value, aboutText: about.value,
          contactTitle: cTitle.value, contactIntro: cIntro.value,
          contactAddress: address.value, contactPhone: phone.value, contactEmail: email.value
        } }).then(function(d){
          S.settings = d.settings; toast('Saved. The website shows the change immediately.', 'ok');
        }).catch(function(e){
          if(e.data && e.data.fields){
            Object.keys(e.data.fields).forEach(function(k){ var n = card.querySelector('.adm-err[data-for="' + k + '"]'); if(n) n.textContent = e.data.fields[k]; });
            toast(e.message, 'err'); return;
          }
          return guard(Promise.reject(e));
        });
      } }, ['Save settings'])
    ])
  ]);
  wrap.appendChild(el('h1', { class: 'adm-h1' }, ['Site settings']));
  wrap.appendChild(card);
  wrap.appendChild(viewPhotos());
  return wrap;
}

// ---------------------------------------------------------------- About Us photos
// Photos are resized in the browser (longest side 1600px) before upload, so phone photos of
// several MB become a few hundred KB and the home page stays fast.
function resizeImage(file){
  return new Promise(function(resolve, reject){
    if(!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error(file.name + ': only JPEG, PNG or WebP photos can be uploaded.'));
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function(){
      URL.revokeObjectURL(url);
      var max = 1600, w = img.naturalWidth, h = img.naturalHeight;
      var k = Math.min(1, max / Math.max(w, h));
      var c = document.createElement('canvas');
      c.width = Math.round(w * k); c.height = Math.round(h * k);
      var ctx = c.getContext('2d');
      var keepPng = file.type === 'image/png' && k === 1 && file.size < 1024 * 1024;   // small PNGs (logos, screenshots) stay sharp
      if(!keepPng){ ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.drawImage(img, 0, 0, c.width, c.height);
      var data = keepPng ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85);
      resolve(data);
    };
    img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error(file.name + ': that file could not be read as an image.')); };
    img.src = url;
  });
}

function viewPhotos(){
  var P = S.photos || { photos: [], max: 12 };
  var list = P.photos;
  var card = el('div', { class: 'adm-card' });
  var fileInput = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, class: 'adm-file' });
  var newCaption = el('input', { class: 'adm-input', type: 'text', maxlength: '120', placeholder: 'Optional caption, e.g. “Our team in Pune”' });
  var status = el('div', { class: 'adm-hint' });
  var uploadBtn = el('button', { class: 'btn btn-primary', type: 'button' }, ['Upload photo']);

  function refresh(d){ S.photos = d; var fresh = viewPhotos(); card.parentNode.replaceChild(fresh, card); }

  uploadBtn.addEventListener('click', function(){
    var files = Array.prototype.slice.call(fileInput.files || []);
    if(!files.length){ toast('Choose a photo first.', 'err'); return; }
    var room = P.max - list.length;
    if(files.length > room){ toast(room > 0 ? 'You can add ' + room + ' more photo' + (room === 1 ? '' : 's') + ' (max ' + P.max + ').' : 'You already have ' + P.max + ' photos. Delete one first.', 'err'); return; }
    uploadBtn.disabled = true;
    var caption = newCaption.value;
    var last = null, done = 0;
    var chain = Promise.resolve();
    files.forEach(function(f){
      chain = chain.then(function(){
        status.textContent = 'Uploading ' + (done + 1) + ' of ' + files.length + '…';
        return resizeImage(f).then(function(data){
          return api('/photos', { method: 'POST', body: { image: data, caption: files.length === 1 ? caption : '' } });
        }).then(function(d){ last = d; done++; });
      });
    });
    chain.then(function(){
      toast(done === 1 ? 'Photo uploaded. It now shows in the About Us section.' : done + ' photos uploaded.', 'ok');
      refresh(last);
    }).catch(function(e){
      uploadBtn.disabled = false; status.textContent = '';
      if(last) refresh(last);
      if(e.status === 401 || e.status === 403) return guard(Promise.reject(e));
      toast(e.message, 'err');
    });
  });

  function act(promise, msg){
    guard(promise.then(function(d){ if(msg) toast(msg, 'ok'); refresh(d); }));
  }

  card.appendChild(el('h2', {}, ['About Us photos']));
  card.appendChild(el('p', { class: 'adm-hint' }, ['Shown as a photo gallery in the About Us section of the home page, in this order. JPEG, PNG or WebP; large photos are resized automatically. Up to ' + P.max + ' photos.']));
  card.appendChild(el('div', { class: 'adm-photo-upload' }, [
    el('div', { class: 'adm-field' }, [ el('label', {}, ['Photo', fileInput]) ]),
    el('div', { class: 'adm-field' }, [ el('label', {}, ['Caption', newCaption]), el('div', { class: 'adm-hint' }, ['Used when you upload one photo at a time. You can edit captions below.']) ]),
    el('div', { class: 'adm-actions' }, [ uploadBtn, status ])
  ]));

  if(!list.length){
    card.appendChild(el('p', { class: 'adm-empty' }, ['No photos yet. The About Us section shows text only.']));
    return card;
  }
  var grid = el('div', { class: 'adm-photo-grid' });
  list.forEach(function(p, i){
    var cap = el('input', { class: 'adm-input', type: 'text', maxlength: '120', value: p.caption, placeholder: 'No caption' });
    grid.appendChild(el('div', { class: 'adm-photo' }, [
      el('a', { href: p.url, target: '_blank', rel: 'noopener', class: 'adm-photo-thumb' }, [ el('img', { src: p.url, alt: p.caption || 'Photo ' + (i + 1), loading: 'lazy' }) ]),
      el('div', { class: 'adm-hint' }, ['#' + (i + 1) + ' · ' + Math.max(1, Math.round(p.bytes / 1024)) + ' KB']),
      cap,
      el('div', { class: 'adm-photo-actions' }, [
        el('button', { class: 'btn btn-ghost adm-small', type: 'button', onclick: function(){ act(api('/photos/' + p.id, { method: 'PUT', body: { caption: cap.value } }), 'Caption saved.'); } }, ['Save caption']),
        el('button', { class: 'btn btn-ghost adm-small', type: 'button', title: 'Move earlier', 'aria-label': 'Move earlier', disabled: i === 0, onclick: function(){ act(api('/photos/' + p.id + '/move', { method: 'POST', body: { dir: -1 } })); } }, ['←']),
        el('button', { class: 'btn btn-ghost adm-small', type: 'button', title: 'Move later', 'aria-label': 'Move later', disabled: i === list.length - 1, onclick: function(){ act(api('/photos/' + p.id + '/move', { method: 'POST', body: { dir: 1 } })); } }, ['→']),
        el('button', { class: 'btn btn-ghost adm-small adm-danger-btn', type: 'button', onclick: function(){
          if(!window.confirm('Delete this photo from the About Us section?')) return;
          act(api('/photos/' + p.id, { method: 'DELETE' }), 'Photo deleted.');
        } }, ['Delete'])
      ])
    ]));
  });
  card.appendChild(grid);
  return card;
}

// ---------------------------------------------------------------- start
function boot(){
  if(!getToken()) return renderGate('signin');
  guard(api('/overview').then(function(d){
    S.overview = d; S.view = 'overview';
    renderApp();
    fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + getToken() } })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ if(j && j.user){ S.meName = j.user.name; if(S.view === 'overview') renderApp(); } })
      .catch(function(){});
  }));
}
boot();
})();

// Home page visitor counter: "Total visitors" and "Today's visitors".
// Each browser gets an anonymous random ID (kept in localStorage) so the server
// can count it once per day. The card sits just above the home page footer.
(function(){
  var ID_KEY = 'certbench-visitor-id';
  var counts = null;

  function visitorId(){
    var id = null;
    try{ id = localStorage.getItem(ID_KEY); }catch(e){}
    if(!id || !/^[A-Za-z0-9-]{16,64}$/.test(id)){
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      try{ localStorage.setItem(ID_KEY, id); }catch(e){}
    }
    return id;
  }

  function fmt(n){ return Number(n || 0).toLocaleString('en-IN'); }   // 15107338 -> 1,51,07,338

  var EYE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var USERS = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><circle cx="9" cy="7.5" r="3.6"/><path d="M2.5 19.2c0-3.6 2.9-6.2 6.5-6.2s6.5 2.6 6.5 6.2c0 .7-.5 1.3-1.2 1.3H3.7c-.7 0-1.2-.6-1.2-1.3z"/><circle cx="16.6" cy="8.4" r="3" opacity=".7"/><path d="M15.6 13.3c3.4-.4 6.2 2 6.2 5.4 0 .6-.5 1.1-1.1 1.1h-4.1c.3-2.6-.2-4.8-1-6.5z" opacity=".7"/></svg>';

  function row(label, value, key){
    return '<div class="vc-row"><div class="vc-label">' + EYE + '<span>' + label + '</span></div>' +
      '<div class="vc-num" data-vc="' + key + '">' + value + '</div></div>';
  }

  function build(){
    var sec = document.createElement('section');
    sec.className = 'visitor-section';
    sec.setAttribute('aria-label', 'Site visitors');
    sec.innerHTML = '<div class="visitor-card">' +
      '<div class="vc-icon">' + USERS + '</div>' +
      '<div class="vc-inner">' +
        row('Total Visitors:', counts ? fmt(counts.total) : '—', 'total') +
        row('Today’s Visitors:', counts ? fmt(counts.today) : '—', 'today') +
      '</div></div>';
    return sec;
  }

  function refresh(){
    var t = document.querySelectorAll('[data-vc="total"]'), d = document.querySelectorAll('[data-vc="today"]');
    for(var i = 0; i < t.length; i++) t[i].textContent = counts ? fmt(counts.total) : '—';
    for(var j = 0; j < d.length; j++) d[j].textContent = counts ? fmt(counts.today) : '—';
  }

  // The app re-draws the home page as you navigate, so put the card back whenever it is missing.
  function place(){
    var wrap = document.querySelector('.landing-wrap');
    if(!wrap || wrap.querySelector('.visitor-section')) return;
    var foot = wrap.querySelector(':scope > .site-foot');
    wrap.insertBefore(build(), foot || null);
  }

  function load(){
    fetch('/api/visits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: visitorId() }) })
      .then(function(r){ return r.ok ? r : fetch('/api/visits'); })   // rate-limited etc.: still show the numbers
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(c){ if(c && typeof c.total === 'number'){ counts = c; refresh(); } })
      .catch(function(){});
  }

  var queued = false;
  new MutationObserver(function(){
    if(queued) return; queued = true;
    requestAnimationFrame(function(){ queued = false; place(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  place();
  load();
})();

// Admin panel > Site settings: "Home page visitor counter" on/off switch.
// Kept in its own file; it adds its card to the Site settings page whenever that page is shown.
(function(){
  'use strict';
  var TOKEN_KEY = 'certbench-token';
  function token(){ try{ return localStorage.getItem(TOKEN_KEY); }catch(e){ return null; } }
  function call(method, url, body){
    var h = { 'Content-Type': 'application/json' }, t = token();
    if(t) h.Authorization = 'Bearer ' + t;
    return fetch(url, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined })
      .then(function(r){ return r.json().catch(function(){ return null; }).then(function(d){
        if(!r.ok) throw new Error((d && d.error) || ('Request failed (' + r.status + ')'));
        return d;
      }); });
  }
  function fmt(n){ return Number(n || 0).toLocaleString('en-IN'); }
  function node(tag, cls, text){ var e = document.createElement(tag); if(cls) e.className = cls; if(text != null) e.textContent = text; return e; }

  function buildCard(){
    var card = node('div', 'adm-card'); card.id = 'adm-visitors';
    card.appendChild(node('h2', null, 'Home page visitor counter'));
    var label = node('label', 'adm-check');
    var box = document.createElement('input'); box.type = 'checkbox'; box.id = 'adm-visitors-toggle'; box.disabled = true;
    label.appendChild(box); label.appendChild(document.createTextNode(' Show “Total Visitors” and “Today’s Visitors” on the home page'));
    card.appendChild(label);
    var stats = node('div', 'adm-hint', 'Loading the numbers…'); stats.id = 'adm-visitors-stats';
    var note = node('div', 'adm-hint', 'Visits are still counted while the card is hidden, so the numbers stay complete when you switch it back on. Changes apply as soon as you tick or untick the box.');
    var status = node('div', 'adm-hint'); status.id = 'adm-visitors-status'; status.setAttribute('role', 'status');
    card.appendChild(stats); card.appendChild(note); card.appendChild(status);

    function show(d){
      box.checked = !!d.enabled; box.disabled = false;
      stats.textContent = 'Total visitors: ' + fmt(d.total) + ' · Today: ' + fmt(d.today) + ' · Currently ' + (d.enabled ? 'shown' : 'hidden') + ' on the home page.';
    }
    call('GET', '/api/visits/admin').then(show).catch(function(e){ stats.textContent = 'Could not load: ' + e.message; });
    box.addEventListener('change', function(){
      var want = box.checked;
      box.disabled = true; status.textContent = 'Saving…';
      call('PUT', '/api/admin/settings', { visitorCounterEnabled: want })
        .then(function(){ return call('GET', '/api/visits/admin'); })
        .then(function(d){ show(d); status.textContent = want ? 'Saved. The counter is now shown on the home page.' : 'Saved. The counter is now hidden from the home page.'; })
        .catch(function(e){ box.checked = !want; box.disabled = false; status.textContent = 'Not saved: ' + e.message; });
    });
    return card;
  }

  // The admin panel redraws pages as you click around, so add the card whenever Site settings is on screen.
  function place(){
    var root = document.getElementById('adm-root');
    if(!root || document.getElementById('adm-visitors')) return;
    var h1s = root.querySelectorAll('h1.adm-h1'), h1 = null;
    for(var i = 0; i < h1s.length; i++) if(h1s[i].textContent.trim() === 'Site settings') h1 = h1s[i];
    if(!h1) return;
    var settingsCard = h1.nextElementSibling;
    if(!settingsCard) return;
    settingsCard.parentNode.insertBefore(buildCard(), settingsCard.nextSibling);
  }
  var queued = false;
  new MutationObserver(function(){
    if(queued) return; queued = true;
    requestAnimationFrame(function(){ queued = false; place(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  place();
})();

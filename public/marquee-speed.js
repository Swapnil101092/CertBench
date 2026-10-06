// Keeps the sign-in / sign-up exam ticker at a calm, readable pace.
// The ticker loops over every exam badge; with a fixed duration it got faster
// each time exams were added. Here the duration is set from the ticker's real
// width so it always moves at about MARQUEE_PX_PER_SEC, however many exams exist.
(function(){
  var MARQUEE_PX_PER_SEC = 40;
  function tune(track){
    var loopWidth = track.scrollWidth / 2;   // the track holds two copies for a seamless loop
    if(loopWidth > 0) track.style.animationDuration = Math.max(20, Math.round(loopWidth / MARQUEE_PX_PER_SEC)) + 's';
  }
  function scan(){
    var tracks = document.querySelectorAll('.auth-marquee-track:not([data-tuned])');
    for(var i = 0; i < tracks.length; i++){ tracks[i].setAttribute('data-tuned', '1'); tune(tracks[i]); }
  }
  new MutationObserver(function(){ requestAnimationFrame(scan); })
    .observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();

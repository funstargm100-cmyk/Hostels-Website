// Logo reveal: plays the spotlight / iris / wordmark-flip animation once on
// page load by adding the .play class to the navbar. The matching CSS lives in
// css/style.css. Respects prefers-reduced-motion (CSS handles the fallback) and
// only runs when the logo mark markup is present.
(function () {
  function play() {
    var nav = document.getElementById('mainNav');
    if (!nav || !nav.querySelector('.logo-mark')) return;
    nav.classList.remove('play');
    // Force reflow so the animation restarts even if .play was already set.
    void nav.offsetWidth;
    nav.classList.add('play');
  }

  if (document.readyState === 'complete') play();
  else window.addEventListener('load', play);
})();

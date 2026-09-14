// Scroll-reveal: adds .in-view to .reveal / .reveal-stagger / .reveal-scale elements
// when they enter the viewport. Falls back to revealing everything immediately
// if IntersectionObserver isn't available.
(function () {
  const targets = document.querySelectorAll('.reveal, .reveal-stagger, .reveal-scale');
  if (!targets.length) return;

  if (!('IntersectionObserver' in window)) {
    targets.forEach(el => el.classList.add('in-view'));
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  targets.forEach(el => io.observe(el));
})();
// Logo intro: a rounded square pops in at the centre base of the logo, the icon
// appears inside it, then slides left to its slot while "Rentel" sweeps in from
// the left. The whole sequence is CSS (@keyframes logoSquare / logoIconSlide /
// logoWordReveal in style.css); here we just arm it.
//
// Only animated when the logo is actually in the first viewport — a header logo
// far down the page (footer, sidebar) would otherwise replay invisibly.
(function () {
  const logos = Array.from(document.querySelectorAll('.logo'));
  if (!logos.length) return;

  // Words run across a doc-wide reserve, 40ms apart, so simultaneous logos
  // (nav + footer) do not animate in lockstep.
  let waveIndex = 0;

  function arm(el) {
    const delay = Math.min(waveIndex++, 6) * 40;
    el.style.setProperty('--logo-intro-delay', delay + 'ms');

    // How far the icon travels: from its own slot to the middle of the logo.
    // Both the icon slide and its cover read --logo-mid, so they stay
    // concentric. Measured with the icon at rest, before the class is added.
    const icon = el.querySelector('.rentel-icon');
    if (icon) {
      const logoW = el.getBoundingClientRect().width;
      const iconW = icon.getBoundingClientRect().width;
      if (logoW && iconW) {
        el.style.setProperty('--logo-mid', (logoW / 2 - iconW / 2) + 'px');
      }
    }

    el.classList.add('logo-intro');
    // Drop the class once the 2.3s animation has finished so the logo rests in
    // a clean state and a later re-arm (bfcache restore) replays from scratch.
    el.addEventListener('animationend', function onDone() {
      if (el.matches(':hover')) return;      // hovering re-cues the animation
      el.classList.remove('logo-intro');
    }, { once: true });
  }

  // Force a full replay from a clean slate: drop the class, let the browser
  // commit the resting state for a frame, then re-arm. Removing and re-adding
  // within the same frame would not restart the CSS animation.
  function replay(el) {
    el.classList.remove('logo-intro');
    requestAnimationFrame(function () { arm(el); });
  }

  function inFirstViewport(el) {
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight && r.bottom > 0 && r.width > 0 && r.height > 0;
  }

  function armVisible() {
    logos.forEach(function (el) {
      if (el.classList.contains('logo-intro')) return;
      if (inFirstViewport(el)) arm(el);
    });
  }

  function init() {
    // If the tab has never actually painted (throttled / prerendered load), a
    // load-time start can be skipped by the browser. Hold the reveal until the
    // first visible frame so the sequence is always seen beginning to end.
    if (document.visibilityState === 'hidden') {
      document.addEventListener('visibilitychange', init, { once: true });
      return;
    }
    armVisible();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  // Replay the full intro when the logo is hovered — but only after the
  // entrance has settled, and only when the logo is genuinely being pointed at.
  logos.forEach(function (el) {
    el.addEventListener('mouseenter', function () {
      if (el.matches(':hover')) return;      // ignore the synthetic enter
      if (el.classList.contains('logo-intro')) return;
      el.style.setProperty('--logo-intro-delay', '0ms');
      el.classList.add('logo-intro');
      el.addEventListener('animationend', function () {
        if (!el.matches(':hover')) el.classList.remove('logo-intro');
      }, { once: true });
    });
  });

  // Footer logo: unlike the header logo, which only plays once on load, the
  // footer logo replays every time the footer scrolls into view. An
  // IntersectionObserver (kept, not unobserved) fires on each entry, and a flag
  // stops it re-firing while the footer merely stays on screen.
  const footerLogos = logos.filter(function (el) { return el.closest('.site-footer'); });
  if (footerLogos.length && 'IntersectionObserver' in window) {
    const seen = new WeakMap();   // el -> is the footer currently in view?
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        const el = entry.target;
        const was = seen.get(el) || false;
        seen.set(el, entry.isIntersecting);
        // Replay on each fresh entry from outside → inside the viewport.
        if (entry.isIntersecting && !was) replay(el);
      });
    }, { threshold: 0.4 });
    footerLogos.forEach(function (el) { io.observe(el); });
  }

  // bfcache restore: the first load left the logo in its finished state, so
  // replay the whole thing rather than showing a frozen logo on a "second" load.
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    logos.forEach(function (el) { el.classList.remove('logo-intro'); });
    requestAnimationFrame(armVisible);
  });
})();

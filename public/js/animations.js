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

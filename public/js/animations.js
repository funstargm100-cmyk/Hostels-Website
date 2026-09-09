// Site-wide life: scroll reveals, staggered lists, page transitions.
(function () {
  // Scroll-triggered reveal for .reveal / .reveal-stagger elements
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll('.reveal, .reveal-stagger, .stagger').forEach(el => io.observe(el));
  } else {
    document.querySelectorAll('.reveal, .reveal-stagger, .stagger').forEach(el => el.classList.add('revealed'));
  }

  // View-transition-like fade between internal pages
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    if (a.hostname !== location.hostname) return;
    e.preventDefault();
    document.body.style.transition = 'opacity 0.18s ease';
    document.body.style.opacity = '0';
    setTimeout(() => { location.href = href; }, 180);
  });

  // Fade page in on load / bfcache restore
  const show = () => { document.body.style.opacity = '1'; };
  document.body.style.opacity = '0';
  document.body.style.transition = 'opacity 0.25s ease';
  window.addEventListener('pageshow', show);
  if (document.readyState === 'complete') show();
  else window.addEventListener('load', show);
})();

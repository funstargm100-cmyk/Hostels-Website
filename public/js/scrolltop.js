(function () {
  const btn = document.createElement('button');
  btn.id = 'scrollTopBtn';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Scroll back to top');
  btn.title = 'Back to top';
  btn.innerHTML = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2.4" stroke-linecap="round"
         stroke-linejoin="round" aria-hidden="true">
      <path d="M12 19V5"></path>
      <path d="M5 12l7-7 7 7"></path>
    </svg>`;
  document.body.appendChild(btn);

  const SHOW_AT = 400;
  let visible = false;

  function toggle() {
    const shouldShow = window.scrollY > SHOW_AT;
    if (shouldShow !== visible) {
      visible = shouldShow;
      btn.classList.toggle('show', visible);
    }
  }

  window.addEventListener('scroll', toggle, { passive: true });
  toggle();

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();

// ─── MOBILE FOOTER NAV (shared bottom tab bar for all pages) ─────────────────
// Renders a fixed bottom navigation bar on mobile for any page.
// Usage: include <nav class="footer-nav" id="footerNav"></nav> before scripts,
// then call initFooterNav() (auto-runs on DOMContentLoaded).

(function () {
  const NAVS = {
    // Public / visitor pages
    visitor: [
      { href: '/', icon: 'home', label: 'Home' },
      { href: '/listings', icon: 'search', label: 'Browse' },
      { href: '/post-ad', icon: 'plus-circle', label: 'Post Room' },
      { href: '/about', icon: 'info', label: 'About' },
      { href: '/signup', icon: 'user-plus', label: 'Join' }
    ],
    // Seeker-focused pages
    seeker: [
      { href: '/seekers', icon: 'home', label: 'Home' },
      { href: '/listings', icon: 'search', label: 'Browse' },
      { href: '/dashboard', icon: 'heart', label: 'Saved', match: ['favorites'] },
      { href: '/dashboard', icon: 'message-circle', label: 'Requests' },
      { href: '/about', icon: 'info', label: 'About' }
    ],
    // Agent / owner pages
    agent: [
      { href: '/agents', icon: 'home', label: 'Home' },
      { href: '/post-ad', icon: 'plus-circle', label: 'Post' },
      { href: '/dashboard', icon: 'layout-dashboard', label: 'Listings' },
      { href: '/dashboard', icon: 'bell', label: 'Alerts' },
      { href: '/about', icon: 'info', label: 'About' }
    ]
  };

  function currentPath() {
    return location.pathname.replace(/\/+$/, '') || '/';
  }

  function isActive(item) {
    const path = currentPath();
    const search = new URLSearchParams(location.search);
    if (item.href === '/' ? path === '/' : path === item.href.replace(/\/+$/, '')) {
      // Also match hash / query specifics like /dashboard + favorites tab
      if (item.match && item.match.some(m => location.search.includes(m) || location.hash.includes(m))) return true;
      if (item.href === '/dashboard' && (location.search.includes('tab=') || location.hash)) return true;
      return !item.match;
    }
    return false;
  }

  function render() {
    const el = document.getElementById('footerNav');
    if (!el) return;
    const mode = el.dataset.mode || 'visitor';
    const items = NAVS[mode] || NAVS.visitor;
    el.innerHTML = items.map(it => `
      <a href="${it.href}" class="footer-nav-item ${isActive(it) ? 'active' : ''}">
        <i data-lucide="${it.icon}"></i><span>${it.label}</span>
      </a>`).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [el] });
  }

  window.initFooterNav = render;
  document.addEventListener('DOMContentLoaded', render);
})();

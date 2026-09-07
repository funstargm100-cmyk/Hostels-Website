async function loadFeatured() {
  const grid = document.getElementById('featuredListings');
  try {
    const { listings } = await api.get('/api/listings?limit=4&sort=featured');
    if (!listings.length) { grid.innerHTML = '<p class="text-muted">No listings yet. <a href="/post-ad" style="color:var(--primary)">Be the first to post!</a></p>'; return; }
    grid.innerHTML = listings.map(renderListingCard).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch {
    grid.innerHTML = '<p class="text-muted">Could not load listings.</p>';
  }
}

async function loadStats() {
  try {
    const { listings } = await api.get('/api/listings?limit=1');
    // Just show a count from total
    const res = await api.get('/api/listings?limit=1');
    if (res.total) document.getElementById('statListings').textContent = res.total + '+';
  } catch {}
}

loadFeatured();
loadStats();

// Make transparent navbar solid on scroll
const nav = document.getElementById('mainNav');
if (nav && nav.classList.contains('navbar-transparent')) {
  window.addEventListener('scroll', () => {
    if (window.scrollY > 60) {
      nav.classList.remove('navbar-transparent');
    } else {
      nav.classList.add('navbar-transparent');
    }
  }, { passive: true });
}

// Home page for logged-in seekers
async function loadFeaturedSeeker() {
  const grid = document.getElementById('featuredListingsSeeker');
  try {
    const { listings } = await api.get('/api/listings?limit=8&sort=featured');
    if (!listings.length) {
      grid.innerHTML = '<p class="text-muted">No rooms yet. <a href="/post-ad" style="color:var(--primary)">Be the first to post!</a></p>';
      return;
    }
    grid.innerHTML = listings.map(renderListingCard).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [grid] });
  } catch {
    grid.innerHTML = '<p class="text-muted">Could not load rooms.</p>';
  }
}

// Guard: redirect agents/owners to their own home
async function initSeekerHome() {
  const user = await initNavAuth();
  const role = user?.role;
  const g = document.getElementById('seekerGreeting');
  if (g && user?.name) g.textContent = `Welcome back, ${user.name.split(' ')[0] || 'seeker'}`;
  if (role === 'owner' || role === 'agent') { location.replace('/home-agent'); return; }
  if (window.renderFooterNav) window.renderFooterNav();
}

loadFeaturedSeeker();
initSeekerHome();

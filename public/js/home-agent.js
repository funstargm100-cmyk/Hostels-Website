// Home page for logged-in agents/owners
async function loadAgentListings() {
  const grid = document.getElementById('agentListings');
  try {
    const { listings } = await api.get('/api/listings?limit=8&sort=featured');
    if (!listings.length) {
      grid.innerHTML = '<p class="text-muted">No listings yet. <a href="/post-ad" style="color:var(--primary)">Be the first to post!</a></p>';
      return;
    }
    grid.innerHTML = listings.map(renderListingCard).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [grid] });
  } catch {
    grid.innerHTML = '<p class="text-muted">Could not load listings.</p>';
  }
}

// Guard: redirect seekers to their own home
async function initAgentHome() {
  const user = await initNavAuth();
  const role = user?.role;
  const g = document.getElementById('agentGreeting');
  if (g && user?.name) g.textContent = `Welcome back, ${user.name.split(' ')[0] || 'agent'}`;
  if (role !== 'owner' && role !== 'agent') { location.replace('/home-seeker'); return; }
  if (window.renderFooterNav) window.renderFooterNav();
}

loadAgentListings();
initAgentHome();

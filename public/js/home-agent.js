// Home page for logged-in agents/owners.
// Owners don't browse other people's rooms — this section shows THEIR listings.
async function loadAgentListings() {
  const grid = document.getElementById('agentListings');
  if (!grid) return;
  try {
    const { listings } = await api.get('/api/user/listings');
    if (!listings.length) {
      grid.innerHTML = '<p class="text-muted">You haven\'t posted any rooms yet. <a href="/post-ad" style="color:var(--primary)">Post your first room.</a></p>';
      return;
    }
    grid.innerHTML = listings.map(renderListingCard).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [grid] });
  } catch {
    grid.innerHTML = '<p class="text-muted">Could not load your rooms.</p>';
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

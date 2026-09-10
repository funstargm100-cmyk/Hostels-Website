async function loadFeatured() {
  const grids = ['featuredListings', 'featuredListingsSeeker', 'agentListings']
    .map(id => document.getElementById(id)).filter(Boolean);
  for (const grid of grids) {
    try {
      const { listings } = await api.get('/api/listings?limit=8&sort=featured');
      if (!listings.length) { grid.innerHTML = '<p class="text-muted">No rooms yet. <a href="/post-ad" style="color:var(--primary)">Be the first to post!</a></p>'; continue; }
      grid.innerHTML = listings.map(renderListingCard).join('');
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [grid] });
    } catch {
      grid.innerHTML = '<p class="text-muted">Could not load rooms.</p>';
    }
  }
}

async function loadStats() {
  try {
    const res = await api.get('/api/listings?limit=1');
    if (res.total) document.getElementById('statListings').textContent = res.total + '+';
  } catch {}
}

// ─── ROLE-TAILORED HOMEPAGE ─────────────────────────────────────────────────────
async function initHomeRole() {
  const user = await initNavAuth(); // defined in app.js — validates token & caches user
  const role = user?.role;
  const visitor = document.getElementById('homeVisitor');
  const seeker = document.getElementById('homeSeeker');
  const agent = document.getElementById('homeAgent');
  const heroTitle = document.getElementById('heroTitle');
  const heroSub = document.getElementById('heroSub');

  if (role === 'owner' || role === 'agent') {
    if (visitor) visitor.style.display = 'none';
    if (seeker) seeker.style.display = 'none';
    if (agent) agent.style.display = '';
    if (heroTitle) heroTitle.innerHTML = 'Fill your rooms <em>faster.</em>';
    if (heroSub) heroSub.textContent = 'Find hostels to list, post new rooms in minutes, and get paid — every serious seeker is routed straight to you.';
    const g = document.getElementById('agentGreeting');
    if (g) g.textContent = `Welcome back, ${user.name?.split(' ')[0] || 'agent'}`;
  } else if (role === 'seeker') {
    if (visitor) visitor.style.display = 'none';
    if (agent) agent.style.display = 'none';
    if (seeker) seeker.style.display = '';
    if (heroTitle) heroTitle.innerHTML = 'Find a hostel with <em>ease.</em>';
    if (heroSub) heroSub.textContent = 'No more roaming around town. Search verified rooms near your campus or workplace, shortlist favourites and connect safely — all free.';
    const g = document.getElementById('seekerGreeting');
    if (g) g.textContent = `Welcome back, ${user.name?.split(' ')[0] || 'seeker'}`;
  }
  // visitor: leave the default sections visible
  if (window.renderFooterNav) window.renderFooterNav();
}

loadFeatured();
loadStats();
initHomeRole();

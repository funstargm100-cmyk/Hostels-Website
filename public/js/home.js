async function loadFeatured() {
  // The index page is the visitor home only, so there is a single grid to fill.
  const grids = ['featuredListings']
    .map(id => document.getElementById(id)).filter(Boolean);
  for (const grid of grids) {
    try {
      const { listings } = await api.get('/api/listings?limit=6&sort=featured');
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
  // The index page is now only the VISITOR home. As soon as we know the viewer is
  // signed in, hand them off to their own dedicated page: /home-seeker for seekers,
  // /home-agent for owners/agents, /admin for admins. Signed-out visitors stay here.
  // (home-seeker.js / home-agent.js guard the other direction, so a wrong-role link
  // still lands on the right page.)
  const user = await initNavAuth(); // defined in app.js — validates token & caches user
  const role = user?.role;
  // Known roles go straight to their page; anyone else (signed out, or an
  // unrecognised role) stays on the visitor home. Guarding with an explicit set
  // also prevents a redirect loop, since goHomeForRole() returns '/' for unknowns.
  const HOME_BY_ROLE = { seeker: '/home-seeker', owner: '/home-agent', agent: '/home-agent', admin: '/admin' };
  const target = HOME_BY_ROLE[role];

  if (target && target !== location.pathname) {
    location.replace(target);
    return;
  }

  if (window.renderFooterNav) window.renderFooterNav();
}

loadFeatured();
loadStats();
initHomeRole();

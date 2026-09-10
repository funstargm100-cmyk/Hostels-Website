// Home page for signed-out visitors (and any non-seeker/agent role)
async function loadFeatured() {
  const grid = document.getElementById('featuredListings');
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

async function loadStats() {
  try {
    const res = await api.get('/api/listings?limit=1');
    if (res.total) document.getElementById('statListings').textContent = res.total + '+';
  } catch { }
}

loadFeatured();
loadStats();
initNavAuth().then(() => { if (window.renderFooterNav) window.renderFooterNav(); });

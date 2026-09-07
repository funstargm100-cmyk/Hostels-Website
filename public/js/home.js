async function loadFeatured() {
  const grid = document.getElementById('featuredListings');
  try {
    const { listings } = await api.get('/api/listings?limit=4&sort=featured');
    if (!listings.length) { grid.innerHTML = '<p class="text-muted">No listings yet. <a href="/post-ad" style="color:var(--primary)">Be the first to post!</a></p>'; return; }
    grid.innerHTML = listings.map(renderListingCard).join('');
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

function heroSearch() {
  const location = document.getElementById('heroLocation').value;
  const maxPrice = document.getElementById('heroMaxPrice').value;
  const occupancy = document.getElementById('heroOccupancy').value;
  const params = new URLSearchParams();
  if (location) params.set('location', location);
  if (maxPrice) params.set('max_price', maxPrice);
  if (occupancy) params.set('occupancy', occupancy);
  location.href = '/listings?' + params.toString();
}

document.getElementById('heroLocation')?.addEventListener('keydown', e => { if (e.key === 'Enter') heroSearch(); });

loadFeatured();
loadStats();

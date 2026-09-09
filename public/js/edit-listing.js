// Owner edit page: loads listing via /api/listings/:uuid/edit-data,
// prefills the form, and saves via PUT /api/listings/:uuid.
const editUUID = new URLSearchParams(location.search).get('id');

async function initEdit() {
  const user = await initNavAuth();
  if (!user) { location.href = '/login?redirect=' + encodeURIComponent(location.pathname + location.search); return; }
  if (!['owner', 'agent', 'admin'].includes(user.role)) { location.href = '/dashboard'; return; }
  if (!editUUID) { location.href = '/dashboard#listings'; return; }

  try {
    const { listing, amenities, images } = await api.get(`/api/listings/${editUUID}/edit-data`);
    document.getElementById('editLoading').style.display = 'none';
    document.getElementById('editContent').style.display = 'block';
    document.title = `Edit: ${listing.title} — Roomy`;

    document.getElementById('edTitle').value = listing.title || '';
    document.getElementById('edDescription').value = listing.description || '';
    document.getElementById('edPrice').value = listing.original_price || listing.listed_price || '';
    document.getElementById('edOccupancy').value = String(listing.occupancy_type || 1);
    document.getElementById('edLocation').value = listing.location_area || '';
    document.getElementById('edLandmark').value = listing.nearest_landmark || '';
    if (amenities.water) document.getElementById('edWater').value = amenities.water;
    if (amenities.electricity) document.getElementById('edElectricity').value = amenities.electricity;
    if (amenities.furnishing) document.getElementById('edFurnishing').value = amenities.furnishing;
    if (amenities.bathroom) document.getElementById('edBathroom').value = amenities.bathroom;
    document.getElementById('edWifi').checked = !!amenities.wifi;
    document.getElementById('edKitchen').checked = !!amenities.kitchen_access;
    document.getElementById('edParking').checked = !!amenities.parking;
    document.getElementById('edPets').checked = !!amenities.pet_friendly;

    document.getElementById('currentPhotos').innerHTML = images.length
      ? images.map(img => `<img src="${img.image_path}" alt="Current photo" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--radius-sm)" loading="lazy" />`).join('')
      : '<p class="text-muted" style="grid-column:1/-1;font-size:0.85rem">No photos uploaded yet.</p>';

    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) {
    document.getElementById('editLoading').innerHTML = `<div class="alert alert-danger">Failed to load listing: ${e.message}</div><a href="/dashboard#listings" class="btn btn-outline mt-2">Back to dashboard</a>`;
  }
}

document.getElementById('editForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('editSubmitBtn');
  const errEl = document.getElementById('editError');
  errEl.style.display = 'none';
  btn.disabled = true; btn.classList.add('btn-loading');
  try {
    await api.put(`/api/listings/${editUUID}`, {
      title: document.getElementById('edTitle').value.trim(),
      description: document.getElementById('edDescription').value.trim(),
      original_price: document.getElementById('edPrice').value,
      occupancy_type: document.getElementById('edOccupancy').value,
      location_area: document.getElementById('edLocation').value.trim(),
      nearest_landmark: document.getElementById('edLandmark').value.trim(),
      water: document.getElementById('edWater').value,
      electricity: document.getElementById('edElectricity').value,
      furnishing: document.getElementById('edFurnishing').value,
      bathroom: document.getElementById('edBathroom').value,
      wifi: document.getElementById('edWifi').checked,
      kitchen_access: document.getElementById('edKitchen').checked,
      parking: document.getElementById('edParking').checked,
      pet_friendly: document.getElementById('edPets').checked
    });
    showToast('Changes saved! Resubmitted for review.', 'success');
    setTimeout(() => location.href = '/dashboard#listings', 1200);
  } catch (ex) {
    errEl.textContent = ex.message;
    errEl.style.display = 'block';
    btn.disabled = false; btn.classList.remove('btn-loading');
  }
});

initEdit();

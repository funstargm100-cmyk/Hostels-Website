// Every seeker's daily base location is fixed to the UENR campus. It is no
// longer asked for at signup and cannot be edited in the profile — the app
// simply assumes all seekers base out of UENR (Sunyani). Kept here so signup,
// profile updates and any migration all share one source of truth.
const SEEKER_BASE = {
  location: 'UENR School Park, Sunyani, Bono Region, Ghana',
  // Exact "UENR School Park" pin (OpenStreetMap way 372070956). Every seeker's
  // daily base is this one spot, so the trace line always ends at the same place.
  lat: 7.3507440,
  lng: -2.3428065
};

module.exports = { SEEKER_BASE };

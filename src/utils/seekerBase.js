// Every seeker's daily base location is fixed to the UENR campus. It is no
// longer asked for at signup and cannot be edited in the profile — the app
// simply assumes all seekers base out of UENR (Sunyani). Kept here so signup,
// profile updates and any migration all share one source of truth.
const SEEKER_BASE = {
  location: 'UENR (University of Energy and Natural Resources), Sunyani, Bono Region, Ghana',
  lat: 7.3470,
  lng: -2.3417
};

module.exports = { SEEKER_BASE };

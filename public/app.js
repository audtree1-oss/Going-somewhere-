// Going Somewhere! — front end. One mobile-first vanilla-JS page, no build step.
// It plans the people, not just the places.

/* global L */

const $app = document.getElementById('app');

const state = {
  me: null,
  trips: [],
  trip: null,          // full payload from /api/trips/:id
  tripId: null,
  tab: 'today',
  err: '',
  notice: '',
  map: null,
  mapLayer: null,
  mapDay: 'all',
  routeInfo: null,     // today's route legs
  weather: null,
  momMode: false,
  refreshTimer: null,
  countdownTimer: null,
};

const CATEGORY_META = {
  restaurant: ['🍽️', 'Restaurant'], coffee: ['☕', 'Coffee'], hotel: ['🏨', 'Hotel'],
  overlook: ['🌄', 'Scenic overlook'], park: ['🏞️', 'Park'], mountains: ['🏔️', 'Mountains'],
  museum: ['🏛️', 'Museum'], shopping: ['🛍️', 'Shopping'], hiking: ['🥾', 'Hiking'],
  beach: ['🏖️', 'Beach'], concert: ['🎸', 'Concert'], show: ['🎭', 'Show'],
  roadside: ['🛸', 'Roadside attraction'], gem: ['💎', 'Hidden gem'], gas: ['⛽', 'Gas'],
  rest: ['🚻', 'Rest stop'], other: ['📍', 'Stop'],
};

const STATUS_META = {
  ready: ['✅', "I'm ready"], here: ['📍', "I'm here"], need10: ['⏳', 'Need 10 min'],
  hungry: ['🍔', 'Hungry'], bathroom: ['🚻', 'Bathroom stop'], lowenergy: ['🪫', 'Low energy'],
  quiet: ['🤫', 'Need quiet'], skipping: ['🙅', 'Skipping this one'], gowithout: ['👋', 'Go without me'],
  changed: ['❗', 'Something changed'],
};

// The full Travel Rhythm quiz. Every question is skippable — skipped
// questions simply don't exist in the profile.
const RHYTHM_QUESTIONS = [
  { id: 'pace', q: 'Structured or spontaneous?', opts: ['Structured', 'Mostly structured', 'A mix', 'Mostly spontaneous', 'Fully spontaneous'] },
  { id: 'morning', q: 'Early starter or slow morning?', opts: ['Early bird', 'Depends on the day', 'Slow morning, please'] },
  { id: 'density', q: 'Packed days or breathing room?', opts: ['Pack it in', 'Balanced', 'Breathing room'] },
  { id: 'walking', q: 'Comfortable walking distance in a day?', opts: ['Under 1 mile', '1–3 miles', '3–6 miles', 'The more the better'] },
  { id: 'food', q: 'Food restrictions or strong preferences?', free: true, ph: 'e.g. vegetarian, no shellfish, must have coffee by 9am' },
  { id: 'spending', q: 'Spending comfort?', opts: ['Keep it cheap', 'Moderate', 'Comfortable splurging', "Sky's the limit"] },
  { id: 'mustdo', q: 'Must-do experiences this kind of trip?', free: true, ph: 'e.g. one great sunset, a national park, local diners' },
  { id: 'hardno', q: 'Hard no experiences?', free: true, ph: 'e.g. no heights, no caves, no six-mile hikes' },
  { id: 'alone', q: 'Need for alone time?', opts: ['Lots', 'Some', 'A little', "None — let's hang"] },
  { id: 'breaks', q: 'How often do you need food, rest, or bathroom stops?', opts: ['About every hour', 'Every 2 hours', 'Every 3+ hours', "I'm a camel"] },
  { id: 'split', q: 'Comfortable splitting from the group sometimes?', opts: ['Love it', 'Fine sometimes', 'Prefer we stay together'] },
  { id: 'personality', q: 'Your vacation personality?', opts: ['🏕️ Adventure Seeker', '🍽️ Foodie', '📚 History Buff', '🛍️ Shopper', '😴 Relaxer', '📸 Photographer'] },
];
const VIS_LABELS = { shared: 'Shared with group', captain: 'Captain only', private: 'Just for me' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(iso, opts = { weekday: 'long', month: 'long', day: 'numeric' }) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}
function fmtTime(hm) {
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ap}`;
}
function minusMinutes(hm, mins) {
  const [h, m] = hm.split(':').map(Number);
  let t = h * 60 + m - mins;
  if (t < 0) t = 0;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
function tripDays(trip) {
  const days = [];
  if (trip.start_date && trip.end_date && trip.end_date >= trip.start_date) {
    const [y, m, d] = trip.start_date.split('-').map(Number);
    const cur = new Date(y, m - 1, d);
    for (let i = 0; i < 60; i++) {
      const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
      days.push(iso);
      if (iso === trip.end_date) break;
      cur.setDate(cur.getDate() + 1);
    }
  }
  for (const s of (state.trip?.stops || [])) {
    if (s.day_date && !days.includes(s.day_date)) days.push(s.day_date);
  }
  return days.sort();
}
function stopsForDay(day) {
  return (state.trip.stops || []).filter((s) => s.day_date === day && s.state === 'active');
}
function catIco(c) { return (CATEGORY_META[c] || CATEGORY_META.other)[0]; }
function weatherEmoji(code) {
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '🌨️';
  if (code <= 82) return '🌧️';
  return '⛈️';
}
function firstName(n) { return String(n || '').split(' ')[0]; }
function timeAgo(iso) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso.replace(' ', 'T') + 'Z').getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

// ---------------------------------------------------------------------------
// Boot & routing
// ---------------------------------------------------------------------------
async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.get('code')) {
    localStorage.setItem('gs_pending_code', params.get('code').toUpperCase());
    history.replaceState({}, '', '/');
  }
  try {
    const { user } = await api('/api/me');
    state.me = user;
  } catch { state.me = null; }
  if (state.me) {
    await joinPendingCode();
    await loadTrips();
    renderTrips();
  } else {
    renderAuth();
  }
}

async function joinPendingCode() {
  const code = localStorage.getItem('gs_pending_code');
  if (!code) return;
  localStorage.removeItem('gs_pending_code');
  try {
    const r = await api('/api/join', { method: 'POST', body: { code } });
    state.notice = r.already ? "You're already on this trip!" : "YOU'RE IN! Welcome aboard!! 🚗💨";
    if (!r.already) setTimeout(() => confetti(), 400);
    state.tripId = r.trip_id;
  } catch (e) { state.err = e.message; }
}

async function loadTrips() {
  const { trips } = await api('/api/trips');
  state.trips = trips;
}

async function loadTrip(id) {
  state.trip = await api(`/api/trips/${id}`);
  state.tripId = id;
}

function startRefresh() {
  stopRefresh();
  state.refreshTimer = setInterval(async () => {
    if (!state.tripId || document.hidden) return;
    try {
      await loadTrip(state.tripId);
      if (['people', 'decide'].includes(state.tab)) renderTrip();
    } catch { /* offline is fine */ }
  }, 30000);
}
function stopRefresh() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  if (state.countdownTimer) clearInterval(state.countdownTimer);
  state.refreshTimer = state.countdownTimer = null;
}

// ---------------------------------------------------------------------------
// Auth screen
// ---------------------------------------------------------------------------
function renderAuth(mode = 'login') {
  stopRefresh();
  $app.innerHTML = `
    <div class="screen">
      <div class="auth-hero">
        <div class="logo">🚗💨</div>
        <h1>Going Somewhere!</h1>
        <p>Grab your people. Pack your bags. <strong>GO.</strong></p>
      </div>
      ${state.err ? `<div class="err">${esc(state.err)}</div>` : ''}
      <div class="card">
        <form id="authForm">
          ${mode === 'signup' ? `
          <div class="field"><label>Your name</label><input name="name" autocomplete="name" required></div>` : ''}
          <div class="field"><label>Email</label><input name="email" type="email" autocomplete="email" required></div>
          <div class="field"><label>Password</label><input name="password" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" minlength="8" required></div>
          <button class="btn full" type="submit">${mode === 'signup' ? 'Create my account' : 'Log in'}</button>
        </form>
      </div>
      <p class="muted" style="text-align:center">
        ${mode === 'signup' ? 'Already have an account?' : 'New here?'}
        <a href="#" id="authSwap">${mode === 'signup' ? 'Log in' : 'Create an account'}</a>
      </p>
    </div>`;
  state.err = '';
  document.getElementById('authSwap').onclick = (e) => { e.preventDefault(); renderAuth(mode === 'signup' ? 'login' : 'signup'); };
  document.getElementById('authForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api(mode === 'signup' ? '/api/signup' : '/api/login', {
        method: 'POST',
        body: { name: f.get('name'), email: f.get('email'), password: f.get('password') },
      });
      await boot();
    } catch (err) { state.err = err.message; renderAuth(mode); }
  };
}

// ---------------------------------------------------------------------------
// Trips list
// ---------------------------------------------------------------------------
async function renderTrips() {
  stopRefresh();
  if (state.tripId && localStorage.getItem('gs_pending_code') === null && state.notice.includes('aboard')) {
    // just joined via link — go straight in
    const id = state.tripId; state.tripId = null;
    await openTrip(id);
    return;
  }
  $app.innerHTML = `
    <div class="topbar">
      <h1>🚗 Going Somewhere!</h1>
      <button class="mini" id="logoutBtn">Log out</button>
    </div>
    <div class="screen">
      ${state.notice ? `<div class="notice">${esc(state.notice)}</div>` : ''}
      ${state.err ? `<div class="err">${esc(state.err)}</div>` : ''}
      <p class="muted" style="margin:4px 2px 14px">Hey ${esc(firstName(state.me.name))}! Where are we going?! 🎉</p>
      <div id="tripList"></div>
      <div class="section-label">Joining someone's trip?</div>
      <div class="card">
        <form id="joinForm" class="row">
          <input class="grow" name="code" placeholder="Invite code (e.g. 4F2A9B01)" style="padding:10px 12px;border:1.5px solid var(--line);border-radius:10px" required>
          <button class="btn sm" type="submit">Join</button>
        </form>
      </div>
    </div>
    <button class="fab" id="newTripBtn" title="New trip">+</button>`;
  state.notice = ''; state.err = '';

  const list = document.getElementById('tripList');
  if (!state.trips.length) {
    list.innerHTML = `<div class="card" style="text-align:center;padding:30px 16px">
      <div style="font-size:40px">🗺️</div>
      <h3 style="margin:8px 0 4px">No trips yet?!</h3>
      <p class="muted">Unacceptable. Tap the + button and let's fix that immediately.</p></div>`;
  }
  for (const t of state.trips) {
    const cover = t.cover_file ? `style="background-image:url('/covers/${esc(t.cover_file)}')"` : '';
    const card = el(`<button class="trip-card">
      <div class="trip-cover" ${cover}>${t.cover_file ? '' : esc(t.cover_emoji || '🚗')}</div>
      <div class="body">
        <h3>${esc(t.name)}</h3>
        <div class="muted">${t.start_date ? `${fmtDate(t.start_date, { month: 'short', day: 'numeric' })} – ${fmtDate(t.end_date || t.start_date, { month: 'short', day: 'numeric' })} · ` : ''}${t.member_count} traveler${t.member_count === 1 ? '' : 's'} · ${t.stop_count} stop${t.stop_count === 1 ? '' : 's'}
        ${t.role === 'captain' ? ' · <span class="pill captain">Captain</span>' : ''}</div>
      </div></button>`);
    card.onclick = () => openTrip(t.id);
    list.appendChild(card);
  }
  document.getElementById('newTripBtn').onclick = () => tripModal();
  document.getElementById('logoutBtn').onclick = async () => { await api('/api/logout', { method: 'POST' }); state.me = null; renderAuth(); };
  document.getElementById('joinForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/join', { method: 'POST', body: { code: new FormData(e.target).get('code') } });
      if (!r.already) confetti();
      await loadTrips();
      await openTrip(r.trip_id);
    } catch (err) { state.err = err.message; renderTrips(); }
  };
}

async function openTrip(id) {
  try {
    await loadTrip(id);
    state.tab = 'today';
    state.mapDay = 'all';
    renderTrip();
    startRefresh();
  } catch (e) { state.err = e.message; renderTrips(); }
}

// ---------------------------------------------------------------------------
// Trip shell + tabs
// ---------------------------------------------------------------------------
function renderTrip() {
  const t = state.trip.trip;
  const isCaptain = state.trip.me.role === 'captain';
  $app.innerHTML = `
    <div class="topbar">
      <button class="back" id="backBtn">‹</button>
      <h1>${esc(t.cover_emoji)} ${esc(t.name)}</h1>
      ${isCaptain ? '<button class="mini" id="tripEditBtn">Edit</button>' : ''}
    </div>
    <div class="${state.tab === 'map' ? 'screen no-pad' : 'screen'}" id="tabContent"></div>
    <nav class="tabbar">
      ${[['today', '🌞', 'Today'], ['plan', '🗓️', 'Plan'], ['map', '🗺️', 'Map'], ['people', '👥', 'People'], ['decide', '🗳️', 'Decide']]
        .map(([k, i, l]) => `<button data-tab="${k}" class="${state.tab === k ? 'active' : ''}"><span class="ico">${i}</span>${l}</button>`).join('')}
    </nav>`;
  document.getElementById('backBtn').onclick = async () => { state.trip = null; state.tripId = null; await loadTrips(); renderTrips(); };
  if (isCaptain) document.getElementById('tripEditBtn').onclick = () => tripModal(t);
  document.querySelectorAll('.tabbar button').forEach((b) => {
    b.onclick = () => { state.tab = b.dataset.tab; renderTrip(); };
  });
  const c = document.getElementById('tabContent');
  if (state.tab === 'today') renderToday(c);
  else if (state.tab === 'plan') renderPlan(c);
  else if (state.tab === 'map') renderMap(c);
  else if (state.tab === 'people') renderPeople(c);
  else if (state.tab === 'decide') renderDecide(c);
  if (state.momMode) renderMomMode();
}

// ---------------------------------------------------------------------------
// TODAY — the heart of the app
// ---------------------------------------------------------------------------
async function renderToday(c) {
  const t = state.trip.trip;
  const today = todayStr();
  const days = tripDays(t);
  let day = today;
  let label = 'Today';
  if (days.length && today < days[0]) { day = days[0]; label = 'First day'; }
  else if (days.length && today > days[days.length - 1]) { day = days[days.length - 1]; label = 'Last day (already home?)'; }

  const dayNum = days.indexOf(day) + 1;
  const stops = stopsForDay(day);
  const geoStops = stops.filter((s) => s.lat != null && s.lng != null);
  const hotelTonight = [...(state.trip.stops || [])]
    .filter((s) => s.category === 'hotel' && s.state === 'active' && s.day_date && s.day_date <= day)
    .sort((a, b) => a.day_date.localeCompare(b.day_date)).pop() || null;

  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const countdownDays = t.start_date && today < t.start_date
    ? Math.ceil((new Date(t.start_date) - new Date(today)) / 86400000) : 0;

  c.innerHTML = `
    <div class="today-hero">
      <div class="hello">${hello}, ${esc(firstName(state.me.name))}! ${hour < 12 ? '☀️' : '🌵'}</div>
      <div class="date">${fmtDate(day)}${dayNum > 0 && days.length ? ` · Day ${dayNum} of ${days.length}` : ''}${label !== 'Today' ? ` · ${label}` : ''}</div>
      ${day === t.start_date && today === day ? `<div style="margin-top:10px;font-weight:800;font-size:17px">🎉🎉 IT'S TRIP DAY!! 🎉🎉</div>`
        : countdownDays > 0 ? `<div style="margin-top:10px;font-weight:700">🔥 ${countdownDays} day${countdownDays === 1 ? '' : 's'} until takeoff — get hyped!</div>` : ''}
      <div class="today-stats" id="todayStats"></div>
    </div>
    <div id="todayBody"></div>
    <button class="btn ghost full" id="momBtn" style="margin-top:6px">🔎 Big &amp; Simple view</button>`;

  document.getElementById('momBtn').onclick = () => { state.momMode = { day, stops }; renderMomMode(); };

  const body = document.getElementById('todayBody');
  if (!stops.length) {
    body.innerHTML = `<div class="card" style="text-align:center;padding:26px">
      <div style="font-size:36px">🧭</div>
      <h3 style="margin:6px 0 4px">Nothing planned for this day yet</h3>
      <p class="muted">Head to the Plan tab to add stops — they'll show up here as a timeline.</p></div>`;
  } else {
    body.innerHTML = `<div class="section-label">The plan</div><div class="timeline" id="tl"></div>`;
  }

  // Route legs between today's geo stops
  let route = null;
  if (geoStops.length >= 2) {
    try { route = await api('/api/route', { method: 'POST', body: { coords: geoStops.map((s) => [s.lng, s.lat]) } }); }
    catch { route = null; }
  }

  // Stats
  const stats = [];
  const firstTimed = stops.find((s) => s.arrive);
  if (firstTimed) {
    let ready = fmtTime(firstTimed.arrive);
    let k = 'first stop';
    if (route && route.legs.length && stops[0].arrive) { ready = fmtTime(minusMinutes(stops[0].arrive, 10)); k = 'be ready by'; }
    stats.push([ready, k]);
  }
  if (route && route.duration_min != null) {
    const h = Math.floor(route.duration_min / 60), m = route.duration_min % 60;
    stats.push([`${h ? h + 'h ' : ''}${m}m`, 'driving']);
    stats.push([`${route.distance_mi} mi`, 'distance']);
  }
  stats.push([`${stops.length}`, stops.length === 1 ? 'stop' : 'stops']);

  // Weather
  const wxStop = geoStops[0] || (hotelTonight && hotelTonight.lat != null ? hotelTonight : null);
  if (wxStop) {
    try {
      const { weather } = await api(`/api/weather?lat=${wxStop.lat}&lng=${wxStop.lng}`);
      if (weather && weather.daily) {
        const idx = weather.daily.time.indexOf(day);
        if (idx >= 0) {
          stats.unshift([`${weatherEmoji(weather.daily.weather_code[idx])} ${Math.round(weather.daily.temperature_2m_max[idx])}°`, 'high today']);
          if (weather.daily.precipitation_probability_max[idx] >= 40) {
            stats.push([`💧 ${weather.daily.precipitation_probability_max[idx]}%`, 'rain chance']);
          }
        }
      }
    } catch { /* weather is a nicety */ }
  }
  document.getElementById('todayStats').innerHTML =
    stats.map(([v, k]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');

  // Timeline
  if (stops.length) {
    const tl = document.getElementById('tl');
    let legIdx = 0;
    stops.forEach((s, i) => {
      const isLast = i === stops.length - 1;
      const timeBits = [s.arrive && fmtTime(s.arrive), s.depart && `until ${fmtTime(s.depart)}`].filter(Boolean).join(' ');
      const node = el(`<div class="tl-stop">
        <div class="tl-rail"><div class="tl-dot">${catIco(s.category)}</div>${isLast ? '' : '<div class="tl-line"></div>'}</div>
        <div class="tl-body">
          <div class="card" style="margin-bottom:0">
            <div class="spread"><strong>${esc(s.name)}</strong>${s.priority === 'must' ? '<span class="pill must">must-do</span>' : s.priority === 'iftime' ? '<span class="pill iftime">if we have time</span>' : ''}</div>
            ${timeBits ? `<div class="muted">${timeBits}${s.visit_min ? ` · ~${s.visit_min} min` : ''}</div>` : ''}
            ${s.address ? `<div class="muted small">📍 ${esc(s.address)} ${s.lat != null ? `· <a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}" target="_blank" rel="noopener">directions</a>` : ''}</div>` : ''}
            ${s.notes ? `<div class="small" style="margin-top:4px">${esc(s.notes)}</div>` : ''}
          </div>
          ${!isLast && route && geoStops.includes(s) && legIdx < route.legs.length && geoStops.includes(stops[i + 1]) ? `<div class="tl-drive">🚗 ${route.legs[legIdx].duration_min} min · ${route.legs[legIdx].distance_mi} mi</div>` : ''}
        </div></div>`);
      if (!isLast && route && geoStops.includes(s) && geoStops.includes(stops[i + 1])) legIdx++;
      tl.appendChild(node);
    });
  }

  // Hotel tonight
  if (hotelTonight) {
    const x = hotelTonight.extra || {};
    body.insertAdjacentHTML('beforeend', `
      <div class="section-label">Tonight</div>
      <div class="card">
        <div class="row"><span style="font-size:24px">🏨</span><div class="grow">
          <strong>${esc(hotelTonight.name)}</strong>
          ${hotelTonight.address ? `<div class="muted small">📍 ${esc(hotelTonight.address)}</div>` : ''}
        </div></div>
        <div class="small" style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:4px 10px">
          ${x.checkin ? `<span>🕒 Check-in ${esc(x.checkin)}</span>` : ''}
          ${x.confirmation ? `<span>🎫 Conf. ${esc(x.confirmation)}</span>` : ''}
          ${x.phone ? `<span>📞 ${esc(x.phone)}</span>` : ''}
          ${x.wifi ? `<span>📶 Wi-Fi: ${esc(x.wifi)}</span>` : ''}
          ${hotelTonight.parking ? `<span>🅿️ ${esc(hotelTonight.parking)}</span>` : ''}
        </div>
      </div>`);
  }

  // If-we-have-time nudge
  const wishlist = (state.trip.stops || []).filter((s) => !s.day_date && s.state === 'active' && s.priority === 'iftime');
  if (wishlist.length) {
    body.insertAdjacentHTML('beforeend', `
      <div class="section-label">If we have time ⏳</div>
      <div class="card"><div class="muted small" style="margin-bottom:6px">Ahead of schedule? These are waiting nearby-ish:</div>
        ${wishlist.slice(0, 4).map((s) => `<div class="row" style="padding:4px 0">${catIco(s.category)} <span class="grow">${esc(s.name)}</span></div>`).join('')}
      </div>`);
  }
}

// ---------------------------------------------------------------------------
// Mom Mode — big text, today only, nothing else
// ---------------------------------------------------------------------------
function renderMomMode() {
  const { day, stops } = state.momMode;
  const old = document.querySelector('.mom-mode');
  if (old) old.remove();
  const wrap = el(`<div class="mom-mode">
    <button class="mom-close">Close ✕</button>
    <h1>Today's Plan</h1>
    <div class="mom-date">${fmtDate(day)}</div>
    ${stops.length ? stops.map((s) => `
      <div class="mom-stop">
        ${s.arrive ? `<div class="t">${fmtTime(s.arrive)}</div>` : ''}
        <div class="n">${catIco(s.category)} ${esc(s.name)}</div>
        ${s.address ? `<div class="d">${esc(s.address)}</div>` : ''}
        ${s.notes ? `<div class="d">${esc(s.notes)}</div>` : ''}
      </div>`).join('') : '<div class="mom-stop"><div class="n">🧘 Free day — no plans!</div></div>'}
  </div>`);
  wrap.querySelector('.mom-close').onclick = () => { state.momMode = false; wrap.remove(); };
  document.body.appendChild(wrap);
}

// ---------------------------------------------------------------------------
// PLAN — itinerary builder
// ---------------------------------------------------------------------------
function renderPlan(c) {
  const t = state.trip.trip;
  const me = state.trip.me;
  const editable = me.role === 'captain' || me.permission === 'edit';
  const suggestable = editable || me.permission === 'suggest';
  const days = tripDays(t);
  const suggested = (state.trip.stops || []).filter((s) => s.state === 'suggested');
  const wishlist = (state.trip.stops || []).filter((s) => !s.day_date && s.state === 'active');

  c.innerHTML = `
    ${state.notice ? `<div class="notice">${esc(state.notice)}</div>` : ''}
    ${state.err ? `<div class="err">${esc(state.err)}</div>` : ''}
    <div class="row" style="margin-bottom:4px">
      <button class="btn sm grow" id="aiBtn">✨ Ask the assistant</button>
      <a class="btn sm quiet" href="/api/trips/${t.id}/export" style="text-decoration:none">Export</a>
    </div>
    ${suggested.length && editable ? `<div class="section-label">Suggested by travelers 💜</div><div id="suggestedList"></div>` : ''}
    <div id="daysList"></div>
    <div class="section-label">Wishlist / If we have time</div>
    <div id="wishList"></div>
    ${suggestable ? '<button class="fab" id="addStopBtn" title="Add stop">+</button>' : ''}`;
  state.notice = ''; state.err = '';

  document.getElementById('aiBtn').onclick = () => aiModal();
  if (suggestable) document.getElementById('addStopBtn').onclick = () => stopModal();

  const daysList = document.getElementById('daysList');
  if (!days.length) {
    daysList.innerHTML = `<div class="card"><p class="muted">Set trip dates (Edit, top right) to lay out days — or add stops to the wishlist below and sort them into days later.</p></div>`;
  }
  days.forEach((day, di) => {
    const stops = stopsForDay(day);
    const sec = el(`<div>
      <div class="day-head"><h3>Day ${di + 1}</h3><span class="muted small">${fmtDate(day, { weekday: 'short', month: 'short', day: 'numeric' })}</span></div>
      <div data-day="${day}"></div>
    </div>`);
    const holder = sec.querySelector('[data-day]');
    if (!stops.length) holder.innerHTML = '<div class="muted small" style="padding:0 4px 4px">Nothing yet.</div>';
    stops.forEach((s, i) => holder.appendChild(stopRow(s, { editable, canMove: editable, idx: i, total: stops.length, day, stops })));
    daysList.appendChild(sec);
  });

  const wishHolder = document.getElementById('wishList');
  if (!wishlist.length) wishHolder.innerHTML = '<div class="muted small" style="padding:0 4px">Cool finds with no day yet live here. The assistant adds ideas here too.</div>';
  wishlist.forEach((s) => wishHolder.appendChild(stopRow(s, { editable })));

  if (suggested.length && editable) {
    const sl = document.getElementById('suggestedList');
    suggested.forEach((s) => {
      const row = stopRow(s, { editable: false });
      row.classList.add('suggested');
      const who = (state.trip.members.find((m) => m.user_id === s.suggested_by) || {}).name;
      row.querySelector('.stop-main').insertAdjacentHTML('beforeend',
        `<div class="small" style="color:#8a4ba0;margin-top:2px">💡 suggested by ${esc(firstName(who || 'a traveler'))}</div>`);
      const tools = el('<div class="stop-tools"></div>');
      const ok = el('<button title="Approve">✅</button>');
      ok.onclick = async () => { await api(`/api/stops/${s.id}`, { method: 'PATCH', body: { approve: true } }); await reload('Added to the trip!'); };
      const no = el('<button title="Decline">✕</button>');
      no.onclick = async () => { await api(`/api/stops/${s.id}`, { method: 'DELETE' }); await reload(); };
      tools.append(ok, no);
      row.appendChild(tools);
      sl.appendChild(row);
    });
  }
}

function stopRow(s, { editable = false, canMove = false, idx = 0, total = 1, day = '', stops = [] } = {}) {
  const timeBits = [s.arrive && fmtTime(s.arrive), s.depart && `– ${fmtTime(s.depart)}`].filter(Boolean).join(' ');
  const row = el(`<div class="stop-row">
    <div class="stop-ico">${catIco(s.category)}</div>
    <div class="stop-main">
      <div class="nm">${esc(s.name)} ${s.priority === 'must' ? '<span class="pill must">must</span>' : s.priority === 'iftime' ? '<span class="pill iftime">if time</span>' : ''}</div>
      <div class="meta">${[timeBits, s.address, s.cost && `💵 ${s.cost}`].filter(Boolean).map(esc).join(' · ')}</div>
    </div>
  </div>`);
  row.querySelector('.stop-main').onclick = () => stopModal(s);
  if (editable && canMove) {
    const tools = el('<div class="stop-tools"></div>');
    const up = el(`<button ${idx === 0 ? 'disabled style="opacity:.25"' : ''}>▲</button>`);
    const down = el(`<button ${idx === total - 1 ? 'disabled style="opacity:.25"' : ''}>▼</button>`);
    up.onclick = () => moveStop(day, stops, idx, -1);
    down.onclick = () => moveStop(day, stops, idx, 1);
    tools.append(up, down);
    row.appendChild(tools);
  }
  return row;
}

async function moveStop(day, stops, idx, dir) {
  const ids = stops.map((s) => s.id);
  const [moved] = ids.splice(idx, 1);
  ids.splice(idx + dir, 0, moved);
  await api(`/api/trips/${state.tripId}/reorder`, { method: 'POST', body: { day_date: day, ids } });
  await reload();
}

async function reload(notice) {
  if (notice) state.notice = notice;
  await loadTrip(state.tripId);
  renderTrip();
}

// ---------------------------------------------------------------------------
// Stop editor modal (with map search)
// ---------------------------------------------------------------------------
function stopModal(s = null) {
  const me = state.trip.me;
  const editable = me.role === 'captain' || me.permission === 'edit';
  const isNew = !s;
  const readOnly = !isNew && !editable;
  const days = tripDays(state.trip.trip);
  const x = (s && s.extra) || {};
  const modal = openModal(`
    <h2>${isNew ? 'Add a stop' : readOnly ? esc(s.name) : 'Edit stop'}</h2>
    <div id="mErr"></div>
    <form id="stopForm">
      <div class="field"><label>Search the map 🔎</label>
        <input id="geoQ" placeholder="Type a place — e.g. Bearizona Wildlife Park" autocomplete="off" ${readOnly ? 'disabled' : ''}>
        <div id="geoResults"></div>
      </div>
      <div class="field"><label>Name</label><input name="name" required value="${esc(s?.name || '')}" ${readOnly ? 'disabled' : ''}></div>
      <div class="field-row">
        <div class="field"><label>Category</label>
          <select name="category" ${readOnly ? 'disabled' : ''}>${Object.entries(CATEGORY_META).map(([k, [i, l]]) =>
            `<option value="${k}" ${s?.category === k ? 'selected' : ''}>${i} ${l}</option>`).join('')}</select></div>
        <div class="field"><label>Priority</label>
          <select name="priority" ${readOnly ? 'disabled' : ''}>
            <option value="must" ${s?.priority === 'must' ? 'selected' : ''}>⭐ Must do</option>
            <option value="like" ${!s || s.priority === 'like' ? 'selected' : ''}>👍 Would like to</option>
            <option value="iftime" ${s?.priority === 'iftime' ? 'selected' : ''}>⏳ If we have time</option>
          </select></div>
      </div>
      <div class="field"><label>Day</label>
        <select name="day_date" ${readOnly ? 'disabled' : ''}>
          <option value="">🧺 Wishlist (no day yet)</option>
          ${days.map((d, i) => `<option value="${d}" ${s?.day_date === d ? 'selected' : ''}>Day ${i + 1} — ${fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' })}</option>`).join('')}
        </select></div>
      <div class="field-row">
        <div class="field"><label>Arrive</label><input name="arrive" type="time" value="${esc(s?.arrive || '')}" ${readOnly ? 'disabled' : ''}></div>
        <div class="field"><label>Depart</label><input name="depart" type="time" value="${esc(s?.depart || '')}" ${readOnly ? 'disabled' : ''}></div>
        <div class="field"><label>Visit (min)</label><input name="visit_min" type="number" min="0" value="${s?.visit_min || ''}" ${readOnly ? 'disabled' : ''}></div>
      </div>
      <div class="field"><label>Address</label><input name="address" value="${esc(s?.address || '')}" ${readOnly ? 'disabled' : ''}></div>
      <input type="hidden" name="lat" value="${s?.lat ?? ''}"><input type="hidden" name="lng" value="${s?.lng ?? ''}">
      <div class="field"><label>Notes</label><textarea name="notes" ${readOnly ? 'disabled' : ''}>${esc(s?.notes || '')}</textarea></div>
      <div class="field-row">
        <div class="field"><label>Cost</label><input name="cost" placeholder="$25/person" value="${esc(s?.cost || '')}" ${readOnly ? 'disabled' : ''}></div>
        <div class="field"><label>Hours</label><input name="hours" placeholder="9am–6pm, closed Mon" value="${esc(s?.hours || '')}" ${readOnly ? 'disabled' : ''}></div>
      </div>
      <div class="field"><label>Website</label><input name="website" value="${esc(s?.website || '')}" ${readOnly ? 'disabled' : ''}></div>
      <div class="field-row">
        <div class="field"><label>Parking</label><input name="parking" value="${esc(s?.parking || '')}" ${readOnly ? 'disabled' : ''}></div>
        <div class="field"><label>Accessibility</label><input name="accessibility" value="${esc(s?.accessibility || '')}" ${readOnly ? 'disabled' : ''}></div>
      </div>
      <div id="hotelFields" style="display:none">
        <div class="section-label" style="margin-top:4px">Hotel details 🏨</div>
        <div class="field-row">
          <div class="field"><label>Confirmation #</label><input name="x_confirmation" value="${esc(x.confirmation || '')}" ${readOnly ? 'disabled' : ''}></div>
          <div class="field"><label>Phone</label><input name="x_phone" value="${esc(x.phone || '')}" ${readOnly ? 'disabled' : ''}></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Check-in</label><input name="x_checkin" placeholder="3:00 PM" value="${esc(x.checkin || '')}" ${readOnly ? 'disabled' : ''}></div>
          <div class="field"><label>Check-out</label><input name="x_checkout" placeholder="11:00 AM" value="${esc(x.checkout || '')}" ${readOnly ? 'disabled' : ''}></div>
        </div>
        <div class="field"><label>Wi-Fi</label><input name="x_wifi" placeholder="network / password" value="${esc(x.wifi || '')}" ${readOnly ? 'disabled' : ''}></div>
      </div>
      ${readOnly ? '' : `<button class="btn full" type="submit">${isNew ? (editable ? 'Add stop' : 'Suggest this stop 💜') : 'Save changes'}</button>`}
      ${!isNew && editable ? '<button class="btn danger full" type="button" id="delStop" style="margin-top:8px">Remove stop</button>' : ''}
    </form>`);

  const form = modal.querySelector('#stopForm');
  const catSel = form.querySelector('[name=category]');
  const syncHotel = () => { modal.querySelector('#hotelFields').style.display = catSel.value === 'hotel' ? '' : 'none'; };
  catSel.onchange = syncHotel; syncHotel();

  // Geocode search
  const geoQ = modal.querySelector('#geoQ');
  const geoResults = modal.querySelector('#geoResults');
  let geoTimer = null;
  geoQ.oninput = () => {
    clearTimeout(geoTimer);
    const q = geoQ.value.trim();
    if (q.length < 3) { geoResults.innerHTML = ''; return; }
    geoTimer = setTimeout(async () => {
      geoResults.innerHTML = '<div class="muted small" style="padding:6px 10px">Searching…</div>';
      try {
        const { results } = await api(`/api/geocode?q=${encodeURIComponent(q)}`);
        geoResults.innerHTML = results.length ? '' : '<div class="muted small" style="padding:6px 10px">No matches — you can still fill it in by hand.</div>';
        results.forEach((r) => {
          const b = el(`<button type="button" class="geo-result"><strong>${esc(r.name)}</strong><span class="muted small">${esc(r.display)}</span></button>`);
          b.onclick = () => {
            if (!form.name.value) form.name.value = r.name;
            form.address.value = r.display;
            form.lat.value = r.lat; form.lng.value = r.lng;
            geoResults.innerHTML = `<div class="notice" style="margin:6px 0 0">📍 Pinned to the map!</div>`;
          };
          geoResults.appendChild(b);
        });
      } catch { geoResults.innerHTML = ''; }
    }, 400);
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const extra = { ...(x || {}) };
    for (const k of ['confirmation', 'phone', 'checkin', 'checkout', 'wifi']) {
      const v = String(f.get(`x_${k}`) || '').trim();
      if (v) extra[k] = v; else delete extra[k];
    }
    const body = {
      name: f.get('name'), category: f.get('category'), priority: f.get('priority'),
      day_date: f.get('day_date'), arrive: f.get('arrive'), depart: f.get('depart'),
      visit_min: f.get('visit_min'), address: f.get('address'),
      lat: f.get('lat') || null, lng: f.get('lng') || null,
      notes: f.get('notes'), cost: f.get('cost'), hours: f.get('hours'), website: f.get('website'),
      parking: f.get('parking'), accessibility: f.get('accessibility'), extra,
    };
    try {
      if (isNew) {
        const r = await api(`/api/trips/${state.tripId}/stops`, { method: 'POST', body });
        closeModal();
        await reload(r.state === 'suggested' ? 'Suggested! The captain will see it. 💜' : 'Stop added!');
      } else {
        await api(`/api/stops/${s.id}`, { method: 'PATCH', body });
        closeModal();
        await reload();
      }
    } catch (err) { modal.querySelector('#mErr').innerHTML = `<div class="err">${esc(err.message)}</div>`; }
  };
  const del = modal.querySelector('#delStop');
  if (del) del.onclick = async () => {
    if (!confirm(`Remove "${s.name}" from the trip?`)) return;
    await api(`/api/stops/${s.id}`, { method: 'DELETE' });
    closeModal();
    await reload();
  };
}

// ---------------------------------------------------------------------------
// AI assistant modal
// ---------------------------------------------------------------------------
function aiModal() {
  const modal = openModal(`
    <h2>✨ Trip assistant</h2>
    <p class="muted" style="margin-bottom:10px">Try: “find attractions between Kingman and Flagstaff”, “great lunch spots near the Grand Canyon under $25”, “hidden gems along our drive”.</p>
    <form id="aiForm" class="row" style="margin-bottom:12px">
      <input class="grow" name="prompt" placeholder="Ask about the trip…" style="padding:10px 12px;border:1.5px solid var(--line);border-radius:10px" required>
      <button class="btn sm" type="submit">Ask</button>
    </form>
    <div id="aiOut"></div>`);
  modal.querySelector('#aiForm').onsubmit = async (e) => {
    e.preventDefault();
    const out = modal.querySelector('#aiOut');
    out.innerHTML = '<div class="muted" style="text-align:center;padding:16px">🧠 Thinking about your route…</div>';
    try {
      const r = await api(`/api/trips/${state.tripId}/ai/suggest`, { method: 'POST', body: { prompt: new FormData(e.target).get('prompt') } });
      if (r.note) { out.innerHTML = `<div class="card"><p class="muted">${esc(r.note)}</p></div>`; return; }
      out.innerHTML = r.intro ? `<p style="margin-bottom:10px">${esc(r.intro)}</p>` : '';
      r.suggestions.forEach((sg) => {
        const card = el(`<div class="card">
          <div class="spread"><strong>${catIco(sg.category)} ${esc(sg.name)}</strong>
            <button class="btn sm">＋ Wishlist</button></div>
          <p class="muted small" style="margin-top:4px">${esc(sg.description || '')}</p></div>`);
        card.querySelector('button').onclick = async (ev) => {
          ev.target.disabled = true; ev.target.textContent = 'Adding…';
          let lat = null, lng = null, address = '';
          try {
            const { results } = await api(`/api/geocode?q=${encodeURIComponent(sg.search || sg.name)}`);
            if (results[0]) { lat = results[0].lat; lng = results[0].lng; address = results[0].display; }
          } catch { /* fine without pin */ }
          await api(`/api/trips/${state.tripId}/stops`, {
            method: 'POST',
            body: { name: sg.name, category: CATEGORY_META[sg.category] ? sg.category : 'other', notes: sg.description || '', day_date: '', priority: 'iftime', lat, lng, address },
          });
          ev.target.textContent = '✓ Added';
          await loadTrip(state.tripId);
        };
        out.appendChild(card);
      });
    } catch (err) { out.innerHTML = `<div class="err">${esc(err.message)}</div>`; }
  };
}

// ---------------------------------------------------------------------------
// MAP
// ---------------------------------------------------------------------------
async function renderMap(c) {
  const days = tripDays(state.trip.trip);
  c.innerHTML = `
    <div class="map-day-picker" id="dayPicker">
      <button data-day="all" class="${state.mapDay === 'all' ? 'active' : ''}">Whole trip</button>
      ${days.map((d, i) => `<button data-day="${d}" class="${state.mapDay === d ? 'active' : ''}">Day ${i + 1}</button>`).join('')}
      <button data-day="" class="${state.mapDay === '' ? 'active' : ''}">Wishlist</button>
    </div>
    <div id="map"></div>
    <div class="map-summary" id="mapSummary">Pins from your plan. Tap one for details.</div>`;
  c.querySelectorAll('#dayPicker button').forEach((b) => {
    b.onclick = () => { state.mapDay = b.dataset.day; renderTrip(); };
  });

  const stops = (state.trip.stops || []).filter((s) =>
    s.state === 'active' && s.lat != null && s.lng != null &&
    (state.mapDay === 'all' ? true : s.day_date === state.mapDay));

  const map = L.map('map', { zoomControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  if (!stops.length) {
    map.setView([39.5, -98.35], 4); // continental US
    document.getElementById('mapSummary').textContent = 'No pinned stops here yet — use the map search when adding a stop to pin it.';
    return;
  }
  const markers = stops.map((s) => {
    const mk = L.marker([s.lat, s.lng], {
      icon: L.divIcon({
        className: '', iconSize: [34, 34], iconAnchor: [17, 17],
        html: `<div style="width:34px;height:34px;border-radius:50%;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:18px">${catIco(s.category)}</div>`,
      }),
    }).addTo(map);
    mk.bindPopup(`<div class="nm">${esc(s.name)}</div>
      ${s.day_date ? `<div>Day ${days.indexOf(s.day_date) + 1}${s.arrive ? ' · ' + fmtTime(s.arrive) : ''}</div>` : '<div>Wishlist</div>'}
      ${s.notes ? `<div>${esc(s.notes)}</div>` : ''}
      <a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}" target="_blank" rel="noopener">Directions</a>`);
    return mk;
  });
  map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2));

  // Route line for a single day (ordered) or the whole trip (day by day)
  const routeStops = state.mapDay === '' ? [] : stops.filter((s) => s.day_date);
  if (routeStops.length >= 2) {
    try {
      const r = await api('/api/route', { method: 'POST', body: { coords: routeStops.map((s) => [s.lng, s.lat]) } });
      if (r.geometry) {
        L.geoJSON(r.geometry, { style: { color: '#e8763a', weight: 4, opacity: 0.75 } }).addTo(map);
        const h = Math.floor(r.duration_min / 60), m = r.duration_min % 60;
        document.getElementById('mapSummary').textContent =
          `🚗 ${h ? h + 'h ' : ''}${m}m driving · ${r.distance_mi} miles across ${routeStops.length} stops`;
      }
    } catch { /* map still useful without the line */ }
  }
}

// ---------------------------------------------------------------------------
// PEOPLE — pulse, invites, Travel Rhythm
// ---------------------------------------------------------------------------
function renderPeople(c) {
  const me = state.trip.me;
  const isCaptain = me.role === 'captain';
  const members = state.trip.members;
  const readyCount = members.filter((m) => m.status === 'ready' || m.status === 'here').length;

  c.innerHTML = `
    ${state.notice ? `<div class="notice">${esc(state.notice)}</div>` : ''}
    <div class="section-label">How are you doing?</div>
    <div class="status-grid" id="statusGrid">
      ${Object.entries(STATUS_META).map(([k, [i, l]]) =>
        `<button data-s="${k}" class="${me.status === k ? 'active' : ''}"><span class="ico">${i}</span>${l}</button>`).join('')}
    </div>
    <div class="section-label">Group pulse ${members.length > 1 ? `· ${readyCount} of ${members.length} ready` : ''}</div>
    <div class="card" id="pulseList"></div>
    <div class="section-label">My Travel Rhythm</div>
    <div class="card">
      <p class="muted small" style="margin-bottom:8px">A few quick prompts so the trip fits everyone. <strong>Every question is skippable</strong> — skipped ones simply don't appear in your profile.</p>
      <button class="btn ghost full" id="quizBtn">${Object.keys(state.me.rhythm || {}).length ? 'Update my rhythm' : 'Set up my rhythm'}</button>
      <button class="btn quiet full" id="rhythmsBtn" style="margin-top:8px">See the group's rhythms</button>
    </div>
    ${isCaptain ? `
    <div class="section-label">Invite travelers</div>
    <div class="card" id="inviteCard">
      <p class="muted small" style="margin-bottom:10px">Share a code or link. Choose what new travelers can do:</p>
      <div class="row" style="flex-wrap:wrap;gap:8px">
        <button class="btn sm" data-perm="edit">Can edit ✏️</button>
        <button class="btn sm quiet" data-perm="suggest">Can suggest 💜</button>
        <button class="btn sm quiet" data-perm="view">View only 👀</button>
      </div>
      <div id="inviteOut" style="margin-top:10px"></div>
    </div>` : ''}`;
  state.notice = '';

  c.querySelectorAll('#statusGrid button').forEach((b) => {
    b.onclick = async () => {
      const s = me.status === b.dataset.s ? '' : b.dataset.s;
      await api(`/api/trips/${state.tripId}/status`, { method: 'POST', body: { status: s } });
      await reload();
    };
  });

  const pulse = document.getElementById('pulseList');
  members.forEach((m) => {
    const meta = STATUS_META[m.status];
    pulse.insertAdjacentHTML('beforeend', `<div class="member-row">
      <div class="avatar">${esc(firstName(m.name)[0] || '?')}</div>
      <div class="grow"><strong>${esc(m.name)}</strong> ${m.role === 'captain' ? '<span class="pill captain">Captain</span>' : ''}
        <div class="muted small">${meta ? `${meta[0]} ${meta[1]} · ${timeAgo(m.status_updated_at)}` : 'No status yet'}</div></div>
      ${isCaptain && m.user_id !== state.me.id ? `<button class="mini" style="background:#eee7da;border-radius:8px;padding:5px 9px;font-size:12px" data-manage="${m.user_id}">Manage</button>` : ''}
    </div>`);
  });
  pulse.querySelectorAll('[data-manage]').forEach((b) => {
    b.onclick = () => manageMemberModal(members.find((m) => m.user_id === Number(b.dataset.manage)));
  });

  document.getElementById('quizBtn').onclick = () => quizModal();
  document.getElementById('rhythmsBtn').onclick = () => rhythmsModal();

  if (isCaptain) {
    c.querySelectorAll('#inviteCard [data-perm]').forEach((b) => {
      b.onclick = async () => {
        const r = await api(`/api/trips/${state.tripId}/invites`, { method: 'POST', body: { permission: b.dataset.perm } });
        const link = `${location.origin}/?code=${r.code}`;
        const out = document.getElementById('inviteOut');
        out.innerHTML = `<div class="notice" style="margin:0">
          <strong>Code: ${r.code}</strong> (${r.permission})<br>
          <span class="small">${link}</span><br>
          <button class="btn sm" id="copyInvite" style="margin-top:8px">Copy link</button></div>`;
        document.getElementById('copyInvite').onclick = async (ev) => {
          try { await navigator.clipboard.writeText(`Come on our trip! 🚗 Join "${state.trip.trip.name}" on Going Somewhere!: ${link}`); ev.target.textContent = 'Copied ✓'; }
          catch { prompt('Copy this link:', link); }
        };
      };
    });
  }
}

function manageMemberModal(m) {
  const modal = openModal(`
    <h2>${esc(m.name)}</h2>
    <div class="field"><label>Role</label>
      <select id="mmRole"><option value="traveler" ${m.role === 'traveler' ? 'selected' : ''}>Traveler</option>
      <option value="captain" ${m.role === 'captain' ? 'selected' : ''}>Captain</option></select></div>
    <div class="field"><label>Permission (travelers)</label>
      <select id="mmPerm">${['edit', 'suggest', 'view'].map((p) => `<option value="${p}" ${m.permission === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
    <button class="btn full" id="mmSave">Save</button>
    <button class="btn danger full" id="mmRemove" style="margin-top:8px">Remove from trip</button>`);
  modal.querySelector('#mmSave').onclick = async () => {
    await api(`/api/trips/${state.tripId}/members/${m.user_id}`, {
      method: 'POST',
      body: { role: modal.querySelector('#mmRole').value, permission: modal.querySelector('#mmPerm').value },
    });
    closeModal(); await reload();
  };
  modal.querySelector('#mmRemove').onclick = async () => {
    if (!confirm(`Remove ${m.name} from this trip?`)) return;
    await api(`/api/trips/${state.tripId}/members/${m.user_id}`, { method: 'POST', body: { remove: true } });
    closeModal(); await reload();
  };
}

// ---------------------------------------------------------------------------
// Travel Rhythm quiz — full quiz, everything skippable, skipped = gone
// ---------------------------------------------------------------------------
function quizModal() {
  const answers = JSON.parse(JSON.stringify(state.me.rhythm || {}));
  const modal = openModal(`
    <h2>My Travel Rhythm 🎶</h2>
    <p class="muted small" style="margin-bottom:12px">Answer what you like, skip what you don't. Skipped questions vanish from your profile — no blanks, no guilt. You choose who sees each answer.</p>
    <div id="quizList"></div>
    <button class="btn full" id="quizSave">Save my rhythm</button>`);
  const list = modal.querySelector('#quizList');

  function drawQ(q) {
    const cur = answers[q.id];
    const wrap = el(`<div class="quiz-q" data-q="${q.id}">
      <div class="spread"><div class="qt">${esc(q.q)}</div>
        ${cur ? '<button class="small" style="color:var(--bad)" data-clear>skip ✕</button>' : ''}</div>
      ${q.free
        ? `<input data-free placeholder="${esc(q.ph || 'Type it (or leave blank to skip)')}" value="${esc(cur?.answer || '')}" style="width:100%;padding:9px 11px;border:1.5px solid var(--line);border-radius:10px">`
        : `<div class="quiz-opts">${q.opts.map((o) => `<button type="button" data-opt="${esc(o)}" class="${cur?.answer === o ? 'on' : ''}">${esc(o)}</button>`).join('')}</div>`}
      <div class="quiz-vis" style="${cur ? '' : 'display:none'}">
        <span class="muted small">Who sees this:</span>
        ${Object.entries(VIS_LABELS).map(([k, l]) => `<button type="button" data-vis="${k}" class="${(cur?.visibility || 'shared') === k ? 'on' : ''}">${l}</button>`).join('')}
      </div>
    </div>`);
    const visRow = wrap.querySelector('.quiz-vis');
    function setAnswer(answer) {
      if (answer) {
        answers[q.id] = { answer, visibility: answers[q.id]?.visibility || 'shared' };
        visRow.style.display = '';
      } else {
        delete answers[q.id];
      }
      const fresh = drawQ(q);
      wrap.replaceWith(fresh);
    }
    wrap.querySelectorAll('[data-opt]').forEach((b) => {
      b.onclick = () => setAnswer(answers[q.id]?.answer === b.dataset.opt ? null : b.dataset.opt);
    });
    const free = wrap.querySelector('[data-free]');
    if (free) free.onchange = () => setAnswer(free.value.trim() || null);
    wrap.querySelectorAll('[data-vis]').forEach((b) => {
      b.onclick = () => { if (answers[q.id]) { answers[q.id].visibility = b.dataset.vis; wrap.replaceWith(drawQ(q)); } };
    });
    const clear = wrap.querySelector('[data-clear]');
    if (clear) clear.onclick = () => setAnswer(null);
    return wrap;
  }
  RHYTHM_QUESTIONS.forEach((q) => list.appendChild(drawQ(q)));

  modal.querySelector('#quizSave').onclick = async () => {
    const r = await api('/api/me/rhythm', { method: 'PUT', body: answers });
    state.me.rhythm = r.rhythm;
    closeModal();
    state.notice = 'Rhythm saved. 🎶';
    renderTrip();
  };
}

async function rhythmsModal() {
  const modal = openModal('<h2>Group rhythms 🎶</h2><div id="rhList" class="muted">Loading…</div>');
  const { rhythms } = await api(`/api/trips/${state.tripId}/rhythms`);
  const list = modal.querySelector('#rhList');
  list.classList.remove('muted');
  list.innerHTML = '';
  rhythms.forEach((r) => {
    const entries = Object.entries(r.rhythm);
    list.insertAdjacentHTML('beforeend', `<div class="card">
      <h3>${esc(r.name)}${r.user_id === state.me.id ? ' (you)' : ''}</h3>
      ${entries.length ? entries.map(([qid, v]) => {
        const q = RHYTHM_QUESTIONS.find((x) => x.id === qid);
        return `<div class="small" style="padding:3px 0"><span class="muted">${esc(q ? q.q : qid)}</span><br><strong>${esc(v.answer)}</strong>${v.captain_only ? ' <span class="pill">captain-only</span>' : ''}${r.user_id === state.me.id && v.visibility === 'private' ? ' <span class="pill">private</span>' : ''}</div>`;
      }).join('') : '<p class="muted small">Nothing shared yet.</p>'}
    </div>`);
  });
}

// ---------------------------------------------------------------------------
// DECIDE — timed voting
// ---------------------------------------------------------------------------
function renderDecide(c) {
  const polls = state.trip.polls || [];
  c.innerHTML = `
    ${state.notice ? `<div class="notice">${esc(state.notice)}</div>` : ''}
    <div class="card">
      <h3>Put it to a vote 🗳️</h3>
      <p class="muted small" style="margin-bottom:10px">Votes have a timer, so the group keeps moving. No response counts as “I'm good with whatever wins.”</p>
      <button class="btn full" id="newPollBtn">Start a vote</button>
    </div>
    <div id="pollList"></div>`;
  state.notice = '';
  document.getElementById('newPollBtn').onclick = () => pollModal();

  const list = document.getElementById('pollList');
  if (!polls.length) list.innerHTML = '<p class="muted" style="text-align:center;padding:14px">No votes yet. Lunch, anyone? 🌮</p>';
  polls.forEach((p) => list.appendChild(pollCard(p)));

  if (state.countdownTimer) clearInterval(state.countdownTimer);
  state.countdownTimer = setInterval(() => {
    document.querySelectorAll('[data-countdown]').forEach((elm) => {
      const left = new Date(elm.dataset.countdown) - Date.now();
      if (left <= 0) { elm.textContent = 'closed'; return; }
      const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      elm.textContent = m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m}:${String(s).padStart(2, '0')} left`;
    });
  }, 1000);
}

function pollCard(p) {
  const isOpen = !p.closed && new Date(p.closes_at) > new Date();
  const myVote = (p.votes || []).find((v) => v.user_id === state.me.id);
  const counts = p.options.map((_, i) => (p.votes || []).filter((v) => v.choice === i).length);
  const total = counts.reduce((a, b) => a + b, 0);
  const max = Math.max(...counts, 0);
  const isCaptain = state.trip.me.role === 'captain';

  const card = el(`<div class="card">
    <div class="spread"><h3 style="margin:0">${esc(p.question)}</h3>
      ${isOpen ? `<span class="countdown" data-countdown="${p.closes_at}">…</span>` : '<span class="pill">closed</span>'}</div>
    <div style="margin-top:10px" data-opts></div>
    <div class="muted small">${total} vote${total === 1 ? '' : 's'}${!isOpen && max > 0 && counts.filter((n) => n === max).length > 1 ? ' · tie — captain decides!' : ''}</div>
    ${isOpen && (isCaptain || p.created_by === state.me.id) ? '<button class="btn sm quiet" data-close style="margin-top:8px">Close voting now</button>' : ''}
  </div>`);
  const opts = card.querySelector('[data-opts]');
  p.options.forEach((o, i) => {
    const pct = total ? Math.round((counts[i] / total) * 100) : 0;
    const winner = !isOpen && counts[i] === max && max > 0;
    const b = el(`<button class="poll-opt ${myVote?.choice === i ? 'mine' : ''}" ${isOpen ? '' : 'disabled'}>
      <div class="bar" style="width:${pct}%"></div>
      <span class="z">${winner ? '🏆 ' : ''}${esc(o)}</span>
      <span class="z" style="flex:0;font-weight:700">${counts[i] || ''}</span></button>`);
    if (isOpen) b.onclick = async () => {
      try { await api(`/api/polls/${p.id}/vote`, { method: 'POST', body: { choice: i } }); await reload(); }
      catch (e) { state.err = e.message; renderTrip(); }
    };
    opts.appendChild(b);
  });
  const closeBtn = card.querySelector('[data-close]');
  if (closeBtn) closeBtn.onclick = async () => { await api(`/api/polls/${p.id}/close`, { method: 'POST' }); await reload(); };
  return card;
}

function pollModal() {
  const modal = openModal(`
    <h2>Start a vote</h2>
    <form id="pollForm">
      <div class="field"><label>Question</label><input name="question" placeholder="Where's lunch?" required></div>
      <div class="field"><label>Options (one per line)</label><textarea name="options" placeholder="🌮 Mexican&#10;🍕 Pizza&#10;🍔 Burgers" required></textarea></div>
      <div class="field"><label>Voting closes in</label>
        <select name="minutes">
          <option value="2">2 minutes (we're standing in a parking lot)</option>
          <option value="5">5 minutes</option>
          <option value="15" selected>15 minutes</option>
          <option value="60">1 hour</option>
          <option value="240">4 hours</option>
          <option value="1440">24 hours</option>
        </select></div>
      <button class="btn full" type="submit">Open voting</button>
    </form>`);
  modal.querySelector('#pollForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api(`/api/trips/${state.tripId}/polls`, {
        method: 'POST',
        body: { question: f.get('question'), options: String(f.get('options')).split('\n'), minutes: f.get('minutes') },
      });
      closeModal();
      await reload('Vote is open! ⏱️');
    } catch (err) { alert(err.message); }
  };
}

// ---------------------------------------------------------------------------
// Trip create/edit modal
// ---------------------------------------------------------------------------
function tripModal(t = null) {
  const isNew = !t;
  const modal = openModal(`
    <h2>${isNew ? 'New trip 🚗' : 'Edit trip'}</h2>
    <div id="mErr"></div>
    <form id="tripForm">
      <div class="field"><label>Trip name</label><input name="name" placeholder="The trip of the century" value="${esc(t?.name || '')}" required></div>
      <div class="field-row">
        <div class="field"><label>Starts</label><input name="start_date" type="date" value="${esc(t?.start_date || '')}"></div>
        <div class="field"><label>Ends</label><input name="end_date" type="date" value="${esc(t?.end_date || '')}"></div>
      </div>
      <div class="field"><label>Cover emoji</label>
        <div class="quiz-opts" id="emojiPick">${['🚗', '🎸', '🎤', '🎭', '⛰️', '🏔️', '🏜️', '🏖️', '🎢', '🍷', '🎄', '🗽', '🌲', '🛣️'].map((e) =>
          `<button type="button" data-e="${e}" class="${(t?.cover_emoji || '🚗') === e ? 'on' : ''}" style="font-size:19px">${e}</button>`).join('')}</div>
        <input type="hidden" name="cover_emoji" value="${esc(t?.cover_emoji || '🚗')}"></div>
      <div class="field"><label>Trip vibe (optional)</label>
        <select name="vibe">
          <option value="">Pick a vibe…</option>
          ${['⛰️ Adventure', '🎸 Concerts & Live Music', '🎭 Shows & Theater', '🏞️ National Parks', '🍷 Wine Weekend', '🏖️ Beach Escape', '🎢 Theme Park', '🎄 Christmas Markets', '🎨 Arts & Culture', '🍔 Food Tour']
            .map((v) => `<option ${t?.vibe === v ? 'selected' : ''}>${v}</option>`).join('')}
        </select></div>
      ${!isNew ? `<div class="field"><label>Cover photo</label><input type="file" name="photo" accept="image/*"></div>` : ''}
      <button class="btn full" type="submit">${isNew ? "LET'S GOOO! 🚗💨" : 'Save'}</button>
      ${!isNew ? '<button class="btn danger full" type="button" id="delTrip" style="margin-top:8px">Delete trip</button>' : ''}
    </form>`);
  modal.querySelectorAll('#emojiPick button').forEach((b) => {
    b.onclick = () => {
      modal.querySelectorAll('#emojiPick button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      modal.querySelector('[name=cover_emoji]').value = b.dataset.e;
    };
  });
  modal.querySelector('#tripForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = {
      name: f.get('name'), start_date: f.get('start_date'), end_date: f.get('end_date'),
      cover_emoji: f.get('cover_emoji'), vibe: f.get('vibe'),
    };
    try {
      if (isNew) {
        const r = await api('/api/trips', { method: 'POST', body });
        closeModal();
        confetti();
        await loadTrips();
        await openTrip(r.id);
      } else {
        await api(`/api/trips/${t.id}`, { method: 'PATCH', body });
        const photo = f.get('photo');
        if (photo && photo.size) {
          const fd = new FormData();
          fd.append('photo', photo);
          await api(`/api/trips/${t.id}/cover`, { method: 'POST', body: fd });
        }
        closeModal();
        await reload();
      }
    } catch (err) { modal.querySelector('#mErr').innerHTML = `<div class="err">${esc(err.message)}</div>`; }
  };
  const del = modal.querySelector('#delTrip');
  if (del) del.onclick = async () => {
    if (!confirm(`Delete "${t.name}" for everyone on it? This can't be undone.`)) return;
    await api(`/api/trips/${t.id}`, { method: 'DELETE' });
    closeModal();
    state.trip = null; state.tripId = null;
    await loadTrips();
    renderTrips();
  };
}

// ---------------------------------------------------------------------------
// Confetti — because starting a trip should FEEL like starting a trip
// ---------------------------------------------------------------------------
function confetti(emojis = ['🎉', '🚗', '✨', '🎊', '🌟', '💛']) {
  for (let i = 0; i < 26; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-bit';
    p.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    p.style.left = Math.random() * 100 + 'vw';
    p.style.animationDelay = Math.random() * 0.6 + 's';
    p.style.animationDuration = 1.6 + Math.random() * 1.4 + 's';
    p.style.fontSize = 16 + Math.random() * 18 + 'px';
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 3800);
  }
}

// ---------------------------------------------------------------------------
// Modal plumbing
// ---------------------------------------------------------------------------
function openModal(html) {
  closeModal();
  const wrap = el(`<div class="modal-wrap"><div class="modal">${html}</div></div>`);
  wrap.onclick = (e) => { if (e.target === wrap) closeModal(); };
  document.body.appendChild(wrap);
  return wrap.querySelector('.modal');
}
function closeModal() {
  const w = document.querySelector('.modal-wrap');
  if (w) w.remove();
}

boot();

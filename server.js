// Going Somewhere! — the app that runs the trip, not just plans it.
// Node/Express + SQLite on a persistent disk (DATA_DIR).
// Built by Audrey & Fable for Keely. It plans the people, not just the places.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const multer = require('multer');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
const db = new Database(path.join(DATA_DIR, 'goingsomewhere.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  rhythm TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL DEFAULT '',
  end_date TEXT NOT NULL DEFAULT '',
  cover_emoji TEXT NOT NULL DEFAULT '🚗',
  cover_file TEXT NOT NULL DEFAULT '',
  vibe TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS trip_members (
  id INTEGER PRIMARY KEY,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'traveler',        -- captain | traveler
  permission TEXT NOT NULL DEFAULT 'view',      -- edit | suggest | view
  status TEXT NOT NULL DEFAULT '',              -- ready | need10 | hungry | ...
  status_updated_at TEXT NOT NULL DEFAULT '',
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(trip_id, user_id)
);
CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  permission TEXT NOT NULL DEFAULT 'view',      -- edit | suggest | view
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS stops (
  id INTEGER PRIMARY KEY,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  day_date TEXT NOT NULL DEFAULT '',            -- YYYY-MM-DD, '' = wishlist
  position INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  address TEXT NOT NULL DEFAULT '',
  lat REAL, lng REAL,
  arrive TEXT NOT NULL DEFAULT '',              -- HH:MM
  depart TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'like',        -- must | like | iftime
  website TEXT NOT NULL DEFAULT '',
  hours TEXT NOT NULL DEFAULT '',
  cost TEXT NOT NULL DEFAULT '',
  visit_min INTEGER NOT NULL DEFAULT 0,
  parking TEXT NOT NULL DEFAULT '',
  accessibility TEXT NOT NULL DEFAULT '',
  extra TEXT NOT NULL DEFAULT '{}',             -- hotel fields, links, etc.
  state TEXT NOT NULL DEFAULT 'active',         -- active | suggested
  suggested_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stops_trip_day ON stops(trip_id, day_date, position);
CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',
  closes_at TEXT NOT NULL,                      -- ISO datetime
  closed INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS poll_votes (
  id INTEGER PRIMARY KEY,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  choice INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(poll_id, user_id)
);
CREATE TABLE IF NOT EXISTS trip_posts (
  id INTEGER PRIMARY KEY,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  photo TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS post_hearts (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES trip_posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(post_id, user_id)
);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'other',       -- hotel | food | gas | tickets | parking | shopping | other
  amount REAL NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  spent_on TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS stop_ratings (
  id INTEGER PRIMARY KEY,
  stop_id INTEGER NOT NULL REFERENCES stops(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  worth_money INTEGER,                          -- 1 yes / 0 no / NULL skipped
  worth_time INTEGER,
  would_return INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(stop_id, user_id)
);
`);

// Migrations for databases created before these columns existed
try { db.exec('ALTER TABLE trips ADD COLUMN total_budget REAL'); } catch { /* already there */ }

const CATEGORIES = ['restaurant', 'coffee', 'hotel', 'overlook', 'park', 'mountains', 'museum', 'shopping', 'hiking', 'beach', 'concert', 'show', 'roadside', 'gem', 'gas', 'rest', 'other'];
const EXPENSE_CATEGORIES = ['hotel', 'food', 'gas', 'tickets', 'parking', 'shopping', 'other'];
const PRIORITIES = ['must', 'like', 'iftime'];
const PERMISSIONS = ['edit', 'suggest', 'view'];
const STATUSES = ['', 'ready', 'here', 'need10', 'hungry', 'bathroom', 'lowenergy', 'quiet', 'skipping', 'gowithout', 'changed'];

// ---------------------------------------------------------------------------
// App + auth
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const COOKIE = 'gs_session';
const SESSION_DAYS = 90;

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(res, token) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_DAYS * 86400}`];
  if (IS_PROD) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function newSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`)
    .run(token, userId);
  setSessionCookie(res, token);
}

function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now')`).get(token) || null;
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in.' });
  req.user = user;
  next();
}

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.get('/api/me', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.json({ user: null });
  const rhythm = db.prepare('SELECT rhythm FROM users WHERE id = ?').get(user.id).rhythm;
  res.json({ user: { ...user, rhythm: safeParse(rhythm, {}) } });
});

app.post('/api/signup', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Need a name, an email, and a password of at least 8 characters.' });
  }
  const cleanEmail = email.trim().toLowerCase();
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail)) {
    return res.status(409).json({ error: 'That email already has an account — try logging in.' });
  }
  const info = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run(name.trim(), cleanEmail, bcrypt.hashSync(password, 12));
  newSession(res, info.lastInsertRowid);
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Email or password not quite right — try again.' });
  }
  newSession(res, user.id);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
  res.json({ ok: true });
});

app.use('/api', requireAuth);
app.use('/covers', requireAuth);

function safeParse(s, fallback) { try { return JSON.parse(s); } catch { return fallback; } }

// ---------------------------------------------------------------------------
// Membership helpers
// ---------------------------------------------------------------------------
function memberOf(tripId, userId) {
  return db.prepare('SELECT * FROM trip_members WHERE trip_id = ? AND user_id = ?').get(tripId, userId) || null;
}
function requireMember(req, res) {
  const m = memberOf(req.params.id, req.user.id);
  if (!m) { res.status(403).json({ error: 'You are not on this trip.' }); return null; }
  return m;
}
function canEdit(m) { return m.role === 'captain' || m.permission === 'edit'; }
function canSuggest(m) { return canEdit(m) || m.permission === 'suggest'; }

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------
app.get('/api/trips', (req, res) => {
  const trips = db.prepare(`
    SELECT t.*, m.role, m.permission,
      (SELECT COUNT(*) FROM trip_members WHERE trip_id = t.id) AS member_count,
      (SELECT COUNT(*) FROM stops WHERE trip_id = t.id AND state = 'active') AS stop_count
    FROM trips t JOIN trip_members m ON m.trip_id = t.id
    WHERE m.user_id = ? ORDER BY t.start_date DESC, t.id DESC`).all(req.user.id);
  res.json({ trips });
});

app.post('/api/trips', (req, res) => {
  const { name, start_date, end_date, cover_emoji, vibe } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Every trip needs a name.' });
  const info = db.prepare('INSERT INTO trips (name, start_date, end_date, cover_emoji, vibe, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(String(name).trim(), String(start_date || ''), String(end_date || ''), String(cover_emoji || '🚗').slice(0, 8), String(vibe || ''), req.user.id);
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role, permission) VALUES (?, ?, 'captain', 'edit')")
    .run(info.lastInsertRowid, req.user.id);
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.get('/api/trips/:id', (req, res) => {
  const m = requireMember(req, res); if (!m) return;
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id);
  const members = db.prepare(`
    SELECT m.user_id, m.role, m.permission, m.status, m.status_updated_at, u.name
    FROM trip_members m JOIN users u ON u.id = m.user_id WHERE m.trip_id = ? ORDER BY m.role DESC, u.name`).all(trip.id);
  const ratingAgg = {};
  for (const r of db.prepare(`
    SELECT s.id AS stop_id, COUNT(*) AS n,
      SUM(COALESCE(r.worth_money, 0)) AS money_yes,
      SUM(COALESCE(r.worth_time, 0)) AS time_yes,
      SUM(COALESCE(r.would_return, 0)) AS return_yes
    FROM stop_ratings r JOIN stops s ON s.id = r.stop_id
    WHERE s.trip_id = ? GROUP BY s.id`).all(trip.id)) ratingAgg[r.stop_id] = r;
  const myRatings = {};
  for (const r of db.prepare(`
    SELECT r.* FROM stop_ratings r JOIN stops s ON s.id = r.stop_id
    WHERE s.trip_id = ? AND r.user_id = ?`).all(trip.id, req.user.id)) myRatings[r.stop_id] = r;
  const stops = db.prepare('SELECT * FROM stops WHERE trip_id = ? ORDER BY day_date, position, id').all(trip.id)
    .map((s) => ({ ...s, extra: safeParse(s.extra, {}), rating: ratingAgg[s.id] || null, my_rating: myRatings[s.id] || null }));
  const polls = db.prepare('SELECT * FROM polls WHERE trip_id = ? ORDER BY id DESC LIMIT 20').all(trip.id).map((p) => {
    const votes = db.prepare('SELECT user_id, choice FROM poll_votes WHERE poll_id = ?').all(p.id);
    return { ...p, options: safeParse(p.options, []), votes };
  });
  const invites = m.role === 'captain'
    ? db.prepare('SELECT code, permission FROM invites WHERE trip_id = ?').all(trip.id) : [];
  res.json({ trip, me: { role: m.role, permission: m.permission, status: m.status }, members, stops, polls, invites });
});

app.patch('/api/trips/:id', (req, res) => {
  const m = requireMember(req, res); if (!m) return;
  if (m.role !== 'captain') return res.status(403).json({ error: 'Only a captain can change trip details.' });
  const { name, start_date, end_date, cover_emoji, vibe, total_budget } = req.body || {};
  const t = db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id);
  db.prepare('UPDATE trips SET name = ?, start_date = ?, end_date = ?, cover_emoji = ?, vibe = ?, total_budget = ? WHERE id = ?')
    .run(
      name !== undefined ? String(name).trim() || t.name : t.name,
      start_date !== undefined ? String(start_date) : t.start_date,
      end_date !== undefined ? String(end_date) : t.end_date,
      cover_emoji !== undefined ? String(cover_emoji).slice(0, 8) : t.cover_emoji,
      vibe !== undefined ? String(vibe) : t.vibe,
      total_budget !== undefined ? (Number(total_budget) || null) : t.total_budget,
      t.id
    );
  res.json({ ok: true });
});

app.delete('/api/trips/:id', (req, res) => {
  const m = requireMember(req, res); if (!m) return;
  if (m.role !== 'captain') return res.status(403).json({ error: 'Only a captain can delete a trip.' });
  db.prepare('DELETE FROM trips WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Cover photo
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 12).replace(/[^.\w]/g, '');
      cb(null, crypto.randomBytes(16).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
});

app.post('/api/trips/:id/cover', upload.single('photo'), (req, res) => {
  const m = requireMember(req, res); if (!m) return;
  if (m.role !== 'captain') return res.status(403).json({ error: 'Only a captain can set the cover photo.' });
  if (!req.file) return res.status(400).json({ error: 'No photo received.' });
  const old = db.prepare('SELECT cover_file FROM trips WHERE id = ?').get(req.params.id).cover_file;
  if (old) fs.unlink(path.join(UPLOAD_DIR, old), () => {});
  db.prepare('UPDATE trips SET cover_file = ? WHERE id = ?').run(req.file.filename, req.params.id);
  res.json({ ok: true, cover_file: req.file.filename });
});

app.get('/covers/:file', (req, res) => {
  const file = req.params.file.replace(/[^\w.]/g, '');
  const full = path.join(UPLOAD_DIR, file);
  if (!fs.existsSync(full)) return res.status(404).send('Not found');
  res.sendFile(full);
});

// ---------------------------------------------------------------------------
// Invites & joining
// ---------------------------------------------------------------------------
app.post('/api/trips/:id/invites', (req, res) => {
  const m = requireMember(req, res); if (!m) return;
  if (m.role !== 'captain') return res.status(403).json({ error: 'Only a captain can create invites.' });
  const permission = PERMISSIONS.includes((req.body || {}).permission) ? req.body.permission : 'view';
  const existing = db.prepare('SELECT code FROM invites WHERE trip_id = ? AND permission = ?').get(req.params.id, permission);
  if (existing) return res.json({ ok: true, code: existing.code, permission });
  const code = crypto.randomBytes(4).toString('hex').toUpperCase();
  db.prepare('INSERT INTO invites (trip_id, code, permission) VALUES (?, ?, ?)').run(req.params.id, code, permission);
  res.json({ ok: true, code, permission });
});

app.post('/api/join', (req, res) => {
  const code = String((req.body || {}).code || '').trim().toUpperCase();
  const invite = db.prepare('SELECT * FROM invites WHERE code = ?').get(code);
  if (!invite) return res.status(404).json({ error: "That code doesn't match any trip. Double-check it?" });
  if (memberOf(invite.trip_id, req.user.id)) return res.json({ ok: true, trip_id: invite.trip_id, already: true });
  db.prepare("INSERT INTO trip_members (trip_id, user_id, role, permission) VALUES (?, ?, 'traveler', ?)")
    .run(invite.trip_id, req.user.id, invite.permission);
  res.json({ ok: true, trip_id: invite.trip_id });
});

app.post('/api/trips/:id/members/:userId', (req, res) => {
  const m = requireMember(req, res); if (!m) return;
  if (m.role !== 'captain') return res.status(403).json({ error: 'Only a captain can change roles.' });
  const { role, permission, remove } = req.body || {};
  const target = memberOf(req.params.id, req.params.userId);
  if (!target) return res.status(404).json({ error: 'Not a member of this trip.' });
  if (remove) {
    if (target.role === 'captain') return res.status(400).json({ error: 'Captains cannot be removed — demote first.' });
    db.prepare('DELETE FROM trip_members WHERE id = ?').run(target.id);
    return res.json({ ok: true });
  }
  const newRole = ['captain', 'traveler'].includes(role) ? role : target.role;
  const newPerm = PERMISSIONS.includes(permission) ? permission : target.permission;
  if (target.role === 'captain' && newRole !== 'captain') {
    const captains = db.prepare("SELECT COUNT(*) AS n FROM trip_members WHERE trip_id = ? AND role = 'captain'").get(req.params.id).n;
    if (captains <= 1) return res.status(400).json({ error: 'Every trip needs at least one captain.' });
  }
  db.prepare('UPDATE trip_members SET role = ?, permission = ? WHERE id = ?')
    .run(newRole, newRole === 'captain' ? 'edit' : newPerm, target.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Stops
// ---------------------------------------------------------------------------
const STOP_FIELDS = ['day_date', 'name', 'category', 'address', 'lat', 'lng', 'arrive', 'depart', 'notes',
  'priority', 'website', 'hours', 'cost', 'visit_min', 'parking', 'accessibility', 'extra'];

function cleanStop(b) {
  const out = {};
  for (const f of STOP_FIELDS) {
    if (b[f] === undefined) continue;
    if (f === 'lat' || f === 'lng') out[f] = b[f] === null || b[f] === '' ? null : Number(b[f]);
    else if (f === 'visit_min') out[f] = parseInt(b[f], 10) || 0;
    else if (f === 'extra') out[f] = JSON.stringify(typeof b[f] === 'object' && b[f] ? b[f] : {});
    else out[f] = String(b[f]).trim();
  }
  if (out.category && !CATEGORIES.includes(out.category)) out.category = 'other';
  if (out.priority && !PRIORITIES.includes(out.priority)) out.priority = 'like';
  return out;
}

app.post('/api/trips/:id/stops', (req, res) => {
  const m = requireMember(req, res); if (!m) return;
  if (!canSuggest(m)) return res.status(403).json({ error: 'You have view-only access to this trip.' });
  const s = cleanStop(req.body || {});
  if (!s.name) return res.status(400).json({ error: 'Every stop needs a name.' });
  const state = canEdit(m) ? 'active' : 'suggested';
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM stops WHERE trip_id = ? AND day_date = ?')
    .get(req.params.id, s.day_date || '').p;
  const info = db.prepare(`
    INSERT INTO stops (trip_id, day_date, position, name, category, address, lat, lng, arrive, depart, notes,
      priority, website, hours, cost, visit_min, parking, accessibility, extra, state, suggested_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.params.id, s.day_date || '', pos, s.name, s.category || 'other', s.address || '',
      s.lat ?? null, s.lng ?? null, s.arrive || '', s.depart || '', s.notes || '',
      s.priority || 'like', s.website || '', s.hours || '', s.cost || '', s.visit_min || 0,
      s.parking || '', s.accessibility || '', s.extra || '{}', state, req.user.id);
  res.json({ ok: true, id: info.lastInsertRowid, state });
});

function stopWithMembership(req, res) {
  const stop = db.prepare('SELECT * FROM stops WHERE id = ?').get(req.params.stopId);
  if (!stop) { res.status(404).json({ error: 'Stop not found.' }); return null; }
  const m = memberOf(stop.trip_id, req.user.id);
  if (!m) { res.status(403).json({ error: 'You are not on this trip.' }); return null; }
  return { stop, m };
}

app.patch('/api/stops/:stopId', (req, res) => {
  const ctx = stopWithMembership(req, res); if (!ctx) return;
  const { stop, m } = ctx;
  if (!canEdit(m)) return res.status(403).json({ error: 'Only travelers with edit access can change stops.' });
  const s = cleanStop(req.body || {});
  const merged = { ...stop, ...s };
  db.prepare(`
    UPDATE stops SET day_date = ?, name = ?, category = ?, address = ?, lat = ?, lng = ?, arrive = ?, depart = ?,
      notes = ?, priority = ?, website = ?, hours = ?, cost = ?, visit_min = ?, parking = ?, accessibility = ?,
      extra = ?, state = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(merged.day_date, merged.name, merged.category, merged.address, merged.lat, merged.lng, merged.arrive,
      merged.depart, merged.notes, merged.priority, merged.website, merged.hours, merged.cost, merged.visit_min,
      merged.parking, merged.accessibility,
      typeof merged.extra === 'string' ? merged.extra : JSON.stringify(merged.extra),
      req.body.approve ? 'active' : merged.state, stop.id);
  res.json({ ok: true });
});

app.delete('/api/stops/:stopId', (req, res) => {
  const ctx = stopWithMembership(req, res); if (!ctx) return;
  const { stop, m } = ctx;
  const own_suggestion = stop.state === 'suggested' && stop.suggested_by === req.user.id;
  if (!canEdit(m) && !own_suggestion) return res.status(403).json({ error: 'Only travelers with edit access can remove stops.' });
  db.prepare('DELETE FROM stops WHERE id = ?').run(stop.id);
  res.json({ ok: true });
});

app.post('/api/trips/:id/reorder', (req, res) => {
  const m = requireMember(req, res); if (!m) return;
  if (!canEdit(m)) return res.status(403).json({ error: 'Only travelers with edit access can reorder.' });
  const { day_date, ids } = req.body || {};
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'Need the ordered list of stop ids.' });
  const update = db.prepare('UPDATE stops SET position = ?, day_date = ? WHERE id = ? AND trip_id = ?');
  const tx = db.transaction(() => {
    ids.forEach((id, i) => update.run(i + 1, String(day_date || ''), id, req.params.id));
  });
  tx();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Trip Pulse: check-in statuses
// ---------------------------------------------------------------------------
app.post('/api/trips/:id/status', (req, res) => {
  const m = requireMember(req, res); if (!m) return;
  const status = String((req.body || {}).status || '');
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status.' });
  db.prepare("UPDATE trip_members SET status = ?, status_updated_at = datetime('now') WHERE id = ?").run(status, m.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Travel Rhythm (full quiz, every question skippable — skipped answers
// simply don't exist in the profile)
// ---------------------------------------------------------------------------
app.put('/api/me/rhythm', (req, res) => {
  const rhythm = req.body || {};
  const clean = {};
  for (const [key, val] of Object.entries(rhythm)) {
    if (!val || typeof val !== 'object') continue;
    const answer = String(val.answer ?? '').slice(0, 500);
    if (!answer.trim()) continue;                // unanswered → not stored at all
    const visibility = ['shared', 'captain', 'private'].includes(val.visibility) ? val.visibility : 'shared';
    clean[String(key).slice(0, 40)] = { answer, visibility };
  }
  db.prepare('UPDATE users SET rhythm = ? WHERE id = ?').run(JSON.stringify(clean), req.user.id);
  res.json({ ok: true, rhythm: clean });
});

app.get('/api/trips/:id/rhythms', (req, res) => {
  const m = requireMember(req, res); if (!m) return;
  const members = db.prepare(`
    SELECT u.id, u.name, u.rhythm FROM trip_members tm JOIN users u ON u.id = tm.user_id
    WHERE tm.trip_id = ?`).all(req.params.id);
  const isCaptain = m.role === 'captain';
  const out = members.map((mem) => {
    const rhythm = safeParse(mem.rhythm, {});
    const visible = {};
    for (const [k, v] of Object.entries(rhythm)) {
      if (mem.id === req.user.id) visible[k] = v;
      else if (v.visibility === 'shared') visible[k] = { answer: v.answer };
      else if (v.visibility === 'captain' && isCaptain) visible[k] = { answer: v.answer, captain_only: true };
    }
    return { user_id: mem.id, name: mem.name, rhythm: visible };
  });
  res.json({ rhythms: out });
});

// ---------------------------------------------------------------------------
// Timed voting
// ---------------------------------------------------------------------------
app.post('/api/trips/:id/polls', (req, res) => {
  const m = requireMember(req, res); if (!m) return;
  const { question, options, minutes } = req.body || {};
  const opts = (Array.isArray(options) ? options : []).map((o) => String(o).trim()).filter(Boolean).slice(0, 8);
  if (!question || opts.length < 2) return res.status(400).json({ error: 'Need a question and at least two options.' });
  const mins = Math.min(Math.max(parseInt(minutes, 10) || 15, 1), 24 * 60);
  const closesAt = new Date(Date.now() + mins * 60000).toISOString();
  const info = db.prepare('INSERT INTO polls (trip_id, question, options, closes_at, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(req.params.id, String(question).trim(), JSON.stringify(opts), closesAt, req.user.id);
  res.json({ ok: true, id: info.lastInsertRowid, closes_at: closesAt });
});

app.post('/api/polls/:pollId/vote', (req, res) => {
  const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(req.params.pollId);
  if (!poll) return res.status(404).json({ error: 'Poll not found.' });
  const m = memberOf(poll.trip_id, req.user.id);
  if (!m) return res.status(403).json({ error: 'You are not on this trip.' });
  if (poll.closed || new Date(poll.closes_at) <= new Date()) {
    return res.status(400).json({ error: 'Voting has closed on this one.' });
  }
  const choice = parseInt((req.body || {}).choice, 10);
  const opts = safeParse(poll.options, []);
  if (!(choice >= 0 && choice < opts.length)) return res.status(400).json({ error: 'Pick one of the options.' });
  db.prepare(`INSERT INTO poll_votes (poll_id, user_id, choice) VALUES (?, ?, ?)
    ON CONFLICT(poll_id, user_id) DO UPDATE SET choice = excluded.choice`).run(poll.id, req.user.id, choice);
  res.json({ ok: true });
});

app.post('/api/polls/:pollId/close', (req, res) => {
  const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(req.params.pollId);
  if (!poll) return res.status(404).json({ error: 'Poll not found.' });
  const m = memberOf(poll.trip_id, req.user.id);
  if (!m || (m.role !== 'captain' && poll.created_by !== req.user.id)) {
    return res.status(403).json({ error: 'Only the captain or the poll creator can close a vote early.' });
  }
  db.prepare('UPDATE polls SET closed = 1 WHERE id = ?').run(poll.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Geocoding (Nominatim / OpenStreetMap) + routing (OSRM) proxies with caching
// ---------------------------------------------------------------------------
const geoCache = new Map();
const routeCache = new Map();
function cacheGet(map, key) { const v = map.get(key); return v && v.until > Date.now() ? v.data : null; }
function cacheSet(map, key, data, ttlMin = 24 * 60) {
  if (map.size > 2000) map.clear();
  map.set(key, { data, until: Date.now() + ttlMin * 60000 });
}

app.get('/api/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (q.length < 2) return res.json({ results: [] });
  const cached = cacheGet(geoCache, q.toLowerCase());
  if (cached) return res.json({ results: cached });
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'GoingSomewhere/0.1 (trip planning app)' },
    });
    if (!r.ok) return res.json({ results: [] });
    const data = await r.json();
    const results = data.map((d) => ({
      name: d.name || d.display_name.split(',')[0],
      display: d.display_name,
      lat: Number(d.lat),
      lng: Number(d.lon),
      type: d.type,
    }));
    cacheSet(geoCache, q.toLowerCase(), results);
    res.json({ results });
  } catch {
    res.json({ results: [], error: 'Search is unavailable right now — you can still add the stop by hand.' });
  }
});

app.post('/api/route', async (req, res) => {
  const coords = (req.body || {}).coords;
  if (!Array.isArray(coords) || coords.length < 2 || coords.length > 30) {
    return res.status(400).json({ error: 'Need 2–30 [lng,lat] pairs.' });
  }
  const clean = coords.map((c) => [Number(c[0]).toFixed(5), Number(c[1]).toFixed(5)]);
  if (clean.some((c) => c.includes('NaN'))) return res.status(400).json({ error: 'Bad coordinates.' });
  const key = clean.flat().join(',');
  const cached = cacheGet(routeCache, key);
  if (cached) return res.json(cached);
  try {
    const pathStr = clean.map((c) => `${c[0]},${c[1]}`).join(';');
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${pathStr}?overview=full&geometries=geojson&steps=false`, {
      headers: { 'User-Agent': 'GoingSomewhere/0.1 (trip planning app)' },
    });
    if (!r.ok) throw new Error('routing failed');
    const data = await r.json();
    const route = data.routes && data.routes[0];
    if (!route) throw new Error('no route');
    const out = {
      duration_min: Math.round(route.duration / 60),
      distance_mi: Math.round((route.distance / 1609.34) * 10) / 10,
      legs: route.legs.map((l) => ({
        duration_min: Math.round(l.duration / 60),
        distance_mi: Math.round((l.distance / 1609.34) * 10) / 10,
      })),
      geometry: route.geometry,
    };
    cacheSet(routeCache, key, out, 6 * 60);
    res.json(out);
  } catch {
    res.json({ duration_min: null, distance_mi: null, legs: [], geometry: null, error: 'Routing unavailable right now.' });
  }
});

// ---------------------------------------------------------------------------
// Weather (Open-Meteo — free, no key)
// ---------------------------------------------------------------------------
const weatherCache = new Map();
app.get('/api/weather', async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!isFinite(lat) || !isFinite(lng)) return res.json({ weather: null });
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const cached = cacheGet(weatherCache, key);
  if (cached) return res.json({ weather: cached });
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
      '&temperature_unit=fahrenheit&forecast_days=3&timezone=auto');
    if (!r.ok) throw new Error('weather failed');
    const data = await r.json();
    const weather = { daily: data.daily };
    cacheSet(weatherCache, key, weather, 60);
    res.json({ weather });
  } catch {
    res.json({ weather: null });
  }
});

// ---------------------------------------------------------------------------
// AI trip assistant — suggest stops, fill free time. Graceful without a key.
// ---------------------------------------------------------------------------
async function askClaude(system, user, maxTokens = 1500) {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    return text.trim().replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '');
  } catch { return null; }
}

app.post('/api/trips/:id/ai/suggest', async (req, res) => {
  const m = requireMember(req, res); if (!m) return;
  const prompt = String((req.body || {}).prompt || '').slice(0, 1000);
  if (!prompt.trim()) return res.status(400).json({ error: 'Ask me something about the trip!' });
  if (!ANTHROPIC_API_KEY) {
    return res.json({
      suggestions: [],
      note: 'The AI assistant needs an ANTHROPIC_API_KEY set on the server. Everything else works without it!',
    });
  }
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id);
  const stops = db.prepare("SELECT name, category, address, day_date, priority FROM stops WHERE trip_id = ? AND state = 'active' ORDER BY day_date, position").all(trip.id);
  const context = `Trip: "${trip.name}" (${trip.start_date || 'dates TBD'} to ${trip.end_date || '?'}). Vibe: ${trip.vibe || 'not set'}.
Current stops: ${stops.length ? stops.map((s) => `${s.name} [${s.category}${s.day_date ? ', ' + s.day_date : ', wishlist'}]`).join('; ') : 'none yet'}.`;
  const raw = await askClaude(
    `You are the trip assistant inside "Going Somewhere!", a group road-trip app. Suggest real, specific places
that fit the traveler's request and route. Respond ONLY with a JSON object:
{"intro": "one warm sentence", "suggestions": [{"name": "...", "category": "restaurant|coffee|hotel|overlook|park|museum|shopping|hiking|beach|roadside|gem|gas|rest|other", "description": "one sentence — why it's worth it", "search": "name + city, good for a map search"}]}
Give 3-6 suggestions. Real places only; if unsure a place exists, prefer well-known ones. No markdown, JSON only.`,
    `${context}\n\nTraveler asks: ${prompt}`
  );
  const parsed = safeParse(raw, null);
  if (!parsed || !Array.isArray(parsed.suggestions)) {
    return res.json({ suggestions: [], note: "The assistant couldn't come up with anything that time — try rephrasing?" });
  }
  res.json({ intro: parsed.intro || '', suggestions: parsed.suggestions.slice(0, 6) });
});

// ---------------------------------------------------------------------------
// Budget tracker
// ---------------------------------------------------------------------------
app.get('/api/trips/:id/expenses', (req, res) => {
  const m = requireMember(req, res); if (!m) return;
  const expenses = db.prepare(`
    SELECT e.*, u.name AS who FROM expenses e JOIN users u ON u.id = e.user_id
    WHERE e.trip_id = ? ORDER BY e.id DESC`).all(req.params.id);
  const trip = db.prepare('SELECT total_budget FROM trips WHERE id = ?').get(req.params.id);
  const memberCount = db.prepare('SELECT COUNT(*) AS n FROM trip_members WHERE trip_id = ?').get(req.params.id).n;
  res.json({ expenses, total_budget: trip.total_budget, member_count: memberCount });
});

app.post('/api/trips/:id/expenses', (req, res) => {
  const m = requireMember(req, res); if (!m) return;
  const { category, amount, note, spent_on } = req.body || {};
  const amt = Number(amount);
  if (!isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Need an amount over $0.' });
  const cat = EXPENSE_CATEGORIES.includes(category) ? category : 'other';
  const info = db.prepare('INSERT INTO expenses (trip_id, user_id, category, amount, note, spent_on) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.params.id, req.user.id, cat, Math.round(amt * 100) / 100, String(note || '').trim().slice(0, 300), String(spent_on || ''));
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.delete('/api/expenses/:expId', (req, res) => {
  const exp = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.expId);
  if (!exp) return res.status(404).json({ error: 'Expense not found.' });
  const m = memberOf(exp.trip_id, req.user.id);
  if (!m || (exp.user_id !== req.user.id && m.role !== 'captain')) {
    return res.status(403).json({ error: 'You can only remove expenses you added.' });
  }
  db.prepare('DELETE FROM expenses WHERE id = ?').run(exp.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// "Worth it?" — three quick questions after a visit. Family history,
// not anonymous internet reviews. Also feeds the Trip Brain.
// ---------------------------------------------------------------------------
app.post('/api/stops/:stopId/rate', (req, res) => {
  const ctx = stopWithMembership(req, res); if (!ctx) return;
  const { stop } = ctx;
  const toBit = (v) => (v === true || v === 1 ? 1 : v === false || v === 0 ? 0 : null);
  const { worth_money, worth_time, would_return } = req.body || {};
  db.prepare(`INSERT INTO stop_ratings (stop_id, user_id, worth_money, worth_time, would_return)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(stop_id, user_id) DO UPDATE SET worth_money = excluded.worth_money,
      worth_time = excluded.worth_time, would_return = excluded.would_return`)
    .run(stop.id, req.user.id, toBit(worth_money), toBit(worth_time), toBit(would_return));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// The Family Feed — a private timeline of little moments, per trip
// ---------------------------------------------------------------------------
app.get('/api/trips/:id/posts', (req, res) => {
  const m = requireMember(req, res); if (!m) return;
  const posts = db.prepare(`
    SELECT p.*, u.name AS author,
      (SELECT COUNT(*) FROM post_hearts h WHERE h.post_id = p.id) AS hearts,
      EXISTS(SELECT 1 FROM post_hearts h WHERE h.post_id = p.id AND h.user_id = ?) AS hearted
    FROM trip_posts p JOIN users u ON u.id = p.user_id
    WHERE p.trip_id = ? ORDER BY p.id DESC LIMIT 200`).all(req.user.id, req.params.id);
  res.json({ posts });
});

app.post('/api/trips/:id/posts', upload.single('photo'), (req, res) => {
  const m = requireMember(req, res); if (!m) return;
  const body = String((req.body || {}).body || '').trim().slice(0, 2000);
  if (!body && !req.file) return res.status(400).json({ error: 'Say something or add a photo!' });
  const info = db.prepare('INSERT INTO trip_posts (trip_id, user_id, body, photo) VALUES (?, ?, ?, ?)')
    .run(req.params.id, req.user.id, body, req.file ? req.file.filename : '');
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.post('/api/posts/:postId/heart', (req, res) => {
  const post = db.prepare('SELECT * FROM trip_posts WHERE id = ?').get(req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  if (!memberOf(post.trip_id, req.user.id)) return res.status(403).json({ error: 'You are not on this trip.' });
  const existing = db.prepare('SELECT id FROM post_hearts WHERE post_id = ? AND user_id = ?').get(post.id, req.user.id);
  if (existing) db.prepare('DELETE FROM post_hearts WHERE id = ?').run(existing.id);
  else db.prepare('INSERT INTO post_hearts (post_id, user_id) VALUES (?, ?)').run(post.id, req.user.id);
  res.json({ ok: true, hearted: !existing });
});

app.delete('/api/posts/:postId', (req, res) => {
  const post = db.prepare('SELECT * FROM trip_posts WHERE id = ?').get(req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  const m = memberOf(post.trip_id, req.user.id);
  if (!m || (post.user_id !== req.user.id && m.role !== 'captain')) {
    return res.status(403).json({ error: 'You can only delete your own posts.' });
  }
  if (post.photo) fs.unlink(path.join(UPLOAD_DIR, post.photo), () => {});
  db.prepare('DELETE FROM trip_posts WHERE id = ?').run(post.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Trip Brain — the app notices your travel style from real data.
// Honest heuristics first; AI polish when a key is set.
// ---------------------------------------------------------------------------
app.get('/api/me/brain', async (req, res) => {
  const tripIds = db.prepare('SELECT trip_id FROM trip_members WHERE user_id = ?').all(req.user.id).map((r) => r.trip_id);
  if (!tripIds.length) return res.json({ insights: ["No trips yet — the Trip Brain learns as you travel. Go make some data! 🚗"] });
  const ph = tripIds.map(() => '?').join(',');
  const stops = db.prepare(`SELECT category, priority, visit_min, day_date, arrive FROM stops WHERE trip_id IN (${ph}) AND state = 'active'`).all(...tripIds);
  const postCount = db.prepare(`SELECT COUNT(*) AS n FROM trip_posts WHERE trip_id IN (${ph})`).get(...tripIds).n;
  const pollCount = db.prepare(`SELECT COUNT(*) AS n FROM polls WHERE trip_id IN (${ph})`).get(...tripIds).n;
  const ratings = db.prepare(`
    SELECT COUNT(*) AS n, SUM(COALESCE(would_return, 0)) AS return_yes, SUM(COALESCE(worth_money, 0)) AS money_yes
    FROM stop_ratings r JOIN stops s ON s.id = r.stop_id WHERE s.trip_id IN (${ph})`).get(...tripIds);

  const insights = [];
  const byCat = {};
  for (const s of stops) byCat[s.category] = (byCat[s.category] || 0) + 1;
  const ranked = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const catLabel = { restaurant: 'restaurants 🍽️', coffee: 'coffee stops ☕', hotel: 'hotels 🏨', overlook: 'scenic overlooks 🌄', park: 'parks 🏞️', mountains: 'mountains 🏔️', museum: 'museums 🏛️', shopping: 'shopping 🛍️', hiking: 'hikes 🥾', beach: 'beaches 🏖️', concert: 'concerts 🎸', show: 'shows 🎭', roadside: 'roadside attractions 🛸', gem: 'hidden gems 💎', gas: 'gas stops ⛽', rest: 'rest stops 🚻', other: 'stops 📍' };

  if (ranked.length && ranked[0][1] >= 2) insights.push(`Your #1 stop type is ${catLabel[ranked[0][0]] || ranked[0][0]} — ${ranked[0][1]} planned so far. The Brain sees you.`);
  if (byCat.coffee) {
    const days = new Set(stops.filter((s) => s.day_date).map((s) => s.day_date)).size || 1;
    if (byCat.coffee / days >= 0.5) insights.push(`Coffee appears on most of your travel days. The Brain will never schedule a morning without it. ☕`);
  }
  const mustRatio = stops.length ? stops.filter((s) => s.priority === 'must').length / stops.length : 0;
  if (mustRatio >= 0.4) insights.push(`${Math.round(mustRatio * 100)}% of your stops are marked must-do. You travel with conviction. ⭐`);
  else if (stops.length >= 5 && mustRatio <= 0.15) insights.push(`You keep must-dos rare (${Math.round(mustRatio * 100)}%) — a go-with-the-flow crew. The Brain respects it. 🌊`);
  const dayCounts = {};
  for (const s of stops) if (s.day_date) dayCounts[s.day_date] = (dayCounts[s.day_date] || 0) + 1;
  const dayVals = Object.values(dayCounts);
  if (dayVals.length >= 2) {
    const avg = Math.round((dayVals.reduce((a, b) => a + b, 0) / dayVals.length) * 10) / 10;
    insights.push(avg >= 4 ? `You average ${avg} stops a day — packed itineraries are your love language. 🔥`
      : `You average ${avg} stops a day — you build in breathing room. Smart. 🧘`);
  }
  const earliest = stops.filter((s) => s.arrive).map((s) => s.arrive).sort()[0];
  if (earliest) insights.push(earliest < '09:00' ? `Earliest planned start: ${earliest}. Certified early birds. 🌅` : `Your days start at a civilized hour (earliest: ${earliest}). No alarm-clock vacations here. 😌`);
  if (postCount >= 5) insights.push(`${postCount} moments in your Family Feeds — this crew documents the journey. 📸`);
  if (pollCount >= 3) insights.push(`${pollCount} group votes so far. Democracy rides shotgun. 🗳️`);
  if (ratings.n >= 3) {
    const pct = Math.round((ratings.return_yes / ratings.n) * 100);
    insights.push(pct >= 70 ? `${pct}% of rated stops earned a "would go again." You pick winners. 🏆`
      : `Only ${pct}% of rated stops earned a "would go again" — a tough crowd with high standards. 🧐`);
  }
  if (insights.length < 2) insights.push('The Brain gets smarter with every stop, vote, and post you add. Keep traveling. 🧠');

  // AI polish: turn the raw stats into sharper observations when available
  if (ANTHROPIC_API_KEY && stops.length >= 5) {
    const raw = await askClaude(
      `You are the "Trip Brain" inside a group road-trip app. Given travel-pattern stats, write 3-4 short,
warm, funny observations about this traveler's style (second person). Each under 20 words. Respond ONLY
with a JSON array of strings. No advice, just observations that make them feel seen.`,
      `Stats: ${JSON.stringify({ stopsByCategory: byCat, mustDoRatio: mustRatio, avgStopsPerDay: dayVals.length ? dayVals.reduce((a, b) => a + b, 0) / dayVals.length : null, earliestStart: earliest, feedPosts: postCount, votes: pollCount, ratingsGiven: ratings.n, wouldReturnRate: ratings.n ? ratings.return_yes / ratings.n : null })}`,
      600
    );
    const ai = safeParse(raw, null);
    if (Array.isArray(ai) && ai.length) return res.json({ insights: ai.map((s) => String(s)).slice(0, 4), source: 'ai' });
  }
  res.json({ insights: insights.slice(0, 5), source: 'heuristic' });
});

// ---------------------------------------------------------------------------
// Export (their data is theirs)
// ---------------------------------------------------------------------------
app.get('/api/trips/:id/export', (req, res) => {
  const m = requireMember(req, res); if (!m) return;
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id);
  const stops = db.prepare('SELECT * FROM stops WHERE trip_id = ? ORDER BY day_date, position').all(trip.id);
  const members = db.prepare('SELECT u.name, m.role FROM trip_members m JOIN users u ON u.id = m.user_id WHERE m.trip_id = ?').all(trip.id);
  const posts = db.prepare('SELECT p.body, p.created_at, u.name AS author FROM trip_posts p JOIN users u ON u.id = p.user_id WHERE p.trip_id = ? ORDER BY p.id').all(trip.id);
  const expenses = db.prepare('SELECT e.category, e.amount, e.note, e.spent_on, u.name AS who FROM expenses e JOIN users u ON u.id = e.user_id WHERE e.trip_id = ? ORDER BY e.id').all(trip.id);
  res.setHeader('Content-Disposition', `attachment; filename="${trip.name.replace(/[^\w -]/g, '_')}.json"`);
  res.json({ trip, stops, members, feed: posts, expenses, exported_at: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`Going Somewhere! listening on :${PORT} (data in ${DATA_DIR}, AI ${ANTHROPIC_API_KEY ? 'on' : 'off — assistant disabled'})`);
});

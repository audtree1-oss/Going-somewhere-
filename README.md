# Going Somewhere! 🚗💨

**Every travel app plans the trip. Going Somewhere! runs it.**

A collaborative group-travel app built for Keely — born from a real
frustration: one person plans the trip, then spends the whole trip as a
human information desk. Here, every traveler opens the app and instantly
knows what's happening, where to be, and when to be ready.

*It plans the people, not just the places.*

## What's in V1

- **🌞 Today's Plan — the heart of the app.** Open it and see today:
  be-ready time, weather, drive time and mileage, the day's timeline
  stop-by-stop, tonight's hotel (confirmation #, check-in, Wi-Fi), and
  "if we have time" ideas waiting in the wings.
- **🔎 Big & Simple view (the Mom Button)** — today only, huge text, no
  menus, no editing. "Where are we going and when do I need to be ready?"
- **🗓️ Itinerary builder** — days and stops with categories (from
  scenic overlooks to gas stations — this app has road-trip DNA),
  arrival/departure times, ⭐ must-do / 👍 would-like / ⏳ if-we-have-time
  priorities, notes, cost, hours, parking, accessibility, and a wishlist
  for unscheduled finds. Map search pins stops automatically
  (OpenStreetMap — free, no API keys).
- **🗺️ Interactive map** — every stop pinned by category, driving routes
  drawn per day or for the whole trip, real drive times and mileage
  (OSRM routing — also free).
- **👥 Trip Pulse** — every traveler taps how they're doing: Ready,
  Need 10 minutes, Hungry, Bathroom stop, Low energy, Skipping this one…
  The group sees "5 of 6 ready" instead of a 47-message group chat.
- **🎶 Travel Rhythm** — the full quiz: pace, mornings, walking distance,
  food restrictions, spending comfort, must-dos, hard-nos, alone time,
  break frequency, splitting up, vacation personality. **Every question
  is skippable, and skipped questions simply vanish from the profile** —
  no blanks, no guilt. Each answer is Shared, Captain-only, or Private.
- **🗳️ Timed voting** — polls with a countdown. No response counts as
  "I'm good with whatever wins." Nobody holds six people hostage from a
  gift shop. Ties go to the captain.
- **✈️ Captains & permissions** — invite by code or link with
  can-edit / can-suggest / view-only access. Suggestions from travelers
  wait for captain approval.
- **✨ AI trip assistant** — "find attractions between Kingman and
  Flagstaff" → real suggestions you can add to the wishlist in one tap
  (needs `ANTHROPIC_API_KEY`; everything else works without it).
- **📸 The Family Feed** — a private per-trip timeline of little moments
  (photos, one-liners, hearts). Not social media: nobody outside the
  trip sees it, and it exports with your data.
- **🎒 Pack for Today** — auto-generated each morning from the day's
  stops and weather (hiking → boots & water, rain → umbrella, new
  hotel → pack up the room).
- **🧠 Trip Brain** — learns your travel style from real trips: favorite
  stop types, day density, coffee dependence, must-do decisiveness,
  how often stops earn a "would go again."
- **💵 Budget tracker** — total budget, expenses by category, spent /
  remaining / per-traveler math, "where it went" breakdown.
- **⭐ Worth it?** — three-tap post-visit ratings (money / time / again):
  family travel history, not anonymous reviews. Feeds the Brain.
- **🍰 Dessert First** — one delightful, low-disruption wildcard pulled
  from the wishlist. It never wrecks the day.
- **Export** any trip as JSON. Your data is yours.

## Architecture

Node/Express + SQLite on a persistent disk — the same proven architecture
as Erica HQ / Life Wrangler. One mobile-first vanilla-JS page, no build
step. Free/keyless external services: OpenStreetMap tiles + Nominatim
geocoding, OSRM routing, Open-Meteo weather.

## Run locally

```bash
npm install
npm start          # http://localhost:3000, data in ./data
```

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | SQLite DB + uploads location |
| `ANTHROPIC_API_KEY` | *(unset)* | Enables the ✨ trip assistant |

## Deploy to Render

**New + → Blueprint → pick this repo → Apply.** The `render.yaml`
blueprint provisions the web service and the persistent disk.

## Roadmap (the short version)

V1.5: discovery mode ("psst — cool garden, 4 minutes left"), Dessert
First button, golden-hour and last-chance nudges. V2: budget tracker,
packing lists, trip journal → automatic memory book, Change of Plans
mode (Keep / Swap / Split-and-Rejoin), Stripe subscriptions. V3:
native wrapper (push notifications, live location), **School Trip Mode**
(pods, headcounts, structured chaperone alerts) — same codebase,
different permission universe, and a privacy attorney first.

# Trip Planner — Build Plan

A mobile-friendly website (works great on iPhone browsers) + Node.js API to plan multi-day road trips.

## Features
- Fill a form: "I want to go to X from Y" + the date you're going.
- Add the places you want to stop at that day.
- App finds best places **on the way** and **at the destination**.
- AI assistant (Google Gemini, free) you can chat with — "best places to stay overnight", etc.
- Saves your trips (SQLite) so you can come back and keep planning.
- Add day 1, then day 2, day 3… keep going until the trip is over.
- Google-Maps-style map (Leaflet + OpenStreetMap) showing the route:
  safest/nicest way, closest to your chosen stops.

## Stack (all free, no credit card)
- **Backend:** Node.js + Express + better-sqlite3
- **AI:** Google Gemini API (free tier) — swappable
- **Maps/Geocoding/Routing:** Leaflet + OpenStreetMap + Nominatim + OSRM (free, keyless)
- **Frontend:** React (Vite) + Leaflet, responsive for iPhone

## Structure
```
trip-planner/
  server/    Express API + SQLite
  client/    React + Vite + Leaflet
```

## API
- POST/GET/PUT/DELETE /api/trips
- POST /api/trips/:id/days, PUT /api/days/:id
- GET  /api/geocode?q=
- GET  /api/route?points=lon,lat;lon,lat
- GET  /api/places?lat=&lon=&kind=
- POST /api/ai/chat

## Progress
- [ ] Scaffold server
- [ ] DB + trip/day CRUD
- [ ] Maps endpoints (geocode/route/places)
- [ ] AI endpoint (Gemini)
- [ ] Scaffold client
- [ ] Form + saved trips
- [ ] Day-by-day planner
- [ ] Map with route
- [ ] AI chat panel
- [ ] Run & verify

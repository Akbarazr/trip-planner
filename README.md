# 🚗 Trip Planner

A mobile-friendly website (works great in the iPhone browser) that plans multi-day trips
by car, plane, train, or bus. Fill out a form — *"I want to go to X from Y, on this date"* —
choose how you are traveling, and the app:

- 🚗 Draws a driving **route** and lets road travelers add flexible stops.
- ✈️ Searches live **airline offers** through Amadeus and shows departure/arrival times,
  connections, airlines, and available fares.
- 🚆 Searches **train and bus schedules** through Transitous, including transfers and
  intermediate stops. If no matching service exists, the app says so before creating the trip.
- ✨ Finds great places **on the way** and **at your destination** (attractions, hotels,
  food, fuel).
- 🤖 Gives you an **AI trip assistant** you can chat with — *"best places to stay
  overnight?"*, *"what should I see on the way?"*, *"is the route safe?"*
- 💾 **Saves your trips** so you can come back and keep planning.
- 📴 Keeps saved **itineraries, route overlays, and viewed map tiles** available offline.
- ➕ Plan **day 1**, then add **day 2**, **day 3**… as many as your trip needs.

Everything runs for **free with no credit card**: OpenStreetMap for maps, OSRM for driving
directions, and Google Gemini (free tier) for the AI — with a smart local fallback so the
assistant works even with **no API key at all**.

## Tech stack
- **Backend:** Node.js + Express + SQLite (`better-sqlite3`)
- **Frontend:** React (Vite) + Leaflet / react-leaflet
- **Maps:** OpenStreetMap tiles · Nominatim geocoding · OSRM routing · Overpass places
- **Transport:** Amadeus flights · Transitous train/bus schedules
- **AI:** Google Gemini (`gemini-1.5-flash`) — optional, falls back to local logic

## Project layout
```
trip-planner/
  server/   Express API + SQLite database
  client/   React + Vite web app (responsive / iPhone-friendly)
```

## Run it

Open **two terminals**.

**1. Backend**
```powershell
cd server
npm install          # first time only
copy .env.example .env
npm start            # http://localhost:4000
```

**2. Frontend**
```powershell
cd client
npm install          # first time only
npm run dev          # http://localhost:5173
```

Then open **http://localhost:5173**. On your iPhone, open the same URL using your
computer's LAN IP (e.g. `http://192.168.1.20:5173`) while on the same Wi-Fi.

## Deploy the API to Vercel

Firebase Hosting, Authentication, and Firestore can remain on the Spark plan while
Vercel hosts the Express API.

1. Create a Vercel project from this repository and set its root directory to `server`.
2. Add these encrypted environment variables:
   ```text
   USE_FIRESTORE=true
   CORS_ORIGINS=https://trip-planner-a663a.web.app,https://trip-planner-a663a.firebaseapp.com
   TRANSITOUS_CONTACT=https://trip-planner-a663a.web.app
   GROQ_API_KEY=your_key
   FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
   ```
   Generate the service-account JSON from **Firebase Console → Project settings →
   Service accounts**. Never commit it to the repository.
3. Deploy and confirm that `https://YOUR_API.vercel.app/api/health` returns `{"ok":true}`.
4. Set this in `client/.env.production`, then rebuild:
   ```text
   VITE_API_BASE=https://YOUR_API.vercel.app/api
   ```
5. Deploy the frontend and Firestore configuration:
   ```powershell
   cd client
   npm run build
   cd ..
   firebase deploy --only hosting,firestore
   ```

## Turn on smarter AI (optional, free)
The recommended option is Groq because it is fast and offers a free developer tier.

1. Create your own free key at **https://console.groq.com/keys**.
2. Put it in `server/.env`:
   ```
   GROQ_API_KEY=your_key_here
   GROQ_MODEL=llama-3.3-70b-versatile
   ```
3. Restart the backend.

Google Gemini is also supported. Create a key at **https://aistudio.google.com/apikey** and use:
   ```
   GEMINI_API_KEY=your_key_here
   GEMINI_MODEL=gemini-2.5-flash
   ```

Without a key the assistant still works using built-in trip-planning logic.

## Turn on live flight search

Train and bus search works through the public Transitous API. Flights require Amadeus
credentials because airline inventory is not publicly available without a provider account.

1. Obtain credentials for your Amadeus API environment.
2. Add them to `server/.env`:
   ```
   AMADEUS_CLIENT_ID=your_client_id
   AMADEUS_CLIENT_SECRET=your_client_secret
   AMADEUS_BASE_URL=https://test.api.amadeus.com
   ```
3. Restart the backend.

The Amadeus test environment may expose limited or cached offers. Set `AMADEUS_BASE_URL`
to the production/enterprise endpoint supplied with your account when moving beyond testing.

## How to use
1. Tap **New trip**, type where you're going **from** and **to**, choose car, plane,
   train, or bus, then pick a date.
2. For plane, train, or bus, search the live departures and select one before planning.
3. On the planner, tap **+ Add stop** under **Day 1** and search for places to visit.
   Car routes redraw around stops; scheduled transport keeps its selected journey fixed.
4. Use the **Attractions / Lodging / Food / Fuel** buttons to drop suggestions on the map
   for spots on the way and at your destination.
5. Chat with the **Trip Assistant** for overnight-stay ideas, safe routes, and more.
6. Tap **+ Add day** to plan the next day — repeat until your trip is complete.
7. Use **Save for offline** below the map. Open and zoom the map areas you need while online;
   viewed tiles, the itinerary, and route overlay remain available without a connection.
8. Everything auto-saves; find it later under **Your saved trips**.

## Switching to Google Maps later
The map uses Leaflet + OpenStreetMap so it's free today. To use Google Maps instead, swap
the `<TileLayer>` in `client/src/components/MapView.jsx` for a Google tiles layer and add a
billing-enabled Google Maps API key — the rest of the app stays the same.

## API reference (backend)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/trips` | List saved trips |
| POST | `/api/trips` | Create a trip (auto-adds Day 1) |
| GET | `/api/trips/:id` | Get a trip with days + stops |
| DELETE | `/api/trips/:id` | Delete a trip |
| POST | `/api/trips/:id/days` | Add the next day |
| DELETE | `/api/days/:id` | Remove a day |
| POST | `/api/days/:id/stops` | Add a stop to a day |
| DELETE | `/api/stops/:id` | Remove a stop |
| GET | `/api/geocode?q=` | Place name → coordinates |
| GET | `/api/route?points=lon,lat;lon,lat` | Driving route + distance/time |
| POST | `/api/transport/search` | Live flight, train, or bus departures |
| GET | `/api/places?lat=&lon=&kind=` | Nearby attractions/lodging/food/fuel |
| GET | `/api/trips/:id/suggestions?kind=` | Spots on the way + at destination |
| POST | `/api/ai/chat` | Chat with the trip assistant |

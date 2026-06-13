# Pixel Dating

A location-based dating app where users place pixels on a real map and connect through clicks. Visual, anonymous, and minimal.

## How it works

1. **Register** — Create a free account with name, email, gender, and city
2. **Verify email** — Click the link sent to your inbox
3. **Place a pixel** — Choose a spot on the map in your city and pay (€1.50 for a personal pixel, €1.80–€4.20 for events)
4. **Browse the map** — Explore city heatmaps, zoom into individual pixels
5. **Click to connect** — Send a click (like) to someone's pixel (10 per day)
6. **Match** — If the other person accepts, both get each other's email

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, TypeScript, Vite, Mapbox GL, React Query, React Router |
| Backend | Express 5, TypeScript, PostgreSQL (Supabase), PostGIS |
| Payments | Stripe Checkout (one-time) |
| Email | Resend (transactional) |
| Auth | JWT (httpOnly cookie), pgcrypto email encryption |

## Project structure

```
pixel_dating/
├── backend/
│   ├── src/
│   │   ├── index.ts          # Express app, middleware, routes
│   │   ├── db/
│   │   │   ├── index.ts      # Pool, query helper, withTransaction
│   │   │   ├── schema.sql    # Full DB schema
│   │   │   └── seed_cities.sql
│   │   ├── middleware/
│   │   │   └── auth.ts       # JWT verify, issueToken
│   │   ├── routes/
│   │   │   ├── register.ts   # POST /api/register, GET /api/auth/verify-email
│   │   │   ├── stripe.ts     # POST /api/stripe/webhook
│   │   │   ├── map.ts        # Heatmap, city pixels, pixel preview
│   │   │   ├── pixel.ts      # Validate + place pixel (Stripe checkout)
│   │   │   ├── like.ts       # Send like, respond to connection
│   │   │   ├── user.ts       # Profile, preferences, delete, export
│   │   │   ├── cities.ts     # City list, country detection
│   │   │   └── dev.ts        # Dev-only: activate, seed bots, wipe bots
│   │   ├── emails/           # All transactional email templates
│   │   └── services/
│   │       ├── connectionExpiry.ts  # Cron: expire connections + pixels
│   │       └── pixelPlacement.ts    # Validate location, create pixel
│   └── tests/                # Vitest test suite
├── frontend/
│   └── src/
│       ├── api.ts            # Axios client + all API calls
│       ├── App.tsx           # Routes
│       ├── main.tsx          # Entry point
│       ├── components/       # Nav, CityGrid, ErrorBoundary, CookieBanner
│       └── pages/            # Map, Register, Place, Inbox, Account, Privacy
└── .env.example
```

## Setup

### Prerequisites

- Node.js 20+
- PostgreSQL with PostGIS + pgcrypto extensions (or Supabase)
- Stripe account (for payments)
- Resend account (for emails)
- Mapbox account (for map tiles)

### 1. Clone and install

```bash
git clone <repo-url>
cd pixel_dating

# Backend
cd backend
npm install
cp ../.env.example .env   # Edit with your real values

# Frontend
cd ../frontend
npm install
cp ../.env.example .env   # Only the VITE_* vars
```

### 2. Configure environment

Edit `backend/.env`:

```env
DATABASE_URL=postgresql://postgres:[PASSWORD]@your-project.pooler.supabase.com:5432/postgres
JWT_SECRET=<random-32+-char-string>
EMAIL_ENCRYPTION_KEY=<passphrase-for-pgcrypto>
BACKEND_URL=http://localhost:3001
FRONTEND_URL=http://localhost:5173
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
RESEND_API_KEY=re_...        # or "stub" to log emails to console
```

Edit `frontend/.env`:

```env
VITE_BACKEND_URL=http://localhost:3001
VITE_MAPBOX_TOKEN=pk.your_mapbox_token
```

### 3. Database setup

Run in your Supabase SQL editor (or psql):

```sql
-- Enable extensions first
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

-- Then run schema.sql and seed_cities.sql
```

### 4. Run

```bash
# Terminal 1 — Backend
cd backend
npm run dev

# Terminal 2 — Frontend
cd frontend
npm run dev
```

Backend runs on `http://localhost:3001`, frontend on `http://localhost:5173`.

### 5. Stripe webhook (local dev)

```bash
stripe listen --forward-to localhost:3001/api/stripe/webhook
```

## Testing

```bash
cd backend
npm test          # Runs vitest (26 tests)
```

## API overview

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/register` | — | Create account |
| GET | `/api/auth/verify-email?token=` | — | Verify email + auto-login |
| GET | `/api/map/heatmap` | — | City aggregates |
| GET | `/api/map/city/:id` | — | Pixels in a city |
| GET | `/api/pixel/:id/preview` | Optional | Hover popup data |
| POST | `/api/pixel/validate` | — | Check placement rules |
| POST | `/api/pixel/place` | Required | Create pixel → Stripe checkout |
| POST | `/api/stripe/webhook` | Stripe sig | Payment confirmation |
| POST | `/api/like/:pixel_id` | Required | Send like (10/day limit) |
| POST | `/api/connection/:id/respond` | Required | Accept/reject |
| GET | `/api/user/me` | Required | Profile + likes remaining |
| PUT | `/api/user/me` | Required | Update preferences |
| DELETE | `/api/user/me` | Required | GDPR soft delete |
| GET | `/api/user/export` | Required | GDPR data export (JSON) |
| GET | `/api/user/connections` | Required | Inbox: pending, matched, sent |
| GET | `/api/cities?country=ES` | — | City list |
| GET | `/api/cities/detect-country` | — | IP-based country detection |
| GET | `/health` | — | Health check (tests DB) |

## Supported countries

Spain (ES), Switzerland (CH), Argentina (AR), Mexico (MX)

# Business Wheels — Setup Guide

## What changed

The app now has a real backend:

```
business-wheels/
├── server/                 ← NEW: Node.js/Express API
│   ├── index.js            ← entry point (Express + Socket.io)
│   ├── config/firebase.js  ← Firebase Admin SDK init
│   ├── middleware/auth.js  ← JWT verification + role guards
│   ├── routes/             ← auth, vendors, orders, riders, customers, analytics
│   ├── socket/index.js     ← Socket.io room/event handlers
│   └── db/seed.js          ← one-time Firestore seed script
├── assets/js/
│   ├── api.js              ← NEW: API client (replaces store.js)
│   └── auth-ui.js          ← NEW: login/register screen
└── customer|merchant|admin/
    └── (JS updated to use async API)
```

---

## Prerequisites

- Node.js 18+
- A Firebase project (free tier is fine)
- A Mapbox account (optional — for future map upgrade)

---

## Step 1 — Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → name it `business-wheels`
3. Enable **Firestore Database** (start in **test mode** for development)
4. Go to **Project Settings → Service accounts → Generate new private key**
5. Download the JSON file and save it as:
   ```
   business-wheels/server/firebase-service-account.json
   ```
   ⚠️ Never commit this file. It's already in `.gitignore`.

---

## Step 2 — Configure the server

```bash
cd business-wheels/server
cp .env.example .env
```

Edit `.env`:

```env
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json

# Generate a strong secret:
# node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=<your_secret_here>
JWT_EXPIRES_IN=7d

# Optional — get from https://account.mapbox.com
MAPBOX_TOKEN=pk.eyJ1...

PORT=3000
CORS_ORIGINS=http://localhost:8080
```

---

## Step 3 — Install dependencies

```bash
cd business-wheels/server
npm install
```

---

## Step 4 — Seed Firestore with demo data

```bash
node db/seed.js
```

This creates vendors, products, riders, 3 demo customers, 1 admin, and historical orders.

Demo accounts created:

| Role     | Email                | Password   |
|----------|----------------------|------------|
| Customer | srinivas@demo.bw     | demo1234   |
| Customer | anita@demo.bw        | demo1234   |
| Customer | rohit@demo.bw        | demo1234   |
| Admin    | admin@demo.bw        | admin1234  |

For merchants: register a new account via the merchant login screen (role = merchant).

---

## Step 5 — Start the backend

```bash
# From business-wheels/server/
npm run dev   # development (auto-restart on changes)
# or
npm start     # production
```

Server runs at **http://localhost:3000**

---

## Step 6 — Open the frontend

Serve the frontend with any static server:

```bash
# From business-wheels/ (root)
npx serve .        # or
python3 -m http.server 8080
```

Then visit:
- **Portal**: http://localhost:8080
- **Customer**: http://localhost:8080/customer/
- **Merchant**: http://localhost:8080/merchant/
- **Admin**: http://localhost:8080/admin/

> If you serve on a different port, update `CORS_ORIGINS` in `.env` and
> `window.BW_API_BASE` in each `index.html` to match.

---

## Architecture overview

```
Frontend (static HTML/JS)
  ├── api.js         ← fetch() calls → Express API
  └── Socket.io      ← real-time events (order updates, rider location)
          ↕
  Express server (Node.js)
  ├── JWT auth       ← bcrypt + jsonwebtoken
  ├── REST routes    ← /api/vendors, /api/orders, /api/riders, …
  ├── Socket.io      ← rooms per vendor / customer / admin
  └── Firebase Admin SDK
          ↕
  Firestore (Firebase)
```

### Firestore collections

| Collection   | Description |
|--------------|-------------|
| `users`      | Auth users (email + bcrypt hash + role) |
| `vendors`    | Vendor profiles |
| `products`   | Products (indexed by vendorId) |
| `riders`     | Rider profiles + live location/status |
| `customers`  | Customer delivery profiles |
| `orders`     | Orders with embedded items + history array |
| `favorites`  | Per-customer favorite vendor IDs |

### Socket.io events

| Event           | Direction      | Description |
|-----------------|---------------|-------------|
| `order:updated` | server → client | Order status/rider change |
| `rider:location`| server → client | Rider GPS position |
| `rider:updated` | server → client | Rider status change |
| `join:vendor`   | client → server | Subscribe to vendor's orders |
| `join:customer` | client → server | Subscribe to customer's orders |
| `join:order`    | client → server | Track a specific order's rider |

### API endpoints

```
POST   /api/auth/register
POST   /api/auth/login
GET    /api/auth/me

GET    /api/vendors
POST   /api/vendors                        [admin]
PUT    /api/vendors/:id                    [admin]
GET    /api/vendors/:id/products
POST   /api/vendors/:id/products           [merchant, admin]
PUT    /api/vendors/:vid/products/:pid     [merchant, admin]
DELETE /api/vendors/:vid/products/:pid     [merchant, admin]

GET    /api/orders
POST   /api/orders                         [customer]
GET    /api/orders/:id
PATCH  /api/orders/:id/status
PATCH  /api/orders/:id/advance
PATCH  /api/orders/:id/assign              [merchant, admin]

GET    /api/riders
PATCH  /api/riders/:id/status              [admin]
PATCH  /api/riders/:id/location

GET    /api/customers                      [merchant, admin]
GET    /api/customers/me                   [customer]
PUT    /api/customers/me                   [customer]
GET    /api/customers/me/favorites         [customer]
POST   /api/customers/me/favorites/toggle  [customer]

GET    /api/analytics                      [admin, merchant]
GET    /api/config
GET    /health
```

---

## Deploying to production

### Backend (e.g. Railway, Render, Fly.io)

1. Push `business-wheels/server/` as its own repo or monorepo
2. Set all environment variables in the platform's dashboard
3. Upload `firebase-service-account.json` as a secret file
4. Set `PORT` to whatever the platform exposes

### Frontend (Vercel, Netlify, GitHub Pages)

1. Update `window.BW_API_BASE` in each `index.html` to your deployed backend URL
2. Deploy `business-wheels/` (the static root) — no build step needed

---

## Development tips

- **Add a merchant**: register at `http://localhost:8080/merchant/` with role `merchant`,
  then use the Admin dashboard to onboard a vendor for them.
- **Watch real-time sync**: open Customer, Merchant, and Admin in three separate tabs —
  actions in one tab appear instantly in the others via Socket.io.
- **Re-seed**: run `node db/seed.js` again (it overwrites existing documents).

# Sardha

An on-demand local commerce and delivery platform connecting small merchants, their customers, and a fleet of location-tracked riders. Four role-based web apps run against a shared Node/Express + Firebase backend, so an order placed in the Customer app propagates in real time to the Merchant queue, the assigned Rider, and the Admin dashboard.

**Live:** https://sardha.vercel.app

---

## Architecture

```
sardha/
├── customer/        Customer app  — discovery, cart, checkout, live order tracking
├── merchant/        Merchant app  — order board, dispatch, inventory, customer book
├── rider/           Rider app     — assigned jobs, status updates, location reporting
├── admin/           Admin console — KPIs, fleet map, assignment, vendor mgmt, analytics
├── scan/            QR scan flow
├── assets/
│   ├── css/         shared design system
│   └── js/          shared client modules (data layer, DOM/util helpers)
└── server/          Node + Express + Firebase API
    ├── routes/      REST endpoints
    ├── middleware/  auth, validation, rate limiting
    ├── socket/      Socket.io realtime layer
    ├── db/          Firestore access + seed script
    ├── lib/         integrations and shared logic
    └── loadtest.js  load / throughput testing
```

**Frontend** — vanilla HTML/CSS/JavaScript, no build step, installable as a PWA (`manifest.json` + service worker). Four separate role-scoped apps sharing one design system and one client data layer.

**Backend** — Node.js + Express, Firebase Admin (Firestore) for persistence, **Socket.io** for realtime order and rider updates.

**Auth** — JWT (7-day expiry) with bcrypt-hashed credentials, role-scoped per app.

**Hardening** — Helmet, `express-rate-limit`, and a CORS origin allowlist.

**Integrations** — Razorpay (payments) · Mapbox (maps and rider tracking) · Cloudinary (image uploads) · web-push (push notifications) · Nodemailer (transactional email).

**Deploy** — Vercel (frontend) with Firebase Hosting and Render configs included.

---

## Order lifecycle

```
PLACED → ACCEPTED → ASSIGNED → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED
                                                            (or CANCELLED)
```

Every transition is written server-side and broadcast over Socket.io, so all four
interfaces converge on the same state without polling.

---

## The four interfaces

**Customer** — discover nearby vendors with search and favourites, browse a vendor's catalogue, build a cart, place and pay for an order, then track the rider live on a map through the full delivery lifecycle. Includes order history.

**Merchant** — an order board grouped into New / In progress / Completed; accept or reject incoming orders; dispatch to the nearest available rider, ranked by distance; manage inventory (add / edit / delete catalogue items); and a customer book ranked by spend.

**Rider** — assigned jobs queue, status transitions, and location reporting back to the platform.

**Admin** — platform KPIs and a recent-orders feed; a live fleet map with per-rider status control; dynamic task assignment that suggests and auto-assigns the nearest available rider to unassigned orders; vendor onboarding and management; and analytics (revenue by vendor, status distribution, fulfilment rate).

---

## Running it

**Backend**

```bash
cd server
npm install
cp .env.example .env        # fill in Firebase, JWT, Razorpay, Mapbox, Cloudinary
npm run seed                # optional: seed demo data
npm run dev                 # nodemon on PORT (default 3000)
```

**Frontend**

```bash
python3 -m http.server 8080   # from the repo root
```

Then open `http://localhost:8080` and pick an interface. For the full effect, open Customer, Merchant and Admin in separate tabs and watch updates propagate live.

> Make sure the frontend origin is listed in `CORS_ORIGINS` in `server/.env`.

---

## Notes

Built as a live product at BusinessBox. `server/loadtest.js` drives synthetic order
traffic against the API for throughput and latency checks.

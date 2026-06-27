# Business Wheels

An on-demand local logistics platform that connects street vendors and small shops with salaried, location-tracked riders. It ships as three interconnected web interfaces sharing **one live datastore**, so an order placed in the Customer app appears instantly in the Merchant queue and the Admin dashboard.

```
business-wheels/
├── index.html            ← portal: pick an interface
├── assets/
│   ├── css/styles.css    ← shared design system
│   └── js/
│       ├── store.js      ← shared "backend": data, domain logic, live pub/sub
│       └── util.js       ← shared DOM helpers (el, modal, toast, map, tracker)
├── customer/             ← Customer App
├── merchant/             ← Merchant App
└── admin/                ← Admin Dashboard
```

## Running it

No build step, no server required — it is plain static HTML/JS.

1. Open `index.html` in a modern browser (Chrome, Edge, Firefox, Safari).
2. From the portal, open the three apps. For the full effect, open **Customer, Merchant and Admin in separate tabs** and watch updates propagate live between them.

> Live cross-tab sync uses `BroadcastChannel` with a `storage`-event fallback. Both require the pages to be served from the same origin, which `file://` satisfies. If your browser is strict about `file://`, serve the folder instead: `python3 -m http.server` from inside `business-wheels/`, then visit `http://localhost:8000`.

## The three interfaces

**Customer App** — discover nearby vendors (with search and favorites), browse a vendor's menu, build a cart, place an order, then track the rider live on a map through the full delivery lifecycle. Includes order history. Switch between demo customers from the top bar.

**Merchant App** — an order board grouped into New / In progress / Completed; accept or reject incoming orders; dispatch to the nearest available rider (ranked by distance); manage inventory (add/edit/delete catalog items); and a customer book ranked by spend. Switch between demo vendors from the top bar.

**Admin Dashboard** — platform overview with KPIs and a recent-orders feed; a live fleet map with per-rider status control; **dynamic task assignment** that suggests and auto-assigns the nearest available rider to every unassigned order; vendor management (onboard/edit); and analytics (revenue by vendor, status distribution, fulfilment rate).

## Architecture

`store.js` exposes a single global `BW` API that behaves like a REST/WebSocket backend would. State persists in `localStorage` under `bw_db_v1` and changes are broadcast to every open tab. The apps subscribe via `BW.subscribe()` and re-render on change.

Order lifecycle:

```
PLACED → ACCEPTED → ASSIGNED → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED
                                                              (or CANCELLED)
```

Key `BW` methods: `placeOrder`, `setOrderStatus`, `advanceOrder`, `assignRider`, `setRiderStatus`, `upsertProduct`, `deleteProduct`, `upsertVendor`, `toggleFavorite`, `analytics`, `orders`, `vendors`, `riders`, `customers`, `reset`.

Because all state goes through `BW`, swapping the simulated backend for a real server is mechanical: reimplement those methods as `fetch` calls and replace the `BroadcastChannel` listener with a WebSocket subscription. Suggested production path: Node/Express or Fastify API, Postgres + PostGIS for geo, WebSockets for live updates, JWT auth per role, and a maps provider (Google/Mapbox) in place of the faux SVG-grid map.


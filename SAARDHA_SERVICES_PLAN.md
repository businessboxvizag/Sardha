# Saardha Services — Local Services Module (Plan)

**Author:** BusinessBOX (Stanley) · Vizag
**Status:** Approved to build as a **separate module** alongside the existing product/delivery platform.
**Scope chosen:** Phase 1 Pickup & Drop → Phase 2 Home Visit → Phase 3 Appointment/Discovery.

---

## 1. Why a separate module

Services do not fit "add to cart → deliver a product." A booking has a *time*, sometimes a *visit*, often a *quote instead of a price*, and no inventory. So Services gets its own data model, its own status flows, its own partner console, and its own admin tab — while **reusing** everything already built: accounts & OTP auth, the Saradhi rider fleet, Google Maps, Razorpay, ratings, and the admin shell.

Nothing in the current orders/vendors/products flow changes. Services is additive.

---

## 2. The four operational patterns (your list, mapped)

| Pattern | Your categories | Logistics | Pricing |
|---|---|---|---|
| **A. Pickup & Drop** | Laundry & ironing, tailoring/alteration, xerox/printing/lamination, bookbinding, courier collection, scrap (raddi) | Saradhi collects → shop processes → Saradhi returns | Fixed / per-item / weight |
| **B. Home Visit** | AC/fridge/washing-machine/RO repair, mobile & laptop repair, electrician, plumber, carpenter, locksmith, deep cleaning, pest control, tank cleaning, at-home salon | A technician travels to the customer | Visit fee + on-site quote |
| **C. Appointment / Discovery** | Salons, barbers, beauty parlours, gyms, yoga, spa, tattoo, photo studios, passport photo | Customer goes to the business | Fixed slot price / free to book |
| **D. Quote / Lead** *(later)* | Tent houses, DJ/sound, decorators, catering/tiffin, packers & movers, mini-truck, painters, borewell, waterproofing, tile/marble | Varies / project | Enquiry → quotes |

This build covers **A, B, C**. D is documented for later.

---

## 3. Data model (new collections)

```
serviceVendors      # a service business (parallel to "vendors")
  id, name, ownerUserId, categoryKey, area, lat, lng, img,
  patterns: ["pickup_drop" | "home_visit" | "appointment"],
  rating, ratingCount, active, status, createdAt

services            # a bookable service item (parallel to "products")
  id, serviceVendorId, name, description, img,
  pattern: "pickup_drop" | "home_visit" | "appointment",
  priceType: "fixed" | "from" | "per_unit" | "quote",
  price, unitLabel (e.g. "per kg", "per page"),
  durationMins, active

technicians         # optional, for home_visit (business staff or Saardha-vetted)
  id, serviceVendorId, name, phone, skills[], lat, lng, status, rating

bookings            # the core object (parallel to "orders")
  id, serviceVendorId, customerId, serviceId(s), pattern,
  status, slot { date, window }, address { ...structured }, lat, lng,
  riderId (pickup_drop), technicianId (home_visit),
  price, quote { amount, note, at }, paymentMethod, paymentStatus,
  otp (drop/complete), history[], ratingId, createdAt
```

Bookings are **kept separate from orders** — a different collection, different routes (`/api/bookings`), different socket rooms (`booking:<id>`). Riders/technicians and customers subscribe the same way orders do today.

---

## 4. Status flows (per pattern)

**A. Pickup & Drop** (reuses the rider fleet + OTP end-to-end)
```
REQUESTED → ACCEPTED → RIDER_ASSIGNED → PICKED_FROM_CUSTOMER
          → AT_SHOP → READY → OUT_FOR_RETURN → RETURNED (OTP) ✓
```
Two rider legs (collect, return). Payment on return or online. This is ~80% the existing order flow with a scheduled pickup and a second leg.

**B. Home Visit**
```
REQUESTED → ACCEPTED → TECH_ASSIGNED → EN_ROUTE → ARRIVED
          → QUOTED → APPROVED → IN_PROGRESS → COMPLETED (OTP) ✓
```
On-site quote step: customer approves the estimate before work starts. Technician navigates using the same Maps/navigate helper the Saradhi uses.

**C. Appointment / Discovery**
```
REQUESTED → CONFIRMED → (reminder) → COMPLETED ✓  |  NO_SHOW / CANCELLED
```
No logistics. Business confirms the slot; customer shows up. Saardha earns a booking fee.

---

## 5. Surfaces to build

- **Customer app:** a new **"Services"** entry on the home screen → category grid (Laundry, Repairs, Salon…) → business → pick service → schedule (slot / pickup window / address) → confirm → track booking. Reuses the structured-address card, map picker, OTP display, ratings.
- **Service-Partner console** (`/service/`): a separate lightweight app for service businesses — incoming requests, accept/quote, assign technician (Home Visit) or hand to Saradhi dispatch (Pickup & Drop), mark ready/complete. Kept apart from the merchant app.
- **Saradhi app:** Pickup & Drop bookings appear as two-leg tasks ("Collect from customer" → "Drop at shop", later "Collect from shop" → "Return to customer"), reusing the existing task card, navigate button, and OTP.
- **Admin:** a new **Services** tab — approve service businesses, see bookings live, category management, booking-fee/commission settings, and a services slice in analytics.

---

## 6. Monetization

- **Pickup & Drop:** commission % on the service value + delivery fee (two legs).
- **Home Visit:** platform fee on the visit + % of the approved quote.
- **Appointment:** flat booking fee (or free-to-list + featured placement).
- **Quote/Lead (D, later):** per-lead fee or subscription for listing.

All configurable in Admin → Settings, same pattern as the existing COD limit / delivery fee.

---

## 7. Build order

**Phase 1 — Module foundation + Pickup & Drop**
1. `serviceVendors` + `services` + `bookings` collections and `/api/service-vendors`, `/api/services`, `/api/bookings` routes (auth-gated, ownership-checked like orders).
2. Customer "Services" section: browse → schedule pickup → confirm → track.
3. Two-leg Saradhi tasks + OTP on return (reuse rider ops).
4. Service-Partner console (accept, mark ready) — minimal first cut.
5. Admin Services tab: approve businesses, live bookings, fee settings.

**Phase 2 — Home Visit**
6. `technicians`, slot picker, technician dispatch + navigate.
7. On-site **quote → approve** flow, completion OTP.

**Phase 3 — Appointment / Discovery**
8. Slot booking at business, confirm/remind, no-show handling, reviews.

**Later — Phase 4 (D):** quote/lead marketplace for events, catering, movers, contractors.

---

## 8. What reuses vs what's new

| Reused as-is | New for Services |
|---|---|
| Auth, OTP, profiles | `bookings` engine + status flows |
| Saradhi fleet, GPS, navigate, cash/OTP | Second rider leg (collect + return) |
| Google Maps + fallback, structured address | Slot / pickup-window scheduling |
| Razorpay, ratings, admin shell, socket rooms | On-site quote → approve (Home Visit) |
| Multi-tenant partner concepts | Service-Partner console + Admin Services tab |

---

*Next: build Phase 1 (module foundation + Pickup & Drop) end-to-end, then review before Phase 2.*

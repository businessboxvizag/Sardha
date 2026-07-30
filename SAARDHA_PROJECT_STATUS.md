# Saardha — Project Status & Continuity Handoff

*Last updated during build. Read this first to continue the project in a new session.*
*No secret values are stored here (this folder syncs to a public GitHub repo). Secrets live in Render env vars, the local `server/.env`, and `server/firebase-service-account.json`.*

---

## What Saardha is
A local home-delivery PWA (installable web app) for India: customers order from local shops they've **scanned**, and salaried delivery riders ("Saradhis") fulfil the orders. Four web apps share one live backend + database.

## Architecture
- **Frontend:** plain HTML/CSS/JS PWA (no framework). Four apps: `customer/`, `merchant/`, `admin/`, `rider/`, plus a `scan/` landing page and root `index.html` portal. Shared code in `assets/js/` (`api.js`, `auth-ui.js`, `util.js`, `alert-buzzer.js`, `install-prompt.js`) and `assets/css/styles.css`.
- **Backend:** Node/Express in `server/` (routes, socket.io, JWT auth, Firebase Admin SDK). Deployed on **Render** (service `sardha-api`).
- **Database & Auth:** Google Firestore + Firebase Auth (project `sardha-b48f1`). Firestore locked down — only the server (Admin SDK) writes.
- **Images:** Cloudinary (cloud `s3h602bx`, unsigned preset `saardha`).
- **Payments:** Razorpay (test mode for now).
- **AI help:** Google Gemini (`gemini-2.0-flash`).
- **Maps/tracking:** rider GPS + live ETA (customer polls rider location).

## Live URLs
- Customer site / apps: **https://saardha.com** (also https://sardha-b48f1.web.app)
  - /customer  /merchant  /admin  /rider  /scan
- Backend API: **https://sardha.onrender.com**
- GitHub repo (backend source Render deploys from): **github.com/businessboxvizag/Sardha** (branch `main`)

## Accounts owned by Stanley (all confirmed)
- GitHub: businessboxvizag  · Firebase: sardha-b48f1 (saardhalogistics@gmail.com) · Render: sardha-api
- Cloudinary, Razorpay, Gemini (Google AI Studio), domain saardha.com (GoDaddy)
- Admin login for the app: stored in Render env (`ADMIN_EMAIL` / `ADMIN_PASSWORD`) — reveal via the eye icon in Render.

---

## How to run locally (VS Code)
Folder: `D:\saardha\Sardha_with_payments`
1. `cd server` → `npm install` → `npm run dev` (needs `server/.env` and `server/firebase-service-account.json`).
2. Serve the site: right-click root `index.html` → "Open with Live Server". Use `localhost` (not 127.0.0.1) so Firebase Google login works.
- Apps auto-detect: on localhost they call the local backend; when deployed they call sardha.onrender.com.

## How to ship a change (see also HOW_TO_SHIP.md)
- **Frontend change** (apps, look, `assets/`, `*.html`): `firebase deploy --only hosting`  (~1 min)
- **Backend change** (`server/`): `git add -A` → `git commit -m "…"` → `git push`  → Render auto-deploys (~2–4 min). *(If push times out with HTTP 408, just run `git push` again.)*
- Changed both → run both. Plain `git push` works (upstream is set).

---

## What's BUILT and DEPLOYED
- Payments: **Cash on Delivery + Razorpay online** (server verifies signature + amount before accepting).
- **Rebrand** to Saardha everywhere; logo on portal + login screens; **red brand color**; favicons/app icon = logo.
- **New-order alarm** (chime + vibration + banner) for merchant & rider.
- **Ratings & reviews** after delivery (store + Saradhi), averages auto-update.
- **₹15 flat delivery fee** + **18% GST** on items (cart + backend total).
- **Order-flow fix:** orders stay PLACED in the merchant "New" queue → merchant Accepts → Dispatches a rider (auto-assign on placement was removed).
- **Rider availability rule:** an order won't be placed if no Saradhi is "available" (checked before charging for online). Rider must toggle **Online** in the rider app.
- **Double-order guard** + "Placing your order…" loading overlay.
- **Scanned-shops model, account-backed:** customer's shops saved to their account (`customers.shops`), sync across devices; scanning a shop QR (or `?v=` deep link) adds it. Migrates old device-local lists.
- **Single-device login** (session id rotates on login; middleware invalidates old device) + **persistent login** (token in localStorage).
- **Customer UI:** SVG nav icons, favorites removed, cart in footer + floating cart bar, Swiggy-style **profile page** with logout.
- **Premium store page:** store hero (logo, rating, delivery time), image-tiled item cards, ADD → −/+ stepper (in-place), veg dots.
- **Skeleton loaders**, **first-run onboarding guide** (4 steps) + **Help "?" button**.
- **AI help assistant** (chat sheet, quick chips, typing animation) — Gemini-powered.
- **Merchant product photo upload** → Cloudinary (client resizes then uploads); real photos show on customer store page (placeholder tile fallback).
- **Install prompt** (Android one-tap install / iOS Add-to-Home-Screen guide) in customer, merchant, rider.
- **Custom domain** saardha.com connected (Firebase Hosting), added to Firebase Authorized Domains; Render CORS allows saardha.com + firebase domains.
- Brand-color cleanup: no pure black except text.

## Render environment variables (names only)
`NODE_ENV, PORT, JWT_SECRET, JWT_EXPIRES_IN, CORS_ORIGINS, FIREBASE_SERVICE_ACCOUNT_JSON, FRONTEND_URL, ADMIN_EMAIL, ADMIN_PASSWORD, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, SMTP_USER, SMTP_PASS, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET, GEMINI_API_KEY`

---

## OPEN / PENDING items
- **GEMINI_API_KEY casing:** the Render variable must be exactly `GEMINI_API_KEY` (all caps). It was once created as `Gemini_API_Key` — verify it's renamed, or the AI assistant only gives its built-in fallback reply.
- **Regenerate the Gemini key** once (it appeared in chat), then update Render.
- **Go-live payments:** swap Razorpay TEST keys for LIVE keys (`rzp_live_…`) in Render, right before real launch.
- **Render free plan cold starts** (~50s first request after idle): upgrade to a small paid plan before real customers.
- **Rider & merchant flow:** Stanley has more changes planned here (not yet specified).
- **Operations to start:** real merchants + catalogs, hire salaried Saradhis, pick a launch zone, money settlement to merchants, pricing/commission, legal (business reg, agreements, privacy policy, insurance).
- **Later:** distance-based delivery fee (flat ₹15 for pilot); real App Store / Play Store apps (needs Apple Developer $99/yr + review) if wider reach is wanted.

## Gotchas / lessons
- Env var names are **case-sensitive**.
- Windows blocks `.js` files from unzipped downloads — right-click zip → Properties → **Unblock** before extracting.
- On iOS, "Add to Home Screen" only works in **Safari**; Apple blocks programmatic install.
- Firebase Storage needs the paid Blaze plan — that's why images use **Cloudinary** instead.
- `git push` HTTP 408 = transient; just retry.

---

## Session update — 2026-07-27 (customer-app UI batch)
Branch **`ui-improvements`** (commit `2eceaa1` + 2 files staged). On disk, **pending push + deploy**.

Implemented (customer app):
- **Logo mark** in the header beside "Saardha" (`assets/img/saardha-mark.png`, cropped from logo.png) — `util.js topbar`.
- **Zoom locked** on mobile: viewport `maximum-scale=1, user-scalable=no, viewport-fit=cover` + `touch-action: manipulation` (kills iOS double-tap zoom).
- **iPhone footer safe-area** fixed — the real cause was the missing `viewport-fit=cover`; now `env(safe-area-inset-bottom)` applies. Extra safe-area padding on content + cart bar.
- **Footer restructured:** Orders removed; **Saardha AI button docked centre** of the bottom bar (fixes the "AI button covers the price" bug — items 3 & 4 were one problem). Floating help bubble hidden on mobile.
- **Cart is now a full page** with a **Cart | Orders** toggle → Fresh orders (live) + Previous orders (one-tap **Reorder**). New `viewCart()`; router `cart`/`history` both map here.
- **Profile editable:** photo (DP, client-resized), name, phone, DOB; email read-only. New `BW.updateProfile`; server `PUT /api/customers/me` now accepts `phone, dob, photoUrl`.
- **Scan fixed for iPhone:** camera starts on a user tap (iOS requirement) + **jsQR fallback** (Safari has no BarcodeDetector, the real reason it wasn't opening); uploading a QR image now shows a preview + a **"Scan this QR →"** button.
- **Google sign-in:** popup now **falls back to redirect** on mobile/PWA (+ getRedirectResult on reload); real Firebase error codes surfaced (e.g. auth/unauthorized-domain).
- **Assistant:** richer knowledge prompt; route now logs the real Gemini HTTP error to Render logs and degrades to helpful reply instead of a silent generic one.

Files changed: `customer/index.html`, `customer/customer.js`, `assets/js/util.js`, `assets/js/api.js`, `assets/js/auth-ui.js`, `assets/css/styles.css`, `server/routes/assistant.js`, `server/routes/customers.js`, new `assets/img/saardha-mark.png`. All pass `node --check`; jsdom run drove Home→Cart/Orders→Profile→Scan→AI with no errors.

### To make this batch live
- `git add -A && git commit -m "customer UI batch" && git push`  → Render redeploys the 2 server files.
- `firebase deploy --only hosting`  → pushes the frontend.
- If git complains about a lock: delete `.git/index.lock` and `.git/HEAD.lock` first.

### Still open after this session
- **OTP verification (email + phone):** NOT built. Firebase **Phone auth is now enabled** in the console, so phone OTP via Firebase is low-lift; email = emailed 6-digit code. Needs a backend build — awaiting go-ahead.
- **Assistant key value:** if replies stay generic, check Render logs for `assistant: Gemini returned HTTP …`; a valid AI Studio key starts with `AIza`.
- **Rider & merchant flow changes:** still unspecified — Stanley to detail.

---

## Session update — 2026-07-27 (OTP verification — email + phone)
On disk, **pending push + deploy**. Built **safely behind a server flag** so deploying changes nothing until you turn it on.

Backend:
- `server/routes/auth.js`: `POST /api/auth/email-otp/send` and `/verify` — 6-digit code emailed via existing Gmail SMTP (SMTP_USER/SMTP_PASS), hashed + stored in Firestore `email_otps`, 10-min expiry, 30s resend throttle, 5-attempt cap; verify returns a 20-min signed `verifyToken`.
- `register` now, **only when `REQUIRE_SIGNUP_OTP=true`** and role=customer, requires a valid email `verifyToken` + a Firebase **phone** idToken (verified server-side via `admin.auth().verifyIdToken`, must carry `phone_number`). Stores `phone`, `dob`, `emailVerified`, `phoneVerified` on the user + customer docs.
- `server/index.js`: `/api/config` now returns `requireSignupOtp` so the client shows the OTP UI only when enabled.
- `assets/js/api.js`: `sendEmailOtp`, `verifyEmailOtp`.

Frontend (`assets/js/auth-ui.js`): customer signup now shows Phone + DOB, "Send email code"/"Verify email", and "Send phone OTP"/"Verify phone" (Firebase Phone Auth with invisible reCAPTCHA). "Create account" is gated on both being verified and passes the tokens to register. Only appears when `/api/config.requireSignupOtp` is true.

### To turn OTP on (after deploy + test)
1. Deploy code (git push → Render; `firebase deploy --only hosting`).
2. In **Render**, set `REQUIRE_SIGNUP_OTP=true` (leave unset/`false` to keep it off).
3. Prerequisites: **SMTP_USER/SMTP_PASS** = a Gmail + App Password (already used for password reset); Firebase **Phone provider enabled** (done) and your live domain in Firebase **Authorized domains** (needed for reCAPTCHA/phone). Test a full signup on the live domain before flipping the flag for everyone.
- Verified via `node --check` + a jsdom run: login screen → new-user → OTP block mounts, email verify path returns a token.

---

## Session update — 2026-07-27 (auth rewrite + tracker + fixes)
On disk, pending push + deploy. Files: `assets/js/auth-ui.js`, `assets/js/util.js`, `assets/css/styles.css`, `customer/customer.js`.

- **Separate Login / Sign up (#1):** auth screen rewritten with explicit **Log in | Sign up** tabs (customers). New users sign up; returning users log in. Login-only for merchant/rider/admin. Google + redirect-fallback kept.
- **Merchant rejection now shows (#2):** when the store declines (order → CANCELLED), the customer sees a red "Order declined by the store" banner in the order view, the S-tracker turns red, and a **live toast** fires the moment it's declined (also toasts on Accepted). Live-tracking text no longer says "waiting for a Saradhi" on a cancelled order.
- **S-curve order tracker (#3):** `util.js tracker()` replaced the linear stepper with an **S-shaped progress** (echoes the logo) — brand stroke fills Placed→Delivered with nodes on the curve and a pulsing current step; red S when cancelled. Verified by rendering the path to PNG.
- **Password show/hide (#4):** eye toggle on all password fields (login + signup).
- **Email OTP active in signup (#5):** signup now **requires** email OTP verification (6-digit code via your SMTP) before "Create account". Phone OTP is available/optional in signup (Firebase). Server enforcement still governed by `REQUIRE_SIGNUP_OTP`; client always verifies email regardless.

Note: Firebase **Phone Auth on the Spark (free) plan has a small daily quota** — fine for testing, but upgrade to Blaze before relying on phone OTP at volume. Email OTP (your SMTP) has no such limit.

---

## Session update — 2026-07-27 (logo link + scan install fix)
On disk, pending push + deploy. Files: `assets/js/util.js`, `scan/index.html`, `manifest.json`.

- **Logo no longer opens the 4-app portal (#1):** top-bar logo now links to the app's own home (`./`) instead of `../index.html`. Customers/merchants/riders can't reach the portal by tapping the logo. (The portal still exists at the site root for you/admin; if you want the root hidden from end users too, redirect `/` → `/customer/` — quick follow-up.)
- **Scan → install fixed (#2):** the install button pointed to `https://sardha.onrender.com/files/sardha.apk`, which doesn't exist on the API server → `{"error":"Not found"}`. There is no APK in the repo. Replaced the APK download with the **real PWA install**: Android uses the native `beforeinstallprompt` one-tap install (with an "Install app / Add to Home screen" menu fallback) and an "Open in browser" option; `appinstalled` opens straight into the store. All post-scan links now go to `/customer/?v=<vendorId>` (never the API host), so the store is added automatically. Installed-app name fixed from "BizWheels" → **"Saardha"** (root `manifest.json`).

---

## Session update — 2026-07-27 (admin: customer data + analytics dashboard)
On disk, pending push + deploy. Files: `server/routes/customers.js`, `admin/index.html`, `admin/admin.js`.

- **Customer data now visible to admin:** `GET /api/customers` was stripping `userId`, so the admin's customer table could never join the email — fixed. For **admin only** it now enriches each customer with email, authProvider, emailVerified, phoneVerified (joined from `users`). Merchants still get a minimal view (name + phone).
- **New top-level "Customers" tab** in the admin panel: searchable directory (name, email, phone, DOB, verified ✉/📱, orders, spent, last order, joined) + KPI row. Search filters in place (no focus loss).
- **Analytics dashboard rebuilt (Chart.js):** GMV, net revenue, orders, AOV, delivered/fulfilment, cancelled/cancel-rate, customers + new-today, repeat rate, delivery fees, avg delivery time, Saradhis online, verified counts — plus 8 charts: revenue trend (14d), orders/day, new customers/day, order-status doughnut, payment-method doughnut, peak order hours, top stores by revenue, top items. Chart.js loaded from CDN in `admin/index.html`; instances tracked + destroyed on re-render.
- **Overview** KPIs expanded (GMV, cancelled, repeat rate, customers) using the same live model.
- Nav reordered: Overview · Analytics · Customers · Stores · Fleet · Settings · Monitor. All admin-only (admin login required).

---

## Session update — 2026-07-27 (Bucket-1 data collection + admin)
On disk, pending push + deploy. New: `server/routes/events.js`, `privacy/index.html`. Changed: `server/index.js`, `server/routes/{assistant,auth,customers,admin}.js`, `assets/js/{api,auth-ui}.js`, `customer/customer.js`, `admin/admin.js`.

Scope decision (Swiggy/Zomato/Blinkit-style data): built the **legitimate, PWA-possible, first-party** subset only. Deliberately NOT built: device fingerprinting (IMEI/MAC/serial — browsers block), advertising IDs (IDFA/AAID), background GPS, call recording, and any data-selling/sharing with ad networks/FMCG/finance (needs consent framework + legal review under DPDP Act 2023).

Built:
- **Consent + Privacy Policy:** `/privacy/` page (DPDP-aligned template — needs lawyer review). Signup now has a **required consent checkbox**; `register` stores `consentAt`.
- **Behavioral event tracking:** new `events` collection + `POST /api/events` (customer) / `GET /api/events` (admin). Client `BW.track()` fires `app_open`, `search`, `view_store`, `add_to_cart`, `order_placed`, `cart_abandoned` (fire-and-forget, never blocks UI).
- **Richer profile:** signup + profile collect **gender** and **saved addresses** (tagged Home/Work/Other); server allow-list + register updated.
- **Device + support logs:** login logs now capture `user-agent` (shown as parsed "iOS · Safari" etc.); assistant Q&A saved to `support_logs`, exposed via `GET /api/admin/support`.
- **Admin panel:** Customers directory adds Gender + Addresses columns; Monitor gains **Behavior** (searches, store views, add-to-cart, cart→order conversion, top searches, most-viewed stores) and **Support** (transcripts) tabs; Logins shows Device.

Verified: all files `node --check`; jsdom run confirms Customers columns, Behavior/Support tabs, and device parsing render.

### Recommended before turning data collection fully on
- Have the privacy policy reviewed by a lawyer; set a real grievance-officer email.
- The commercialization/sharing items (Bucket 3) remain deliberately unbuilt — get consent flows + legal sign-off first.

---

## Session update — 2026-07-27 (admin security, per-user stores, merchant analytics, rider ratings, Google Maps)
On disk, pending push + deploy.

- **#1 Admin auth locked down** (`server/routes/reset.js`, `auth-ui.js`): password reset is now **refused for the admin role** in both forgot-password and reset-password; the "Forgot password?" link is hidden on the admin login. Admin credentials remain env-only (`ADMIN_EMAIL`/`ADMIN_PASSWORD`), non-registerable. Keep those env values private.
- **#2 Per-user store memory** (`customer/customer.js`): the device-global `bw_unlocked_vendors` key leaked stores between users on a shared device. Now the local cache is **namespaced per user id** and the **account-backed shop list is the source of truth**; the legacy global key is migrated into the account and deleted. Different customers on one device now see only their own stores.
- **#4 Merchant analytics** (`merchant/merchant.js`): new Analytics tab with **Today / This week / This month** toggle, revenue/AOV/delivered/cancelled, and a **COD vs Online** payment-method split (counts, amounts, %).
- **#5 Rider ratings** (`rider/rider.js`): rider home now shows their **average rating + count and recent customer comments** (the backend already aggregates rider ratings on rate).
- **#3 Google Maps** (`server/index.js`, `assets/js/util.js` + customer/admin/merchant): added `googleMapsKey` to `/api/config` and a shared `UI.gmap()` loader. Real embedded Google Maps now render on **customer order tracking, admin fleet, and merchant dispatch** when the key is set (falls back to the built-in map otherwise). The **rider app already uses Google Maps directions/navigation links.**

### To turn Google Maps on
Set `GOOGLE_MAPS_KEY` in Render env (a Google Cloud Maps JavaScript API key with billing enabled + your domain restricted). Until set, all apps use the built-in map — nothing breaks.

---

## Session update — 2026-07-27 (rider ops: OTP delivery, COD floating cash, geofence)
On disk, pending push + deploy. Decisions: kept current dispatch, ₹2,000 COD limit + Razorpay settlement + 24h auto-suspend, no face check, OTP-only drop-off.

Backend (`orders.js`, `riders.js`, `settings.js`):
- **Delivery OTP:** heading Out-for-delivery generates a 4-digit `deliveryOtp`; it's **stripped from all order payloads** (rider never sees it) and read by the customer via `GET /api/orders/:id/otp`. Marking Delivered (rider) requires the matching OTP.
- **COD floating cash:** on COD delivery the rider enters cash collected → added to `rider.cashInHand`; crossing the limit stamps `cashOverLimitSince`. Going online is **blocked (auto-suspended) after 24h** over limit. `POST /riders/:id/settle` + `/settle/verify` deposit cash via **Razorpay UPI** and clear the balance (`settlements` collection records it).
- **Settings:** admin-editable `codCashLimit` (default ₹2000) and `operationalZones` [{name,lat,lng,radiusKm}].

Rider app (`rider.js`, `index.html`): **Cash-in-hand card** (progress vs limit + "Settle via UPI" using Razorpay checkout), **geofence check** on go-online (must be inside a zone if any are set), **delivery flow** now pops an OTP (+ cash for COD) modal before completing, and a **suspended** banner when overdue.

Customer (`customer.js`): shows the **4-digit delivery OTP** on the tracking screen once the order is out for delivery.

Admin (`admin.js`): Fleet table adds a **Cash** column (red when over limit); Settings adds **COD limit** and an **operational-zones editor** (add by lat/lng or "use my location").

Verified: all `node --check`; jsdom confirms cash card, settle button, ratings, and the OTP+cash delivery modal.

Not built (per your choices / needs vendor): accept-decline dispatch ping, face/selfie verification, masked calling.

---

## Session update — 2026-07-27 (Delivery-as-a-Service platform, Phase 1)
On disk, pending push + deploy. New: `server/middleware/partnerAuth.js`, `server/lib/webhooks.js`, `server/routes/partner.js`, `PARTNER_API.md`. Changed: `server/index.js`, `server/routes/{orders,admin}.js`, `assets/js/api.js`, `rider/rider.js`, `admin/admin.js`.

Turned Saardha into a **multi-tenant delivery platform** any approved business can integrate with (the rice & millets app = partner #1).
- **Partner model + API keys:** `partners` collection; admin approves a business and issues a key (SHA-256 hashed, shown once). API-key auth via `x-api-key`.
- **Partner Delivery API** (`/api/partner`): `POST /quote` (distance-based fee), `POST /deliveries` (creates a job → auto-assigns nearest rider), `GET /deliveries/:id`. Deliveries live in the shared `orders` collection (`source:"partner"`) so dispatch, the rider app, tracking and COD-cash all reuse existing code.
- **Webhooks:** partner-configured URL is POSTed on every status change (`server/lib/webhooks.js`, wired into the order status/advance handlers).
- **Rider app:** renders partner deliveries (pickup name/coords from `order.pickup`, item text, "Via <partner>"). Partner deliveries skip the customer OTP (no Saardha customer); COD cash still tracked.
- **Admin:** new **Partners** tab — approve/suspend partners, set distance pricing (base + per-km + min), issue/copy the API key, see delivery counts.
- **Spec:** `PARTNER_API.md` — hand this to the rice app's developer.

Verified: all `node --check`; jsdom confirms the admin Partners view and rider partner-card render.

Phase 2 (next): prepaid wallet/billing + COD reconciliation/payout, self-serve partner dashboard, white-label public tracking page, road-distance pricing via Maps, cancel endpoint.

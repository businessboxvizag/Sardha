# Saardha v1 — Go-Live Runbook

This session shipped, verified (syntax-checked + unit-tested), and synced the code for:
discount/promo engine, products-only v1, and security hardening. The four **live** steps
below must run on your machine (this assistant's sandbox can't reach Firestore, GitHub,
or Render). Do them in order.

> First: if git complains about `index.lock`, delete the file `.git/index.lock` once, then continue.

---

## 0. What changed in the code (already done for you)

- **Discount/promo engine, end to end.** New `server/lib/pricing.js` is the single source
  of truth for totals. Percent-only promo codes; the customer gets the **bigger of** the
  store-wide % or a matching code (never both). Merchants manage codes in Store profile →
  **Promo codes**. Customers enter a code at checkout and see the discount line live.
- **Fixed a real payment bug.** Online orders previously compared the Razorpay amount to
  `subtotal + delivery` **without GST**, while the charge included GST — so paid online
  orders would fail with "Payment amount mismatch". Both paths now use the same total.
- **Products-only v1.** Local Services is hidden behind a server flag. It stays in the
  codebase and switches back on for v2 with one env var (no code change).
- **Security hardening.** `trust proxy` set (real client IP behind Render), rate limits now
  cover every route (+ tighter limits on payments and the AI assistant), production refuses
  to boot without `JWT_SECRET`, and a `/api/auth/reauth` primitive was added.

---

## 1. Rename the Gemini key in Render

The AI assistant reads **`GEMINI_API_KEY`** (all caps). Yours is currently `Gemini_API_Key`.

Render → **sardha-api** → **Environment** → click the variable name → rename to
`GEMINI_API_KEY` (value unchanged) → **Save** (Render redeploys).

While you're there, confirm these are set: `CORS_ORIGINS`, `JWT_SECRET`,
`FIREBASE_SERVICE_ACCOUNT_JSON`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_UPLOAD_PRESET`.
Leave **`FEATURES_SERVICES`** unset (or `false`) so v1 stays products-only.

---

## 2. Delete the demo/dummy data

A safe, targeted cleanup script is ready. It removes ONLY the seeded demo records
(5 vendors, 17 products, 5 riders, 3 demo customers, 4 historical orders, 3 demo service
partners) plus any `@demo.bw` / `@saardha.test` account. It never touches real data or your
env-seeded admin.

```bash
cd server
node db/cleanupDemo.js          # DRY RUN — prints exactly what it will delete, changes nothing
node db/cleanupDemo.js --yes    # actually delete
```

Run the dry run first and eyeball the list. This also clears the old `admin@demo.bw`
demo admin — your real admin comes from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in Render.

---

## 3. Deploy (backend + frontend)

> Heads-up: `git status` shows a few files that were already modified before this session
> (`.firebaserc`, `404.html`, `README.md`, the `manifest.json` files, `customer/index.html`,
> `merchant/index.html`). Review those with `git diff` so you know what's going out; they're
> yours, not from this session.

```bash
git add -A
git commit -m "v1: discount/promo engine, products-only flag, security hardening, payment GST fix"
git push
firebase deploy --only hosting
```

Render auto-deploys the backend on push. `firebase deploy` ships the apps.

---

## 4. Load + rate-limit test

Dependency-free, read-only (never creates orders). Point it at the live API once it's up:

```bash
cd server
node loadtest.js https://sardha-api.onrender.com 20 10
```

It reports throughput + p50/p95/p99 latency for `/health` and `/api/config`, then bursts
`/api/auth/login` with junk creds. Seeing **HTTP 429s** in that last phase is a PASS — it
means brute-force rate limiting is working. (Keep concurrency modest on the free tier.)

---

## 5. Post-deploy smoke test (2 minutes)

1. **Promo code** — as a merchant, Store profile → Promo codes → add e.g. `SAVE10` 10% →
   Save. As a customer, add items, enter `SAVE10` at checkout → discount line appears, total
   drops, GST recalculates on the discounted amount.
2. **Store-wide vs code** — set a store-wide % higher than the code; confirm the customer
   sees "your store discount already beats that code" and the bigger discount applies.
3. **Online payment** — pay once with UPI/card. It should now succeed (the GST mismatch is
   fixed). Confirm the order total equals items − discount + GST + delivery.
4. **Services hidden** — the customer home shows no "Local Services" tile; visiting
   `#/services` bounces to home. (To re-enable in v2: set `FEATURES_SERVICES=true`.)
5. **AI assistant** — tap **?**, ask "what are the delivery charges?" — a specific answer
   means `GEMINI_API_KEY` is read correctly.

---

## Security posture (for your reference)

- **Data access ("RLS"):** Firestore rules are **deny-all** for direct client access; every
  read/write goes through the API using the Admin SDK, gated by JWT + role. There is no
  public database surface to attack.
- **Sessions:** single-device enforcement (a new login supersedes old tokens); `/api/auth/reauth`
  lets you re-confirm a password before sensitive actions.
- **Transport/headers:** `helmet()` on the API; CSP + HSTS + frame/referrer/permissions
  headers on Firebase Hosting.
- **Pricing integrity:** all prices resolved server-side from Firestore; the client can't set
  its own prices or discounts — the server re-prices and re-verifies the paid amount.
- **Still on you (can't be done in code):** keep `JWT_SECRET` / `FIREBASE_SERVICE_ACCOUNT_JSON`
  secret, restrict the Firebase Web API key in Google Cloud console, and rotate any key that
  has ever been committed or shared.

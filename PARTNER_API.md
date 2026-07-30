# Saardha Delivery API (for partners)

Saardha provides last-mile delivery as a service. Your platform keeps its own
storefront, catalog, payments and customers — you call this API only to get an
order delivered by Saardha's rider fleet.

**Base URL:** `https://sardha.onrender.com/api/partner`
**Auth:** send your API key in the `x-api-key` header on every request.
(Saardha issues the key after approving your business.)

---

## 1. Quote a delivery fee
`POST /quote`
```json
{ "pickup": { "lat": 17.4400, "lng": 78.3489 },
  "drop":   { "lat": 17.4239, "lng": 78.4738 } }
```
Response:
```json
{ "distanceKm": 12.4, "fee": 119, "currency": "INR" }
```
Pricing is distance-based (`base + perKm × distance`, with a floor), set per partner.

## 2. Create a delivery
`POST /deliveries`
```json
{
  "reference": "YOUR-ORDER-1023",
  "pickup": { "name": "Millet Mart Warehouse", "phone": "+9190...", "address": "Plot 4, HITEC City", "lat": 17.4400, "lng": 78.3489 },
  "drop":   { "name": "Asha", "phone": "+9190...", "address": "12 Jubilee Hills", "lat": 17.4239, "lng": 78.4738 },
  "items": "5kg Foxtail millet, 2kg Red rice",
  "orderValue": 640,
  "paymentType": "COD"        // or "PREPAID"
}
```
Response (`201`):
```json
{ "deliveryId": "abc123", "status": "ASSIGNED", "rider": "Ravi",
  "fee": 119, "distanceKm": 12.4, "currency": "INR",
  "trackingUrl": "https://saardha.com/track/?d=abc123" }
```
The delivery immediately enters Saardha's fleet and is auto-assigned to the
nearest available rider. If none is free it stays `ACCEPTED` until one is.

## 3. Check status
`GET /deliveries/:deliveryId`
```json
{ "deliveryId": "abc123", "reference": "YOUR-ORDER-1023",
  "status": "OUT_FOR_DELIVERY", "fee": 119, "distanceKm": 12.4,
  "paymentType": "COD", "riderAssigned": true,
  "cashCollected": null, "deliveredAt": null }
```
Statuses: `ACCEPTED → ASSIGNED → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED` (or `CANCELLED`).

## 4. Webhooks (recommended)
Give Saardha a webhook URL (set when your partner account is created). On every
status change we `POST` it:
```json
{ "event": "DELIVERED", "deliveryId": "abc123", "reference": "YOUR-ORDER-1023",
  "status": "DELIVERED", "fee": 119, "at": "2026-07-27T12:30:00Z" }
```

## Notes
- **COD:** the rider collects cash and it's tracked in Saardha's rider cash system; reconciliation/payout to you is handled separately (billing — coming in Phase 2).
- **Prepaid:** you collect payment on your side; Saardha only delivers.
- Errors return `{ "error": "message" }` with a 4xx/5xx status.
- Keep your API key secret (server-side only). Ask Saardha to rotate it if leaked.

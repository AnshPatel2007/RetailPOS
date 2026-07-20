# Public API & Webhooks

Integrate external tools (websites, dashboards, accounting, delivery apps) with the POS.
Manage keys and webhook endpoints in the app under **Developers** (admin only).

## Authentication

Create an API key in Developers → API Keys. Send it on every request:

```
X-API-Key: pos_<your key>
```

Keys are shown **once** at creation — only a hash is stored. Revoke and re-issue if lost.
Rate limit: 600 requests per 15 minutes per key.

## Endpoints (read-only)

Base URL: `http://<your-server>/api/v1`

| Endpoint | Description | Query params |
|---|---|---|
| `GET /summary` | Today at a glance: net revenue, transactions, low-stock count | — |
| `GET /products` | Product catalog | `page`, `limit` (≤100), `search`, `isActive`, `updatedSince` (ISO) |
| `GET /products/:id` | One product | — |
| `GET /sales` | Sales with line items and payments | `page`, `limit`, `startDate`, `endDate` (YYYY-MM-DD), `status` |
| `GET /sales/:id` | One sale, including refunds | — |
| `GET /customers` | Customers (active) | `page`, `limit`, `search` |

All responses are `{ "success": true, "data": ..., "pagination"?: { page, limit, total, totalPages } }`.

```bash
curl -H "X-API-Key: pos_xxx" "http://localhost:5000/api/v1/summary"
```

## Webhooks

Add an endpoint in Developers → Webhooks with a URL and event subscriptions. Events:

| Event | Fires when | Payload `data` |
|---|---|---|
| `sale.completed` | A sale finishes at the register | `id`, `saleNumber`, `total`, `subtotal`, `tax`, `discount`, `surcharge`, `paymentMethod`, `customerId`, `itemCount`, `createdAt` |
| `sale.refunded` | A refund is issued | `saleId`, `saleNumber`, `refundAmount`, `refundMethod`, `reason` |
| `product.low_stock` | A sale drops a product to/below its threshold | `name`, `sku`, `stock`, `threshold` |
| `ping` | You press **Test** in the app | `message` |

Deliveries are JSON POSTs shaped as:

```json
{ "id": "<uuid>", "event": "sale.completed", "createdAt": "<ISO>", "data": { ... } }
```

### Verifying signatures

Every delivery carries `X-Webhook-Signature: sha256=<hex>` — an HMAC-SHA256 of the **raw body**
using your endpoint's signing secret (shown once when the endpoint is created).

```js
// Node/Express example — use the raw body, not re-serialized JSON
const crypto = require('crypto');

function verify(rawBody, signatureHeader, secret) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}
```

Respond with any 2xx to acknowledge. Notes:

- Delivery timeout is 5 seconds — respond fast, process async.
- Failed deliveries are **not retried**; the next event will attempt again.
- After 20 consecutive failures an endpoint is auto-disabled (re-enable it in Developers).

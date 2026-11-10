# Public API & Webhooks

Read-only access and event notifications for outside tools (websites, dashboards,
accounting, delivery apps). The app's own endpoints under `/api/*` are internal and
change with the app; integrate only through `/api/v1` and webhooks.

API keys and webhook endpoints are managed by the **platform administrator** in the
Admin panel → **Integrations** (`/admin/integrations`).

> **Scope:** keys are platform-wide. The read endpoints below return data from
> **every store**; there are no per-store keys yet. Only issue keys to tools you trust
> with all stores' data.

## Authentication

Create a key in Integrations → API Keys and send it on every request:

```
X-API-Key: pos_<your key>
```

The key is shown **once** at creation; only its hash is stored. Revoke and re-issue a
lost key. Rate limit: 600 requests per 15 minutes per key.

## Endpoints (read-only)

Base URL: `https://<your-server>/api/v1`

| Endpoint | Description | Query params |
|---|---|---|
| `GET /summary` | Today at a glance: net revenue, transactions, low-stock count | none |
| `GET /products` | Product catalog | `page`, `limit` (≤100), `search`, `isActive`, `updatedSince` (ISO) |
| `GET /products/:id` | One product | none |
| `GET /sales` | Sales with line items and payments | `page`, `limit`, `startDate`, `endDate` (YYYY-MM-DD), `status` |
| `GET /sales/:id` | One sale, including refunds | none |
| `GET /customers` | Active customers | `page`, `limit`, `search` |

Responses are `{ "success": true, "data": ..., "pagination"?: { page, limit, total, totalPages } }`.

```bash
curl -H "X-API-Key: pos_xxx" "http://localhost:5000/api/v1/summary"
```

## Webhooks

Add an endpoint in Integrations → Webhooks with a URL and the events to receive:

| Event | Fires when | Payload `data` |
|---|---|---|
| `sale.completed` | A sale finishes at the register | `id`, `saleNumber`, `total`, `subtotal`, `tax`, `discount`, `surcharge`, `paymentMethod`, `customerId`, `itemCount`, `createdAt` |
| `sale.refunded` | A refund is issued | `saleId`, `saleNumber`, `refundAmount`, `refundMethod`, `reason` |
| `product.low_stock` | A sale drops a product to or below its threshold | `name`, `sku`, `stock`, `threshold` |
| `ping` | You press **Test** in Integrations | `message` |

Each delivery is a JSON POST:

```json
{ "id": "<uuid>", "event": "sale.completed", "createdAt": "<ISO>", "data": { ... } }
```

### Verifying signatures

Every delivery carries `X-Webhook-Signature: sha256=<hex>`, an HMAC-SHA256 of the
**raw body** using the endpoint's signing secret (shown once when the endpoint is
created).

```js
const crypto = require('crypto');
function verify(rawBody, signatureHeader, secret) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}
```

### Delivery behavior

- Respond with any 2xx within **5 seconds**; process the event asynchronously.
- Deliveries run through the durable background job queue. Timeouts, network errors,
  408, 429 and 5xx responses are retried up to the job's attempt limit. Other 4xx
  responses fail without a retry.
- After **20 consecutive failures** an endpoint is disabled; re-enable it in Integrations.
- Delivery needs the background worker enabled (`BACKGROUND_WORKER_DISABLED` unset or
  `false`) and a stable `JOB_ENCRYPTION_KEY`; see `SETUP.md`.

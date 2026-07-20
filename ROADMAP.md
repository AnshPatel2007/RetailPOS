# POS Feature Roadmap — Gap Analysis & Ideas (researched July 2026)

> ## ✅ Execution status (updated July 19, 2026)
> **DONE — Phase 1:** 1.1 promotions engine · 1.8 receipt QR + "you saved" · 4.1 label printing
> (real Code128) · 4.8 shrinkage report · 4.9 dead stock/sell-through · 8.6 AI daily digest ·
> 3.5 customer tags/opt-in · section 9 consolidation (Exports tab in Reports; admin
> EmployeeSales + AdminSettings deleted w/ redirects; AdminReports + dual dashboards kept deliberately)
> **DONE — Phase 2:** 1.3 age verification + audit trail · 1.4 EBT · 1.2 price-embedded barcodes ·
> 5.3 cash management + Z-report · 7.2 tobacco scan-data export · 2.2 cash discount/card surcharge ·
> (7.1 lottery books judged already covered by existing LotteryBatch/DailyEntry)
> **DONE — Phase 3:** 8.1 NL analytics chat ("Ask AI" in Analytics) · 8.2+4.3 suggested POs ·
> 1.9 customer display · 8.5 product-by-photo · 3.1/3.2 campaigns + birthday automation ·
> 8.3 invoice OCR (existed as scan-receipt; repaired — was on a retired model — and hardened)
> **DONE — Phase 4 (partial):** 2.3 house accounts w/ credit limits, payments, statements ·
> 6.5 public API (/api/v1 + hashed keys + Developers page) & signed webhooks (see API.md)
> **BLOCKED on setup:** 2.1 Stripe Terminal (needs keys) · 6.1 QZ Tray printing (needs install)
> **REMAINING:** 6.4 self-checkout · 5.1 scheduling · 4.4 variants (if needed)
> Tests: 140 → 206 passing.

Benchmarked against: **Square for Retail, Clover, Lightspeed Retail, Shopify POS, Toast**, and
convenience-store specialists (**NRS, POS Nation, LMS**). Organized as: what we already have,
what competitors have that we don't, what nobody has (first-mover ideas), and what to
remove/consolidate. Each item has: what it is, why it matters, where it touches our code, and an
effort rating (S = <1 day, M = 1–3 days, L = 1–2 weeks, XL = multi-week).

---

## 0. What we already have (honest inventory)

Selling: cart, held sales (5 max, 24h expiry), split payments, item discounts, price override
(manager+), misc items, barcode scanning w/ dedupe, loyalty earn/redeem, gift cards + store
credit (transactional debit/credit), item-level refunds w/ restock + refund-to-tender, voids w/
reversal, offline sales queue w/ idempotency, receipt print (iframe fallback) + email receipt,
phone/last-4 customer lookup, cash suggestions, customer-linked carts.

Back office: inventory (logs, cycle counts, transfers w/ location scoping), suppliers (server
paginated), purchase orders, shifts w/ cash totals & over/short, lottery day open/close w/
autosave, multi-location w/ per-location tax, financial exports (CSV w/ refund journal entries),
reports (refund-adjusted revenue, item-level profit), analytics (comparison, business health,
realtime), audit log, 2FA + password reset, RBAC up to SUPER_ADMIN, dark mode + semantic tokens,
138+ passing backend tests.

**This is already at or beyond entry-tier Square/Clover on core register mechanics.** The gaps
are in: promotions, payments hardware, compliance (EBT/age), omnichannel, marketing, and
purchasing depth.

---

## 1. Selling & checkout gaps (competitors have these)

### 1.1 Promotions / pricing engine — **the single biggest gap** (XL, highest priority)
Every major POS has this; we have only manual per-item discounts.
- Promotion types to support: **BOGO** (buy X get Y free/%), **mix-and-match groups**
  ("any 2 energy drinks for $5"), **quantity pricing** (2/$1.00, 3/$5.00), **time-bound**
  (happy hour, weekend), **manufacturer buydowns** (vendor-funded price cuts with cost basis
  adjusted so margin reports stay honest — critical for tobacco), **coupon codes** (typed or
  barcode-scanned), threshold offers ("$5 off $50+").
- Design: new `Promotion` model (type, rules JSON, priority, stacking policy, date/time window,
  locationIds), evaluation engine in `cartStore.ts` mirrored server-side in
  `sale.controller.ts` (server is source of truth, same pattern as loyalty redemption).
  Store applied promotions per SaleItem for reporting ("promo lift" report later).
- UI: new `pages/Promotions.tsx` (manager+), cart lines show promo badges, receipt shows
  "You saved $X.XX" (proven basket-size driver).

### 1.2 Price-embedded barcodes & weighted items (M)
Barcodes starting with `2` encode price or weight (format `2CCCCCWWWWWK`). Needed for deli/
produce/butcher use. Parse in the scanner service (`services/hardware.ts`), add
`Product.soldByWeight` + `unitOfMeasure`. Also: manual weight entry numpad mode. Scale hardware
integration can come later (see 6.3).

### 1.3 Age verification workflow (M) — c-store table stakes
`Product.minimumAge` (18/21). On add-to-cart, modal: scan ID barcode (PDF417 driver's license
parsing is a well-known format, pure client-side) or manual DOB entry, or "visually verified"
button. **Log every verification event** (timestamp, cashier, product, method) — competitors sell
this as a compliance audit trail. Blocks checkout until cleared; one verification covers the
whole cart.

### 1.4 EBT/SNAP support (L)
`Product.ebtEligible` flag; new tender type `EBT` that can only cover the eligible subtotal
(auto-computed, never manual — that's the differentiator NRS advertises); remainder splits to
cash/card. Tax handling: EBT-paid items are tax-exempt in most states. Touches validator,
sale controller split-payment logic, payment modal (show "EBT eligible: $X.XX").

### 1.5 Exchanges (M)
We have refunds; we don't have "return item A, take item B, pay/receive the difference" as one
transaction. Model as a Sale linked to a Refund (`exchangeForSaleId`), one receipt. Cashiers
currently have to do two transactions.

### 1.6 Tax exemption & tax overrides (S–M)
Tax-exempt customers (resale certificate number stored on Customer, printed on receipt),
per-sale tax-exempt toggle (manager), and per-item tax categories (grocery vs prepared food
rates) instead of single boolean `isTaxable`.

### 1.7 More tender types & tender config (S)
Configurable custom tenders (check, house account, mobile wallet marker) so reports can break
them out. Currently the enum is fixed.

### 1.8 Receipt upgrades (M)
- SMS receipts (Twilio) next to email.
- QR code on receipt linking to a hosted digital receipt page (also enables 3.4 feedback).
- Configurable header/footer/logo per location in store settings (partially exists — finish it).
- Gift receipts (no prices).

### 1.9 Customer-facing display (M–L)
Second screen (route `/customer-display` opened on an HDMI-attached display, synced via
BroadcastChannel — no backend needed) showing cart lines, total, loyalty balance, and an
idle-state promo slideshow. Square/Clover ship hardware for this; we can do it with any monitor.

### 1.10 Layaway / special orders (M)
Sale status `LAYAWAY` with deposits (partial payments over time), stock reserved. Common in
Lightspeed; useful for higher-ticket retail.

---

## 2. Payments (the credibility gap)

### 2.1 Real card processing (XL, do when going to production)
Today card payments are reference-number honor system. Integrate **Stripe Terminal** (best dev
experience, WisePOS E readers) or Square's SDK. Server-side PaymentIntent per sale, webhook
confirmation, automatic reference storage, refunds routed back through the gateway.
This is the line between "demo" and "sellable."

### 2.2 Cash discount / surcharge program (S–M)
Configurable % surcharge on card tenders or discount for cash — extremely common in c-stores.
Must appear as its own line for legal compliance.

### 2.3 House accounts / accounts receivable (L)
Charge-to-account for trusted customers/businesses: credit limit, statement generation
(monthly PDF/email), payments against balance. Lightspeed has it; NRS doesn't — differentiates
us for bodegas that run tabs.

### 2.4 Offline card queue (M)
We queue offline cash sales already; extend to "card — deferred capture" with explicit risk
banner, capturing when back online (Clover's offline payments are a headline feature).

---

## 3. Customers, loyalty & marketing

### 3.1 Coupons & campaigns (L)
Generate coupon codes/barcodes tied to promotions (1.1), email them to segments, track
redemption rate. Segments: lapsed 30/60/90 days, top spenders, category buyers (we already have
the purchase history to compute this — pure SQL).

### 3.2 Birthday & win-back automations (M)
Cron job (node-cron) + `Customer.birthDate`: auto-email a coupon on birthday / after N days
inactive. Small effort, big perceived polish.

### 3.3 Loyalty upgrades (M)
- Points multipliers per category or per promotion ("double points Tuesday").
- Punch-card style item rewards ("buy 9 coffees get 1 free") alongside points.
- Tier benefits actually enforced at checkout (e.g., GOLD gets 5% off) — tiers currently exist
  but confer nothing automatic.

### 3.4 Receipt-based feedback / NPS (S–M)
QR on receipt → 1-tap rating page → stored per sale/cashier. Roll up into Analytics. Almost no
SMB POS does this natively (Square sells it as an add-on).

### 3.5 Customer profile depth (S)
Notes, tags, marketing opt-in flags (needed before 3.1 legally), total-lifetime-value on the
profile header (we compute stats already).

---

## 4. Inventory & purchasing depth (Lightspeed's home turf)

### 4.1 Label printing (M)
Generate barcode labels (Code128 via JsBarcode) in Avery/thermal layouts from Inventory:
select products → print sheet. Constantly-used feature we lack entirely.

### 4.2 Receiving & vendor invoice flow (L)
Receive against PO with per-line cost entry → auto-update product cost (choose: last cost vs
moving average — pick moving average, store both), discrepancy report (ordered vs received).
CSV import of vendor price lists to bulk-update costs.

### 4.3 Reorder automation (M)
`reorderPoint` + `reorderQuantity` per product/location; "Suggested PO" screen that drafts a PO
per supplier from everything below reorder point (one click → PO). Later feed forecasting (8.2).

### 4.4 Product variants / matrix (L)
Size/color/flavor matrix under one parent (Lightspeed's killer feature). Schema:
`Product.parentId` + `variantAttributes` JSON. Big lift in UI (grid editor) — only do this if
the store sells apparel-like goods; c-stores mostly don't need it.

### 4.5 Bundles / kits (M)
Sell a 6-pack SKU that decrements 6 single units (or its own stock). `BundleComponent` table;
sale controller explodes components for stock + COGS.

### 4.6 Case/pack unit conversions (M)
Buy by the case (24), sell by the each — PO lines in cases, stock in eaches, per-unit cost
derived. Pairs with 4.2.

### 4.7 Expiration date / lot tracking (M–L)
`InventoryLot` (expiry, qty). "Expiring soon" report + markdown suggestion. Grocery/c-store
differentiator; Square/Clover don't do this natively.

### 4.8 Shrinkage & waste tracking (S)
Reason-coded stock adjustments (damage, theft, expiry, sampling) — we have InventoryLog, add a
`reason` enum + a shrinkage report by reason/category/period.

### 4.9 Dead stock & sell-through reports (S)
"No sales in N days with stock on hand" + sell-through % + GMROI per category. All computable
from existing tables; pure reporting work.

---

## 5. Employees & operations

### 5.1 Scheduling (L)
Weekly shift scheduler (drag grid), publish → employees see their shifts, clock-in warns when
off-schedule. Toast/Square sell this as paid add-ons.
### 5.2 Timeclock → payroll export (S)
We track clock-in; add breaks, edit-with-audit, CSV export formatted for Gusto/ADP import.
### 5.3 Cash management (M)
Safe drops (mid-shift cash pulls), paid-in/paid-out with reasons, bank deposit records,
denomination-count drawer close (we have over/short; formalize a Z-report per drawer per day).
### 5.4 Sales goals & leaderboard (S–M)
Per-employee daily/weekly goals; EmployeeSales page gets goal progress + (optional) leaderboard.
### 5.5 Training mode (M)
Toggle that routes sales to a sandbox flag (excluded from all reports) so new hires can practice.
Surprisingly rare among competitors, cheap for us (a `isTraining` flag filtered everywhere —
leverage the queryFilter util).
### 5.6 Manager approval push (M)
Price overrides/refunds beyond threshold trigger an approval request another logged-in manager
can approve from their device (websocket or polling), instead of manager walking over to type
their PIN. Nobody in the SMB tier does this well.

---

## 6. Hardware & platform

### 6.1 Real receipt printer support (M–L)
ESC/POS printing via **QZ Tray** (or WebUSB) instead of browser print dialogs — silent printing,
cash drawer kick command through the printer. This is the #1 "feels like a real POS" upgrade.
### 6.2 PWA / kiosk hardening (M)
Installable PWA, fullscreen kiosk mode, on-screen keyboard friendliness, wake-lock. We're close
already given the offline queue.
### 6.3 Scale integration (M)
Serial/USB scale read (Web Serial API) feeding 1.2 weighted items.
### 6.4 Self-checkout mode (L)
Locked-down route: customer scans, pays by card only (needs 2.1), calls attendant for
age-restricted/alcohol (needs 1.3 to auto-flag). 2026's loudest trend; almost no SMB-priced
system offers a browser-based self-checkout — genuine differentiator.
### 6.5 Public API + webhooks (M)
API keys, webhook events (sale.created, stock.low). Turns us into a platform; Clover's app
market is its moat.
### 6.6 Automated backups & data export (S)
Scheduled pg_dump + one-click full CSV export. Trust feature for small owners.

---

## 7. Convenience-store differentiators (our niche — we already have Lottery!)

### 7.1 Lottery book-level tracking (M–L) — extend our existing edge
We do day open/close; NRS's "LottoShield" does book activation/close, per-ticket-number
day counts, and reconciles lottery cash vs drawer. Add `LotteryBook` (game, book #, ticket
range, activated/closed) and compute sold-count from start/end ticket numbers scanned at shift
close. **We're already ahead of Square/Clover/Lightspeed here (they have nothing) — this makes
the lead decisive.**
### 7.2 Tobacco scan-data export (M)
Altria/RJR scan-data programs pay stores monthly for reporting tobacco sales. The deliverable
is a weekly CSV in their fixed spec from data we already store. Pure export work that literally
pays the store owner — huge selling point, and no generic POS includes it free.
### 7.3 Camera/DVR linkage (M, see also 8.5)
Store per-sale timestamp + register ID so any transaction can be jumped-to in DVR footage;
optionally trigger a webcam snapshot on no-sale/void/refund events, attached to the audit log.
Loss-prevention feature NRS charges for.
### 7.4 Fuel is out of scope
Pump controllers (Gilbarco/Wayne) are hardware-certification territory — explicitly don't.

---

## 8. First-mover ideas (researched: none of the mainstream SMB systems ship these natively)

### 8.1 Natural-language analytics chat (M–L) — **best effort-to-wow ratio**
"How did last Tuesday compare to the Tuesday before?" → Claude API with tool-use against our
existing report endpoints (read-only, scoped). We already have every aggregate endpoint it
needs. 2026 buyers ask for "AI" — this is the demoable answer.
### 8.2 AI reorder forecasting (M)
Weekly job: sales velocity + day-of-week seasonality → suggested order quantities per supplier,
explained in plain English ("Red Bull 12oz sells ~9/day, spikes Fri/Sat; order 84"). Feeds the
Suggested PO screen (4.3).
### 8.3 Vendor invoice OCR receiving (L)
Photo of a paper vendor invoice → Claude vision → structured lines → prefilled receiving screen
(4.2). Bodega owners receive dozens of paper invoices weekly; nobody in the SMB tier does this.
### 8.4 Anomaly / sweethearting detection (M)
Nightly job flags statistical outliers: cashier void/refund/no-sale rates vs peers, discounts
clustered on the same customer, drawer over/short patterns. Surface on AdminDashboard.
Enterprise LP tools do this at $$$; SMB POSes don't.
### 8.5 New-product-by-photo (M)
Snap an unknown item → barcode lookup (Open Food Facts / UPCitemdb free APIs) + Claude fallback
from the photo → prefilled name/category/size; owner just types the price. Onboarding 3,000 SKUs
is the #1 pain when a c-store switches POS — this is a killer migration feature.
### 8.6 AI end-of-day digest (S)
Cron email/SMS at close: revenue vs same-day-last-week, top movers, anomalies, low stock,
written by Claude in three sentences. Cheap, delightful, retention-driving.
### 8.7 Natural-language promo builder (S–M, after 1.1)
"Monster 2 for $6 this weekend" → parsed into a Promotion draft the manager confirms. Makes the
promotions engine usable by non-technical owners.

---

## 9. Remove / consolidate / simplify

- **Reports vs AdminReports vs Analytics vs Financial vs EmployeeSales** — five overlapping
  read-only pages. Consolidate to: **Reports** (operational, all roles per RBAC) and
  **Analytics** (trends/AI); fold Financial exports into Reports as an Export tab; fold
  EmployeeSales into Analytics or Shifts. Fewer pages = less maintenance and less user confusion.
- **AdminSettings** is already just link cards — merge into Settings with role-gated sections
  and delete the page.
- **Dashboard vs AdminDashboard** — make one Dashboard whose widgets are role-driven.
- Audit `services/api.ts` for endpoints no page calls anymore (post-refactor drift).
- Held-sale limit (5) and 24h expiry should be store settings, not constants.

---

## 10. Recommended sequence

**Phase 1 — sell-more quick wins (~2–3 weeks):**
1.1 Promotions engine (start with quantity pricing + BOGO + time windows), 1.8 receipt QR +
"you saved", 4.1 label printing, 4.8/4.9 shrinkage + dead-stock reports, 8.6 AI daily digest,
3.5 customer tags/opt-in, 9 consolidation of report pages.

**Phase 2 — c-store compliance moat (~3–4 weeks):**
1.3 age verification + audit trail, 1.4 EBT, 7.1 lottery book tracking, 7.2 tobacco scan-data
export, 1.2 price-embedded barcodes, 5.3 cash management/Z-report, 2.2 cash discount.

**Phase 3 — platform & AI (~4–6 weeks):**
2.1 Stripe Terminal, 6.1 QZ Tray printing + drawer kick, 8.1 NL analytics chat, 8.2 forecast →
4.3 suggested POs, 8.5 product-by-photo, 3.1/3.2 campaigns + birthday automation, 1.9 customer
display.

**Phase 4 — expansion bets:** 6.4 self-checkout, 2.3 house accounts, 8.3 invoice OCR,
4.4 variants (only if needed), 6.5 public API/webhooks, 5.1 scheduling.

---

## Sources
- https://squareup.com/us/en/retail/capabilities · https://www.nerdwallet.com/business/software/reviews/square-for-retail
- https://www.selecthub.com/pos-software/clover-vs-lightspeed-retail/ · https://www.lightspeedhq.com/pos/lightspeed-vs-clover/
- https://nrsplus.com/small-business/pos-system-for-convenience-stores/ · https://nrsplus.com/blog/7-must-have-pos-features-every-cstore/
- https://www.unisonpayment.com/blog/convenience-store-pos-system · https://fitsmallbusiness.com/convenience-store-pos-system/
- https://www.shopify.com/enterprise/blog/omnichannel-pos · https://askphill.com/blogs/blog/shopify-pos-whitepaper
- https://swiftforcetech.com/pos-system-trends-2026/ · https://intellias.com/retail-technology-trends/
- https://realtimepos.com/promotions-management/ · https://x-series-support.lightspeedhq.com/hc/en-us/articles/25533775868571

# Dashboard and checkout review — October 25, 2026

## Findings and changes

| Finding | Result |
| --- | --- |
| Sale number disagrees with dashboard date | New sale numbers use the store's configured timezone and the transaction's recorded time, including offline uploads and reconciliation. Dashboard date aggregation already used the store timezone. |
| Product taps require quantity confirmation | Taps and barcode scans add one immediately. The cart quantity button opens the quantity editor. Stock limits are enforced in the shared cart store and again at checkout. |
| Stock threshold looks like minutes | Dashboard alerts now say `Min stock: 5`. |
| Empty collection chart has arbitrary axes | All-zero hourly collections show the existing empty-state presentation. Nonzero and negative collections retain the chart. |
| Sidebar truncates store name | The store name has its own full-width wrapping row below the brand and connection indicator. |
| Staff wages and PIN exposure | Not reproducible in the current implementation. The roster has no wage column; Payroll is owner-only. Team accounts use masked passwords, not PINs. Regression tests cover the roster, password field, wage redaction and cashier access restrictions. |

Recent Sales now also displays each transaction's date, time and zone in the
store's calendar, alongside its relative time. Receipt scanning accepts the
current UUID sale numbers as well as legacy four-digit suffixes.

The reported A&P transaction
`SALE-20261024-28d2863c-c5d6-4741-86ca-39d5fd3e2dc8` was recorded at
`2026-10-24T04:45:56.065Z`: **October 23, 2026, 11:45:56 PM CDT**. At the reported
October 24 dashboard time, excluding its $2,873.34 from Today's Collections was
correct. Its old UTC date prefix was misleading. Existing booked identifiers
and store data were preserved; no historical renumbering was performed.

## Verification

All transaction tests use the guarded disposable databases through
`scripts/verify-pos.cjs`. Live store records were inspected read-only.

- Backend: 72 passing tests across sale-number, dashboard, privacy, receiving,
  count/inventory consistency, offline reconciliation, sale/reversal and
  report-date suites. Coverage includes Chicago midnight, New Year, daylight
  saving and seven-day boundaries; cashier 403 responses; and exactly one audit
  entry after concurrent receipt/count approval retries.
- Frontend unit suite: 41 passing tests, including shared cart quantity/stock
  guards.
- Checkout/dashboard browser run: 25 passing scenarios covering immediate taps
  and scanner input, automatic promotions, cash/split tender, out-of-stock
  products, age verification, voids, recovery and dashboard totals.
- Responsive/role browser run: all 36 scenarios passed. This includes the six
  findings scenarios, six reduced-laptop checks, and owner/manager/cashier/platform
  route reviews on desktop, tablet and phone in both themes. Across both runs,
  56 distinct browser scenarios passed. The new phone check confirms the quantity
  editor appears above the cart, applies its quantity and cancels with Escape.
- Frontend lint, backend TypeScript and frontend production build passed. Existing bundle-size warnings
  remain.

Screenshot review covered light/dark dashboards, the all-zero collection state,
full sidebar names, the phone quantity editor, phone management screens and
the last inventory row at reduced laptop height. Relevant screenshots and run
logs are retained in `.local/review-findings` and `.local/finding-fixes-*.log`.

The browser checks use Chromium via installed Microsoft Edge. Promotions use
the existing automatic-promotion workflow. Card split tests record a fixture
external-terminal reference; they do not contact a payment provider. The scanner
test simulates a keyboard-wedge barcode scanner.

The local API was restarted with scheduled workers disabled. Frontend
`http://localhost:5173` and API health `http://localhost:5000/api/health` both
returned HTTP 200.

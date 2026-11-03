# UI refinement verification

This pass retains the existing routes, themes, Inter typography, dashboard greeting
and clock, checkout layout, backend contracts and financial calculations. Shared
selection/date controls use React Aria Components and `@internationalized/date`.

## Implemented controls

- Custom short-list selects and searchable long-list selectors, with selection
  indicators, keyboard navigation, validation and native form/ref compatibility.
- Month grid with year entry; date calendars with month/year navigation and direct
  entry; device-local date/time fields keep their original timestamp semantics.
- Report date ranges with store-calendar presets, Apply/Cancel and incomplete-range
  protection. Reporting periods remain separate from additional filter drafts.
- Draft additional filters, removable chips, shared menus/tooltips, mobile tab
  scrolling, quieter cards and aligned numeric table values.
- React Aria dialogs and popovers share stacking and focus handling. Dialog
  footers remain visible while the body scrolls. Approval dialogs retain priority.
  Focused fields scroll clear of the footer, including in WebKit at enlarged
  display sizes; inherited-disabled fieldsets stay out of the keyboard tab order.
- Product/supplier searches use cancelled scoped queries; store choices expose
  loading/retry states. Opening a control performs no business-data mutation.

## Route and dialog checklist

The guarded browser suite uses disposable stores and test users; it never resets
the operational database. The route matrix below maps each family to its checks.

| Area | Routes / nested views | Principal checks |
| --- | --- | --- |
| Dashboard | `/dashboard` | Greeting, clock, metrics, full laptop height |
| Products | `/inventory` | Catalog, filters, edit/import/receipt dialogs |
| Purchasing | Orders, suppliers, suggestions | Search, order creation, receiving, duplicate/recovery behavior |
| Stock Control | Transfers, counts, movements | Location selection, partial receipt, count drafts, date filters |
| Customers | Directory, insights, three account views | Search, visible insight tabs, account/payment dialogs |
| Promotions | `/promotions` | Editor, dirty drafts, permissions |
| Lottery | Daily, reports, ticket types | Report dates, operational form drafts, quiet updates |
| Financial | Expenses, budgets, recurring, P&L, inventory | Filters, form dates, month grid, accounting totals, exports |
| Reports | Overview, sales, inventory, staff, exports and their nested views | Navigation, period filters, pagination, empty/error states |
| Team & Time | Shifts, staff, payroll | Role permissions, payment inputs, recovery dialogs |
| Settings | Profile, store, payments, receipts, notifications, devices | Shared controls and retained settings workflows |
| Jobs/history | Jobs, audit log, reconciliation | Range validation, queued export recovery, live detail panels |
| Platform | Dashboard, stores, users, integrations, previews | Read-only store scope, permissions, responsive controls |
| Authentication / checkout | Login, reset, POS, customer display | Focus, larger checkout controls, assistant/approval priority |

`role-responsive-audit.spec.ts` covers owner, manager, cashier and platform roles
in both themes at desktop, tablet and phone sizes. `layout-views.spec.ts` covers
nested report, financial, settings, lottery and customer views.
`management-viewport.spec.ts` checks short laptop scrolling. `ui-controls.spec.ts`
checks open pickers at 1366×768, 390×844 and 683×384 (the CSS space available at
200% scaling of a 1366×768 screen), in Chromium, Firefox and WebKit.

## Verification record

- Frontend unit suite: 40 tests passed, including leap dates, month/year boundaries,
  store/device calendar differences, refresh suspension and retained export math.
- Frontend lint, TypeScript and production build passed. The build retains existing
  bundle-size and mixed dynamic/static import warnings.
- Full isolated browser run: 170 of 177 scenarios passed initially. Six outdated
  native-control locators and one disabled-fieldset focus issue were corrected;
  the affected scenarios passed in subsequent targeted runs (including a 49-case
  reporting, recovery, assistant and control run).
- Subsequent calendar/settings/lottery/inventory run: 32 of 33 passed. The
  remaining valuation date-boundary defect was fixed and both inventory browser
  cases passed on rerun. All 27 shared-control cases passed across Chromium,
  Firefox and WebKit, including a device/store date mismatch at New Year.
- Inventory costing and report-date backend regressions: 23 passed, including
  valuation under UTC, Chicago and Tokyo database sessions.
- Final dialog-focus, recovery and assistant regression run: all 42 scenarios
  passed, including all three browsers and both themes. Screenshot review
  confirmed focused date fields remain fully clear of the dialog footer.
- Native-control source audit: no visible browser-default select/date/month
  widgets remain. The searchable selector retains a hidden native select for
  form validation and ref compatibility.
- Local frontend and API health checks returned HTTP 200.

The date review exposed one existing valuation-query defect: implicit database
timezone conversion could omit late-evening inventory. Its read query now uses
the existing report date-boundary helper for both products and ledger entries.
This preserves the API/schema and costing formulas; no operational records were
changed by the verification work.

Representative screenshot review includes light/dark date-range popovers, the
month grid, searchable options and budget dialogs on laptop and phone layouts.
Automated reduced viewports cover layout at enlarged display scales; physical
mobile keyboards and assistive-technology announcements still benefit from a
device/screen-reader acceptance pass.

# POS visual redesign

The redesign changes frontend presentation. Store records, API contracts, inventory costing, financial calculations and workbook generation are unchanged.

## Shared presentation

- `Workspace.tsx`: `ManagementPage`, `DataPanel`, `SummaryStrip` and `FormSection` hold layout only. Queries, permissions, selections and drafts remain with their existing owners.
- `workspace.css`: tinted management canvas, working surfaces, compact summaries, form spacing and touch sizing. Keep the existing Inter font and theme colors.
- `PageHeader` and `PageTabs`: main navigation is transparent/bordered; secondary navigation is borderless below one separator. Style depends on navigation level, not the selected view.
- `Table`: `numeric` and `align` explicitly control monetary/quantity alignment. `scrollLabel` names an overflowing table region; `aria-label` supplies a fallback.
- Standard controls remain 36px on desktop and 44px on phones/touchscreens. Checkout controls keep their operational sizing.

## Screen patterns

| Area | Presentation |
| --- | --- |
| Products | One summary/search/filter/table/pagination surface; readable phone rows; real image thumbnails with an unavailable-image fallback. |
| Add/Edit Product | Identification, pricing/stock, sale settings and additional details; existing required SKU, barcode lookup and inventory rules retained. |
| Checkout | Image grid sized by available space; 440px laptop cart; text-only rows with quantity buttons and secondary action menus. Below 900px, a modal cart sheet replaces the second pane. |
| P&L | Explicit Month/YTD, four headline figures, missing-cost review status, grouped statement and neutral expenses. Uses the original report snapshot. |
| Dashboard/Admin | Compact figures, smaller empty chart states, additional platform metrics under disclosure. Dashboard greeting and clock placement retained. |
| Purchasing/Stock/Accounts/Team | Shared page frame and tables, record actions and existing workflow navigation. |
| Customers | Combined directory surface and responsive customer rows. |
| Lottery | Simplified Scratch/Online workflow retained; closing-number entry remains visible in responsive rack rows. |
| Reports | Compact supporting summaries, existing visible report views and filters. |
| Payroll/Settings | Compact rate rows, clear sections, stacked phone fields. |
| History/Jobs | Readable action labels, consistent tables/status summaries and contextual retry controls. |
| Authentication/Customer display | Matching surfaces with focused layouts and larger operational display text retained. |

The cart launcher remains mounted while its sheet is open so focus can return to it. Quantity entry uses the shared modal above the sheet. Date ranges scroll their calendar content independently of Apply/Cancel.

## Review matrix

Use only the disposable verification database with `node scripts/verify-pos.cjs browser ...`. Do not seed or mutate local store data for screenshots.

| Coverage | Regression |
| --- | --- |
| Owner, manager, cashier, platform; desktop/tablet/phone; both themes | `role-responsive-audit.spec.ts` |
| Report views, financial tabs, settings sections, lottery views, reconciliation, customer insights | `layout-views.spec.ts` |
| 1366×768 laptop scrolling and metrics | `management-viewport.spec.ts` |
| Laptop and 200% equivalent CSS viewport; primary tab consistency | `visual-redesign.spec.ts` |
| Products, dialogs, phone rows, filters, long identities/large values/unavailable images | `products-design.spec.ts` |
| Five-column catalog, six visible cart rows, text-only cart, receipt/refund | `compact-checkout.spec.ts` |
| Touch targets, nested quantity dialog, Escape and restored focus | `visual-redesign.spec.ts` |
| Calendars, selectors, keyboard, date boundaries, phone and 200% viewport in Chromium/Firefox/WebKit | `ui-controls.spec.ts` |
| Immediate click/scan, promotions, stock, age checks, approvals | `pos-checkout.spec.ts`, `review-findings.spec.ts` |
| Partial tender and transaction recovery | `progressive-payments.spec.ts` |
| Assistant priority, placement, navigation and authentication isolation | `global-assistant.spec.ts` |
| Loading failures, obsolete requests and refresh/draft safeguards | `inventory-read-safety.spec.ts`, `management-read-safety.spec.ts`, `lottery-auto-refresh.spec.ts` |
| Simplified rack, machine, rolls and lottery reporting | `lottery-workbench.spec.ts`, `lottery-guided-entry.spec.ts` |
| Financial/report navigation, workbook facts and settings | `reporting.spec.ts`, `estimated-pnl.spec.ts`, `settings.spec.ts`, frontend unit tests |

Screenshots and verification logs are retained under `.local/visual-redesign-review` and `.local/visual-redesign-*.log`. Visual review includes the open controls and forms, not just their closed states.

## Verification notes

- Frontend lint and production build pass. The build retains its existing large-bundle and stale browser-data warnings.
- All 47 frontend unit tests pass, including checkout/payment arithmetic, refresh safeguards, lottery drafts and the P&L workbook round-trip.
- The broad 108-case browser run passed 105 cases initially. Its two stale layout/text assertions were corrected, and the tablet case that timed out passed on its targeted rerun. The full reporting suite then passed all 8 cases, preserving unavailable historical profits, export facts and platform read-only access.
- Screenshot review covered the compact laptop checkout, Products and its open form, phone product cards, P&L, dashboard, payroll, platform dashboard, authentication, lottery rack/report screens and open calendars in both themes.
- Review also caught and corrected mobile cart focus restoration, a clipped date-range footer, phone dialog button sizing and result-count punctuation.
- The final 20-case polish run passed, including open controls in Chromium, Firefox and WebKit, phone dialog touch targets, long product content, nested cart focus and the populated customer display in both themes. Screenshots are in `.local/visual-redesign-review/polish`.
- Browser checks use disposable fixture stores. This pass does not write to the local business database.

## Boundaries

Product photos use each product's existing image. An expanded barcode catalog and automatic image retrieval remain separate work. No demonstration products or images are inserted into store data by this redesign.

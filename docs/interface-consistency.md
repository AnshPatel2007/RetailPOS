# POS interface consistency

The October 21, 2026 interface update follows one management-page structure:
title and right-aligned actions, workspace tabs, optional view tabs, filters,
then content. `PageHeader`, `PageTabs` and the workflow context share this frame.
Products, Purchasing, Stock Control, Customer Accounts, Team & Time, Financial
Management, Reports & Analysis, Settings and administration retain their URLs
and server permissions. Checkout and the customer display keep their dedicated
workspaces. Login retains its focused form.
The dashboard retains its personalized time-of-day greeting on the left, with
the date and live clock at the top right, using the store's calendar timezone.

## Controls and copy

Standard actions and mini tabs are 36px high on desktop, with 14px text and
16px icons; phones use 44px touch targets. Titles are 24px, section headings
18px, normal interface text 14px and secondary metadata 12px. Key amounts may
use larger text. Shared tables, cards, dialogs and filter sheets use consistent
spacing and focus styling. Page-level Add, Import, Scan, Print and Export actions
appear at the top right; row actions and form submissions remain with their
records and forms. Generic introductions and decorative title chips are omitted.

## Automatic reads

`useAutoRefresh` serializes active reads and coalesces invalidations. Scoped
queries revalidate on entry, filter changes, successful mutations, browser focus,
reconnection and a 30-second interval. Jobs and delivery panels use 10 seconds.
Cross-tab invalidation sends a version notification, never records or identifiers.

Hidden/offline pages and open edits/reviews pause background reads. Obsolete
requests are cancelled and their results cannot cross a session or store change.
Quiet failures retain previous data with a stale notice and Retry. Automatic
failures back off; explicit Retry is immediate unless the server supplies a
Retry-After delay. One-shot POST previews do not poll or replay automatically.
Transaction recovery and recount actions remain explicit. Opening register
recovery updates its offline catalog with reads, without replaying pending sales.

## Global assistant

One 48px launcher is mounted inside the router and outside page routes. Desktop
uses an anchored panel; phone uses a modal sheet. Transaction dialogs take
priority and print output excludes the launcher and panel. Checkout controls
marked with `data-assistant-avoid` reserve their space; the launcher docks above
them, and the panel stays within short viewports. Custom operational overlays
can use `data-assistant-priority` to suspend the assistant. The in-memory thread
survives normal navigation and clears on user, role, store or session changes.
The customer display uses a separate general-help scope.

- `POST /api/assistant/help`: public POS/sign-in guidance, no database tools.
- `POST /api/analytics/chat`: authenticated owner/manager analysis, using existing
  store-scoped read-only tools and POS guidance.
- Both validate bounded text-only input/history and a finite page-context name.
  Page contents, URL query parameters and credentials are not attached automatically.
- Each scope is limited to 20 submissions per five minutes. Provider requests have
  bounded timeouts and no automatic provider retries. Opening chat makes no request.
- The existing Anthropic provider requires a working server-side
  `ANTHROPIC_API_KEY`. Tests mock the provider; they do not establish live account,
  billing or model entitlement acceptance.

## Verification

Run from the repository root:

```powershell
npm.cmd --prefix frontend run lint
npm.cmd --prefix frontend run build
node --test frontend/tests/auto-refresh.test.cjs frontend/tests/checkout.test.cjs
node scripts/verify-pos.cjs backend src/__tests__/assistant.validation.test.ts src/__tests__/integration/assistant.workflow.test.ts src/__tests__/integration/analyticsIsolation.workflow.test.ts
node scripts/verify-pos.cjs browser
```

The browser suite uses isolated servers/databases and installed Edge. The role
audit covers all four roles at desktop, tablet and phone sizes in both themes.
The nested-view audit visits 34 report, finance, settings, lottery, reconciliation
and customer-analysis views at all six viewport/theme combinations. It checks
titles, navigation, action sizes, accessible control names and overflow; it does
not claim every mutation is independently exercised. Separate workflow cases
verify recovery, authorization, drafts, late responses, chatbot isolation,
keyboard behavior and downloads. Screenshots are in `frontend/test-results`.

October 21, 2026 validation:

- The complete browser run passed all **137 scenarios** in 19 minutes. A final
  nine-case assistant run passed after checkout docking, mobile focus restoration
  and sheet layering fixes. That follow-up adds three viewport cases, giving
  **140 distinct passing scenarios across the two runs**, not one 140-case run.
- All **33 frontend unit checks** passed, including 16 automatic-update checks.
  All **30 backend assistant/authorization checks** passed across three suites.
- Frontend lint, the production build, backend type checking and source whitespace
  validation passed. The local UI and API both returned HTTP 200.
- Screenshot review covered representative management pages and dialogs in both
  themes, plus the assistant at 1440px, 768px and 390px checkout widths with a
  700px window height. The final phone sheet covers the floating cart control;
  opening the cart or a transaction dialog suspends the assistant.
- The refreshed source inventory contains 51 page routes, 639 action definitions
  and 283 endpoint declarations. These counts do not mean every action has an
  independent mutation test.

Evidence logs are `.local/consistent-design-browser-final.log`,
`.local/consistent-design-assistant-final.log`, `.local/consistent-design-units.log`,
`.local/consistent-design-assistant-backend.log`, `.local/consistent-design-lint.log`,
`.local/consistent-design-build.log` and `.local/consistent-design-diff-check.log`.
Saved screenshots are in `.local/interface-review/full-suite` and
`.local/interface-review/assistant-final`; a new browser run replaces
`frontend/test-results`.

## Visual polish follow-up

The October 21 visual review adds the following refinements to the shared design:

- Phone headers keep their primary action visible and put additional simple
  actions in an accessible More actions menu. Tabs scroll horizontally on phones;
  secondary analysis tabs have a quieter selected state. The lower status rows in
  Purchasing orders and Stock Control transfers/counts use that same secondary
  style and divider beneath their primary navigation, before search and filters.
  Single-row page navigation also uses transparent inactive borders and a subtle
  selected state. Only headers with a second row emphasize the first row with
  solid primary styling; actual secondary rows retain their divider.
- Summary cards use compact two-column phone layouts, consistent metric weights
  and less prominent decorative icons. The dashboard retains its time-of-day
  greeting and the live date/time in the top-right header.
- Products lead with the product name and show the SKU as secondary text. Prices,
  balances and counts align for comparison. Long expense references truncate
  visually while retaining the full value in their title.
- Badges, empty states, sidebar footers, search widths and table actions share
  consistent spacing and emphasis. Job statuses use readable labels, with IDs and
  checksums behind Technical details.
- Dark surfaces and semantic text colors have clearer separation. Native date
  controls follow the theme. Chart labels use theme-aware colors and readable
  sizes; small currency values no longer round down to `$0k`.
- Checkout product images occupy less space and names can wrap to two lines.
  Payment, expense, budget and recurring-expense dialogs keep final actions in a
  fixed footer while their form contents scroll.
- Management scrolling areas use the full viewport, with end padding inside the
  scrollable content so the last records can clear the assistant. General
  help suggestions distinguish signed-in use from sign-in assistance.

These changes retain existing business rules, permissions and operational control
sizes. The mobile receipt-import workflow also verifies the new action menu's
Escape behavior and focus restoration.

Follow-up verification:

- The full 140-scenario browser run passed 137 cases. Two selectors still expected
  product names in cells without SKUs; those selectors were corrected. One platform
  desktop/dark case timed out during navigation. A nine-case focused rerun passed
  all three affected cases, inventory recovery and stale-response checks, financial
  editing/recovery/permissions, and manager desktop/dark layout checks. All **140
  distinct scenarios have passing evidence across the full run and rerun**; this
  was not a single clean 140-case run.
- All **33 frontend unit checks**, frontend lint and the production build passed.
  Backend assistant code was unchanged in this visual-polish follow-up.
- Screenshot review covered desktop and phone Products, both dashboard themes,
  report tab hierarchy and charts at desktop/tablet/phone widths, Financial
  Management, payment/expense/budget dialogs, and desktop/phone administration.
  The final category badge wraps within its cell without pushing expense actions
  outside the desktop table.
- Local UI `/` on port 5173 and API `/api/health` on port 5000 returned HTTP 200.
  The regenerated source inventory contains 51 page routes, 636 action definitions
  and 283 endpoint declarations.

Evidence: `.local/visual-polish-browser.log`, `.local/visual-polish-rerun.log`,
`.local/visual-polish-units.log`, `.local/visual-polish-lint.log` and
`.local/visual-polish-build.log`. Screenshots are preserved under
`.local/interface-review/visual-polish-full` and
`.local/interface-review/visual-polish-rerun`.

Laptop viewport correction: the outer 80px assistant margin shortened every
management page, reproducing a 570px content area in a 650px window. It is now
scrollable end padding instead, with duplicated page-bottom padding removed.
The content viewport reaches the window bottom and the last table records can
scroll above the launcher. Four regression cases cover owner/admin pages at
1366x650 and 1093x525. All four and the nine existing assistant cases passed;
frontend lint/build passed. Evidence: `.local/laptop-viewport-before.log`,
`.local/laptop-viewport-browser.log`, `.local/laptop-viewport-lint.log`, and
`.local/laptop-viewport-build.log`.

## Laptop readability and action feedback (2026-10-22)

- Metric cards adapt to their own available width: narrow cards hide decorative
  icons and use smaller metric text. Amounts can wrap instead of being clipped;
  dashboard totals no longer use ellipsis. The full-height page scroll remains.
- Shared tables use tighter column padding below desktop widths. When a table
  actually overflows, it shows a concise horizontal-scroll hint and exposes a
  keyboard-focusable, labelled scroll region. No nested vertical height limit is
  introduced. Pagination wraps on narrow screens.
- Expense descriptions lead each row, with the reference beneath in secondary
  text. Dates and amounts stay together, removing an unnecessary table column.
- Transfer/count statuses and movement types use readable labels. Their API
  values, filters and permissions are unchanged. Partial counts and empty
  transfers explain which selection is needed before continuing.
- Product forms keep actions and save errors in the fixed dialog footer, show
  saving progress, block duplicate submissions and dismissal during saving, and
  preserve drafts after a failed save. Barcode/photo controls share standard
  sizing and keyboard access; price fields stack on phones.

Verification: 27 distinct browser scenarios passed across the focused and final
runs. The first run passed 15 of 16; its remaining assertion expected the former
uppercase Closed label. After updating that assertion, the final 15-case run
passed, including transfer recovery, product save retry/duplicate protection,
keyboard table scrolling, 34 nested views in desktop light and phone dark, and
all four roles in both layouts. Six laptop viewport cases cover owner/platform
pages at 1366x650, 1093x525 and 911x433; reduced CSS viewports approximate enlarged
display space, rather than changing actual browser zoom.

All 33 frontend unit checks, lint and the production build passed. The build
retains existing dependency-data and chunking warnings. PowerShell captured
native warning output as NativeCommandError records; the build and browser
logs themselves show successful completion. Screenshot review covered laptop
metrics, the financial layout, phone tables, and product save errors in light
and dark themes. UI port 5173 and API health on port 5000 returned HTTP 200.

Evidence: `.local/usability-browser.log`, `.local/usability-final-browser.log`,
`.local/usability-lint.log`, `.local/usability-build.log`, and
`.local/usability-units.log`. Screenshots are preserved in
`.local/interface-review/usability-first` and
`.local/interface-review/usability-final`.

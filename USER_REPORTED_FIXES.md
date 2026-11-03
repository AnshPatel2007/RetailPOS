# User-reported POS fixes — 12 October 2026

The changes below are implemented in the local workspace. The frontend is served at http://localhost:5173 and the API at http://localhost:5000/api. The payroll/store-connections migration is applied to the local operational database; existing records were preserved. The later super-admin changes are documented in SUPER_ADMIN_UPDATES.md: payroll now belongs only to store admins, and store links are managed through each store row's Connections button.

## What changed

| Request | Result and where to try it |
| --- | --- |
| Quantity starts at 1 and typing 3 produces 13 | The first digit replaces the initial quantity. Later digits append: 3 then 2 becomes 32. Touch and keyboard input follow the same rule. Over-stock quantities show an error and cannot be confirmed. |
| Checkout suddenly reports a short payment | Online checkout requests current prices, promotions, and tax from the server before opening payment. Quote and completion use the same pricing function. The payment amount refreshes when the amount due changes. Completion checks the total the cashier confirmed and explicitly rejects a changed total before changing stock. |
| Automatic checkout tax | Settings → Store Information now exposes the store sales-tax percentage to admins. Checkout automatically applies that configured rate to taxable products; Inventory controls each product's taxable flag. Automatic address/category tax lookup is not connected. |
| Refund from a report fails validation | Reports → select sale → Refund opens the existing refund form with the sale loaded. It submits selected items or an amount, reason, restock choice, and refund method instead of an empty request. External card reversal remains an action on the separate terminal. See the remaining loyalty/refund accounting issues in FEATURE_AUDIT.md. |
| Hourly wages and payroll expenses | Payroll lets the admin set employee rates and choose weekly (Monday–Sunday) or calendar-month periods. Each new clock-in snapshots the wage, schedule, and store timezone. Clock-out records hours and gross earnings, split at period boundaries. The server posts completed periods to pending PAYROLL expenses automatically, checks every minute while running, and catches up at startup. Duplicate runs do not duplicate expenses. |
| Store-to-store inventory transfers | Super admin → Stores → Connected stores links stores, including stores whose owners use different emails. New Transfer fixes the source to the signed-in user's store and lists only its connected active destinations. Available products load with quantities. Creation and shipping reject quantities above current stock; concurrent or repeated shipments cannot deduct twice. Only the destination can receive, and receipt matches the destination product by SKU or creates it there. |
| Internal MISC product in inventory | MISC-001 is excluded from the catalog and product statistics. The register's Misc charge option and historical sale lines remain available. |
| Zero stock labeled low stock | Inventory labels tracked products with zero stock as Out of Stock. Positive quantities at or below their threshold are Low Stock. Catalog statistics separate those counts. |
| Review other unfinished or incorrect features | FEATURE_AUDIT.md records the additional code-review findings, their consequences, and implementation boundaries. |

## Setup for testing

1. Open http://localhost:5173 and reload any already-open register tab. The local admin login is `admin@pos.com` / `admin123`.
2. Open Payroll, set the employee's rate, then start a new shift. Rate changes apply to future clock-ins. Historical shifts without a captured rate are shown as excluded; no wage is invented for them.
3. Choose weekly or monthly payroll. A current period displays earnings but does not create its expense until the period ends and the relevant shifts have clocked out. Expenses start pending for review; this does not send money to an employee.
4. For transfers, create the second store and its owner account if needed, then connect the two stores using the super-admin account. This local database currently has one store, so zero destination choices is expected until a second store is linked. No demonstration stores were added to operational data.
5. Set the applicable store tax rate in Settings and each product's taxable status in Inventory before checking mixed taxable/exempt baskets.

Payroll currently calculates straight-time gross wages. It does not calculate overtime, unpaid breaks, paid leave, withholding, deductions, or bank payments. Existing shifts without wage snapshots need a separate reviewed backfill if historical payroll is required. Transfer receipt currently accepts the complete shipment; partial receipts need a separate discrepancy workflow.

## Tax approach

Commercial POS products support both owner-configured rates and tax services. Square supports manual or automatic configuration with location/item settings. Shopify POS uses the assigned store location, and Shopify Tax can use product categories for exemptions. This system currently implements a store percentage plus each product's taxable flag; it does not infer jurisdiction or special product rates. Sources: [Square tax settings](https://squareup.com/help/us/en/article/5061-create-and-manage-your-tax-settings), [Shopify POS tax settings](https://help.shopify.com/en/manual/taxes/set-adjust-pos-taxes).

The provider-backed design is in TAX_AUTOMATION_PLAN.md. It needs merchant/address setup, product tax classifications, provider configuration, and persisted historical tax details before automatic rate lookup can be enabled.

## Verification

- 108 backend unit tests passed.
- 148 backend integration tests across 15 suites passed against a fresh, isolated PostgreSQL test database. The 12 user-reported regression tests passed again after the final wage-privacy change.
- 6 frontend tests passed, including quantity-pad clicks and keyboard behavior.
- Frontend lint, backend TypeScript checking, frontend production build, and whitespace checks passed.
- Local HTTP checks passed for the frontend, Payroll and Transfers page routes, API health, admin login, payroll data, connected-transfer options, product catalog, and store settings. These confirm serving/API access, not visual browser interaction.
- No physical payment terminal, printer, cash drawer, real email delivery, or browser click-through was verified. Card/EBT processing and native device integrations are not connected.

The integration database was separate from the operational `pos_system` database and is removed after testing. Email delivery is mocked in campaign integration tests; the localhost daily-digest and birthday-email schedulers remain disabled. The payroll scheduler is enabled.

Earlier review work remains documented separately in POS_FIXES.md and POS_SYSTEM_REVIEW.md.

## Transfer creation after login — 13 October 2026

The login response returned the nested store object but omitted `user.locationId`. Immediately after login, the transfer page therefore treated an assigned admin/manager as having no store and hid New Transfer. The login response now includes that ID. The effective-location hook also accepts the nested ID from older sessions, while preserving explicit null assignments and super-admin read-only previews. Transfer detail actions use the same resolved store, and the empty list includes a New Transfer button.

Validated 17 authentication unit tests, 8 frontend tests, and 14 workflow integration tests, including real login followed immediately by transfer creation for ADMIN and MANAGER. Lint, backend TypeScript, the frontend production build, and live login/options/source-serving checks passed. Integration tests used a separate temporary database, removed after testing; no transfers or stock changes were made in operational data. Cashier transfer permissions were not changed.

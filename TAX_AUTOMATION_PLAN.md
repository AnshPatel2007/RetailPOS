# United States automatic store taxes

Status: implementation design; automatic tax is not implemented or enabled.

## Current behavior

- Location.taxRate is one manually entered percentage.
- Product.isTaxable is a boolean; no product tax classification is stored.
- The frontend displays flat-rate cart estimates. Online checkout now refreshes a server quote before payment, and quote/completion share the server pricing function. Completion checks the confirmed total.
- Offline sales also use the store percentage.
- SaleItem.tax stores the total tax without jurisdiction or rule details.

## Intended store onboarding

1. Super admin assigns the store to its legal merchant/company. Independent businesses must not share another merchant's tax registrations or provider company configuration.
2. Collect and validate the complete US street address, including state and postal code.
3. Select a configured tax provider and merchant/company mapping. Credentials stay server-side, outside public store settings responses.
4. Resolve the address and show provider validation results. Require correction or review when the provider cannot establish a sufficiently precise location.
5. Record applicable merchant collection/registration configuration and supported product coverage. Creating a POS location does not itself register a business with tax authorities.
6. Show an explicit state: pending configuration, needs address review, needs product classification, ready, or provider unavailable. Missing setup must never become an automatic zero-tax rate.

Existing stores retain explicit manual mode until migrated and reviewed. New automatic stores cannot silently fall back to their legacy flat percentage.

## Product classification

- Store the provider's product tax code with each product, with optional category defaults and an explicit product override.
- Product merchandising categories and tax classifications are separate concepts.
- Import the selected provider's current tax-code catalog; do not invent statutory classifications or hardcode nationwide exemptions.
- Classification suggestions require confirmation when ambiguous. Product names alone cannot safely establish taxability.
- Miscellaneous/open-price items require a tax classification before automatic checkout.
- Support customer exemption evidence and transaction-specific treatment rather than interpreting every exemption as a permanent product flag.

## Checkout and saved transactions

- Create a server-side tax quote from authorized store context, current product records, verified prices, quantities, discounts, fulfillment address, tender/exemption details, and transaction date.
- Return per-line and per-jurisdiction amounts to the cart, payment screen, customer display, and receipt.
- Bind the quote to the exact cart and store; invalidate it when relevant inputs change. Reject expired or mismatched quotes at payment.
- Keep provider calls outside long-running inventory database transactions. Revalidate quoted inputs before final sale persistence.
- Persist provider reference, product classification, taxable basis, jurisdiction breakdown, rounding results, and charged amounts with the sale.
- Coordinate provider recording, retries, duplicate requests, voids, and refunds using stable idempotency identifiers and explicit reconciliation state.
- Refund the originally charged tax for the refunded items; do not recalculate historical sales using today's rates.
- Handle discounts, inclusive/exclusive prices, surcharges, customer exemptions, tax holidays, and SNAP/EBT tender rules explicitly. The existing EBT and surcharge calculations need review before claiming coverage.
- Fail visibly on provider failure. Offline automatic checkout requires an explicit supported policy; existing offline flat-rate math is not an acceptable automatic fallback.

## Coverage boundary

Ordinary state/county/city/district sales and use tax calculation is the initial provider-backed capability. Fuel, alcohol, tobacco/vape, lodging, communications, and other specialized taxes or fees require confirmed provider capability, required product attributes, and potentially separate services. Never advertise universal coverage based on a sales-tax-only integration.

## Acceptance checks

- Multiple jurisdiction components on one item and mixed product taxability in one basket.
- Same product sold at different store addresses.
- Address changes invalidate prior setup/quotes.
- Missing classification, credentials, merchant configuration, or unresolved address blocks automatic checkout with an actionable message.
- Authorized exemptions and tender-specific treatment.
- Discounts, rounding, inclusive prices, quantities, and split payments agree between quote, payment, receipt, and saved sale.
- Refunds and voids preserve historical tax and avoid duplicate provider records.
- Provider timeout/outage, stale quote, offline mode, and retry/idempotency behavior.
- Store isolation across merchant accounts, credentials, data, and provider requests.
- Existing manual stores remain usable during migration.

## Decisions needed before provider integration

- Provider and available account/service coverage.
- Merchant/company ownership and onboarding arrangement for independent stores.
- Initial supported retail sectors and online/delivery scope.

No provider account creation, purchase, production activation, or tax registration is included in this design.

## References

- https://developers.taxjar.com/api/guides/
- https://developers.taxjar.com/integrations/sales-tax-calculations/
- https://developer.avalara.com/avatax/calculating-tax
- https://developer.avalara.com/avatax/address-validation
- https://developer.avalara.com/avalara-apis/

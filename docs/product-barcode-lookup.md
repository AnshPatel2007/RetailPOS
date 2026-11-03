# Product barcode autofill

In **Products → Add Product**, the Barcode field receives focus. Scan a UPC/EAN, paste it, or type it. A completed scan with Enter starts lookup immediately; ordinary entry waits briefly. Enter in the barcode field never submits the product form.

Available catalog details fill the name, description, matching existing category, and an eligible product image. A blank SKU receives the barcode as an editable store code; catalog services do not supply the store's internal SKU. Brand and package size are included in the name when supplied by the catalog. Prices, cost, stock, tax and EBT eligibility remain under store control. Age-restriction suggestions follow the separate rules below and remain visible for review before the product is saved.

Category matching uses the provider's category hierarchy and conservative category aliases, such as Soda, Soft Drinks and Beverages. It selects an existing category only when there is a clear match, including when the category list finishes loading after the lookup. Ambiguous matches remain for review. If the store has no suitable category, the form offers the suggested category through an explicit add-category action. Creating that category requires a deliberate action; scanning alone never creates one. Categories remain scoped to the current store.

Manual edits are preserved, including edits made while a lookup is pending. Changing the barcode clears generated identity fields and cancels the obsolete lookup; an existing age restriction is retained until the owner changes it. Closing the dialog or changing its store/session context invalidates pending results. Edit Product performs lookup only through the explicit Auto-fill action or scanner Enter, fills missing details, and offers catalog photo alternatives without replacing the saved image. Repeated lookup retains the open photo chooser.

If the barcode already exists in the current store, the form offers **Open existing product** and prevents duplicate creation. No product, category or stock movement is saved by lookup. Use Create Product after reviewing the completed draft.

## Product images

The image should identify the exact product and package being sold. Prefer a clear single-product catalog packshot on a plain white or transparent background. An image's presence in a lookup response does not establish its quality, correct package size, or transparency. A white-background JPEG is not a transparent cutout.

Retain the catalog's usable image candidates so an owner can choose another image when needed. Community-submitted photos are not automatically selected when they are the only available source. Missing or unsuitable images must not prevent product entry; the owner can review candidates or supply an image. Do not generate a product photograph, change packaging, or claim a background has been removed when it has not. Existing manually selected images must not be silently replaced by another lookup.

For the reported barcode `049000000443`, the manufacturer provides a visually reviewed [Coca-Cola Original 20 oz bottle image](https://www.coca-cola.com/content/dam/onexp/us/en/brands/coca-cola-original/en_coca-cola-original-taste-20-oz_750x750_v1.jpg) on a plain white background. Its [official product page](https://www.coca-cola.com/us/en/brands/coca-cola/products/original?redirect=true) identifies the 20 fl oz serving and links that image. The override is specific to a matching Coca-Cola 20 fl oz identity; it is not a generic image for other Coca-Cola barcodes. UPCitemdb's first image for this barcode was a 24-pack, demonstrating why provider ordering alone is insufficient.

## Age-restriction suggestions

For the current US store workflow, an unambiguous alcohol or tobacco/nicotine classification can suggest an age restriction of **21** in the product draft. Classification must use specific catalog categories and supporting product identity. Barcode digits, a brand name, and a provider's marketing `age_group` are not legal age rules. The broad category **Food, Beverages & Tobacco** is not evidence that a product contains tobacco; ordinary soda must not inherit an age restriction from that parent category.

Ambiguous, conflicting or missing classification needs owner review. An unknown result must not be represented as confirmation that the product is unrestricted, and lookup must never silently lower an existing restriction. Preserve deliberate form edits and existing product restrictions. Confirm the suggested setting against the actual product before saving. The existing checkout age checks continue to enforce the saved product setting; lookup itself does not verify a customer's age.

## Sources and coverage

The server checks the current store's catalog and supported external catalogs, including [Open Food Facts](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/) and [UPCitemdb](https://devs.upcitemdb.com/). A partial match can continue to another provider for missing details instead of stopping at the name. Supplementary results must identify the same GTIN. Existing identity values from the first match are preserved, and provider category hierarchies and attribution are retained. Image selection follows the policy above rather than preserving a poor first image. An incomplete current-store product can receive public suggestions without changing its stored name, identity or saved record.

Catalogs do not cover every product; descriptions, categories and images can be missing. This implementation does not preload every beer, liquor, tobacco or drink barcode, and does not guarantee an image for every item already in a store. Lookup occurs when requested during product entry; it does not bulk-rewrite existing inventory. Adding a provider can broaden coverage, but cannot establish complete coverage. Supplier/distributor feeds with appropriate usage rights are a future route to stronger coverage of a store's actual assortment.

When no written description is available, the service can provide a brief summary using only the returned name, package size and category. It never invents ingredients or product claims. The form identifies unavailable fields and distinguishes a limited catalog record from an unavailable enrichment provider. A verified partial match remains usable during provider failures, with retry and manual entry available.

## Provider configuration and limits

The POS limits its unkeyed UPCitemdb requests to 100 per day and spaces requests at least 10 seconds apart. These safeguards are shared by requests from the POS server, and provider retry delays are respected. A paid key can be configured in server-side `UPCITEMDB_API_KEY` for larger catalog onboarding; no purchase or subscription is performed by this feature. UPCitemdb states that free and paid accounts access the same database: payment increases request capacity, not product coverage. Its [published plans](https://devs.upcitemdb.com/) currently list DEV at $99/month with 20,000 lookups/day. Set `PRODUCT_CATALOG_USER_AGENT` with a support contact for deployment.

Barcode Lookup is an optional additional provider and requires an account key. Its [documented endpoint](https://www.barcodelookup.com/api-documentation) is `GET https://api.barcodelookup.com/v3/products?barcode=<GTIN>&key=<key>`. Keep the key on the server and out of logs. Returned `products[]` records include `barcode_number`, `title`, `brand`, `size`, `category`, `description` and `images`; only a matching GTIN may supplement the draft. HTTP 403 is an invalid key, 404 is no data, and 429 indicates a quota/rate limit. The documented maximum is 100 requests/minute; monthly quota is deducted only for successful HTTP 200 responses. The [Starter plan](https://www.barcodelookup.com/api) currently lists 5,000 calls/month at $99/month. A configured integration does not activate or purchase a subscription.

Provider access is not ownership of a permanent universal catalog. [Barcode Lookup's terms](https://www.barcodelookup.com/terms-and-conditions) require deleting supplied Product Data, including cached and backed-up copies, when the subscription terminates. They do not grant rights to third-party images or descriptions. [UPCitemdb's terms](https://www.upcitemdb.com/terms) also preserve third-party intellectual-property rights. Review the relevant permissions before bulk importing, redistributing, or retaining supplier/catalog assets. Do not scrape provider websites or activate paid access as part of this change.

Only public catalog suggestions are cached, in bounded process memory; current-store records are queried separately and never enter the public cache. Complete public matches are cached for 24 hours, ordinary partial matches and misses for 10 minutes, and retryable enrichment failures only until the suggested retry time. Barcode lookup sends only the barcode to catalog providers. Photo identification remains an explicit separate action using the existing AI provider.

Provider results are bounded and matched against the scanned GTIN, including equivalent zero-prefixed UPC/EAN representations. They supply identity and image suggestions, plus the separately derived age-restriction suggestion; provider prices and stock are not store values. External image suggestions must be HTTPS URLs. Catalog attribution is shown alongside the result. Timeouts, request limits, provider backoff, request coalescing and short-lived negative caching protect the lookup path.

Set `BARCODELOOKUP_API_KEY` on the server to configure the optional provider. It remains disabled when the key is empty. Local safeguards allow 60 requests/minute, `BARCODELOOKUP_DAILY_LIMIT` (default 250) per rolling day, and `BARCODELOOKUP_MONTHLY_LIMIT` (default 5,000) per rolling 31 days. These conservative counters include unsuccessful attempts and reset when the process restarts; they are not a substitute for provider-side billing limits. No subscription or key was activated during implementation.

## Verification

- `productCatalog.test.ts` and `productIdentify.test.ts`: input validation, GTIN matching, partial-result enrichment, image candidates and selection, optional-provider behavior, missing-field reporting, cache/backoff behavior, store isolation and role restrictions.
- Age rules: explicit alcohol/tobacco cases, broad parent categories, root beer/nonalcoholic products, conflicting or unknown metadata, and preservation of existing restrictions.
- `catalog-category.test.cjs`: hierarchy and alias matching, specificity, ambiguous categories and avoidance of product-name or arbitrary substring guesses.
- `product-barcode.spec.ts`: automatic filling, scanner Enter, edited fields, obsolete responses, dialog isolation, manual fallback, partial-result retries, category matching, image selection, age suggestions and duplicate-product recovery.
- `products-design.spec.ts`: desktop and phone form layout and existing product actions.

Tests use disposable fixture stores and mocked providers. The separate live catalog smoke check reads a public barcode without creating a product.

Verified on 2026-10-29: 128 backend tests, 59 frontend unit tests, 17 isolated Chromium browser regressions, frontend lint/build, and backend compilation passed. The browser checks cover photo choice persistence, community-only photos, automatic 21+ selection, uncertain classifications, owner edits, and the existing barcode/product-form workflows. A separate live public lookup of `049000000443` returned the matching Coca-Cola identity and reviewed manufacturer image; the image loaded successfully in Chromium. No product was saved during this live check. The commercial provider was tested with mocked responses because no paid key was activated.

The localhost API process must be restarted after server changes when it is running directly through `ts-node` without a development watcher. A frontend reload alone does not load updated server lookup behavior.

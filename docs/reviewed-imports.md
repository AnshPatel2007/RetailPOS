# Reviewed inventory imports

CSV and supplier-receipt imports use the same saved-preview workflow. Managers
and owners may import only into their assigned active store. Cashiers and
super-admin previews cannot apply imports.

1. Choose a CSV or review the scanned receipt suggestions.
2. Request a preview. This validates every row without changing any product.
3. Review the proposed field changes and previous/new stock.
4. Apply the saved preview. All product changes, inventory movements, supplier
   links and the applied result commit together.

CSV matches the exact SKU within the store. New products require a name and
retail price. Optional blank cells preserve existing fields. CSV stock is an
absolute quantity; receipt units are added to the existing quantity. New receipt
products require an explicitly entered SKU and retail price, with no invented
markup. A receipt SKU that already exists must be explicitly matched.

CSV accepts UTF-8/BOM, CRLF, quoted commas, escaped quotes and quoted newlines.
Limits are 1 MB and 500 product rows. Booleans use `true`/`false`. Invalid values,
duplicate identities, foreign categories/products, reserved MISC and stock
changes to untracked products block the preview with row-specific errors.

Previews expire after 15 minutes. A product or SKU/barcode change after review
requires a fresh preview. Applying an import locks products in a consistent
order and uses stock versions and the common inventory movement service. It
cannot overwrite a concurrent sale. The applied record is immutable.

The browser saves the preview ID before submitting. A lost response keeps
**Retry saved import** available after reload for that store, user and import
type. Retrying returns the original result even after preview expiry. Unavailable
browser storage blocks submission. Do not clear browser storage while an import
result remains uncertain.

The old `/products/apply-receipt` endpoint refuses unreviewed changes with 428.
Updated clients use `/products/imports/receipt/preview` and `/imports/:id/apply`.

Verification: backend tests cover row errors, ownership, supplier scoping,
concurrent retries, stale stock and immutable records. Browser tests cover CSV
lost-response recovery and receipt preview/application with real APIs. The OCR
provider response is stubbed in that browser test; live provider quality and
receipt product-search performance remain separate work. Light desktop CSV and
dark mobile receipt screens were visually inspected.

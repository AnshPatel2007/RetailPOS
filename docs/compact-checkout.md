# Compact checkout and receipt references

The sidebar uses a 24 px connection badge beside the POS brand, with the full store name immediately below it. The cart has a compact title/action row, 32 px desktop item controls, and 44 px phone targets. Customer linking remains in checkout. Recent transactions now appear inside Quick Refund, alongside typed and scanned receipt lookup.

The phone cart has a bounded height: items scroll independently of totals and Charge. On desktop, the assistant launcher sits beside the cart so it cannot obscure item prices or payment controls.

## Receipt and document numbers

New sales use `S-YYMMDD-NNNNNN`, for example `S-261025-100001`. The date follows the store timezone. The numeric suffix can be entered alone in Quick Refund, or the complete receipt reference can be scanned. Selecting a recent sale fetches current sale details before offering return quantities. Existing store and cashier access restrictions still apply.

New generated purchasing, invoice-import, expense, exchange, count and transfer references use `PO-`, `INV-`, `EXP-`, `EX-`, `CC-` and `TRF-` prefixes followed by the sequence. Supplier-provided invoice references are preserved.

A PostgreSQL sequence allocates unique numbers across stores and document types. Gaps are expected after cancellations or rolled-back transactions; reserved numbers are never reused. UUID record keys, URLs, historical document references and financial amounts are unchanged. Recurring/payroll expense deduplication uses a separate `referenceKey`, with compatibility lookup for old expense numbers.

Receipt previews and printed receipts include a Code 128 barcode for short references. Long legacy references retain QR codes. The human-readable reference remains available if code generation fails. Print styles support 58 mm and 80 mm paper.

## Migration and verification

Migration `20261025000000_document_numbers` is additive. A local database backup was taken before applying it; before/after fingerprints verified that existing business records were preserved. The backup manifest and verification are under `.local/backups/document-numbers-2026-10-25T15-18-51-580Z/`.

Regression coverage includes concurrent sequence allocation, rollback gaps, new/legacy lookup, store isolation, recurring/payroll compatibility, sale and inventory workflows, refunds, voids and offline recovery. Browser checks cover laptop density, phone checkout visibility, assistant overlap, recent/typed/scanned refunds and 58/80 mm print layout. Frontend lint, TypeScript/build and unit tests are part of verification.

Scanner checks simulate keyboard-wedge input. Physical scanner and thermal-printer verification still requires store hardware.

Final local verification on October 25, 2026: frontend lint/build passed; 42 frontend unit checks passed; the primary backend run passed 133 tests across 15 suites and the follow-up scheduler/compatibility run passed 18 tests across three suites. The final browser run passed all 17 compact-checkout, assistant and reported-issue checks. Earlier checkout, tender, loyalty, void and offline/terminal recovery regressions also passed. Screenshots are preserved in `.local/compact-review/`.

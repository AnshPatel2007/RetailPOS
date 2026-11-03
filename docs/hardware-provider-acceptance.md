# Register and pilot acceptance

The requested defaults are a USB HID keyboard scanner, an OS-supported receipt
printer and a tobacco/liquor pilot with grocery scenarios. Nelson Food & Liquor
and A&P Food and Liquor are configured locally with historical ledgers. A physical
pilot site has not been selected, and physical devices and a merchant account
have not been supplied. These defaults describe
the supported connection paths; they do not certify every scanner or printer.

| Area | Current application behavior | Physical acceptance still needed |
| --- | --- | --- |
| Scanner | Keyboard input into the POS barcode field | Configure Enter suffix; verify leading-zero UPC/EAN, rapid repeat scans, focus after payment and unknown-code feedback on the chosen scanner |
| Receipt printer | Browser print through the operating system driver and saved receipt settings | Print actual 58/80 mm paper, long names, discounts, tax, returns and a Z report; verify clipping, duplicate print, offline printer and cancellation |
| Cash drawer | Recorded drawer ledger and manual opening | Verify the selected printer/drawer combination; browser printing does not establish automatic drawer control |
| External card terminal | Record an already completed external payment/reference and reconcile uncertain outcomes; recording a refund does not send a terminal command | Verify authorization, declined payment, timeout after approval, duplicate submit, terminal reversal and settlement against a real provider |
| Restricted merchandise | Age-check and manager-review workflows | Verify store policy and local requirements for the actual tobacco/liquor assortment and staff training |
| Grocery | Cash, card records, split payment and original-tender returns; EBT remains blocked | Verify product eligibility and tax configuration before any SNAP integration is activated |

Clover is a candidate for the first integrated card/EBT provider. A claim that it
is the most-used processor has not been established. Its REST Pay Display setup
requires developer/test merchant setup, an OAuth application, device connection,
remote app ID, testing and production approval. These cannot be replaced by a
generic credential or a simulated authorization. See the
[Clover development checklist](https://docs.clover.com/dev/docs/rest-pay-development-basics).

Clover's EBT setup requires merchant FNS authorization, professionally enabled
production and sandbox entitlements, and a developer device. Applications must
check the actual tender returned by the device. SNAP refunds go back to the SNAP
balance; SNAP purchases have no sales tax and offline EBT is unsupported. The
staged calculator is not an active payment integration. See
[Clover's EBT setup and test guide](https://docs.clover.com/dev/docs/clover-support-for-ebt)
and [the refund policy](./refund-tender-policy.md).

Before a pilot, use a designated test store/account and complete opening cash,
restricted-item and grocery baskets, mixed tender/change, discounts, gift/store
credit, house accounts, partial returns, voids, lost-response recovery, offline
reconciliation, cash movements, payroll recording, close and provider settlement.
Compare receipts, product units, account liabilities, drawer count, signed reports
and settlement evidence. Record the store, device models/firmware, processor,
date, operator, observed failures and owner sign-off. Automated tests establish
software behavior only; physical and merchant acceptance remain pending.

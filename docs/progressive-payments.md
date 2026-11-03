# One payment screen

Checkout accepts successive payments in one Payment dialog. There are no Single Payment or Split Payment tabs. Cashiers choose a method, enter the amount, and record it. The dialog shows Total, Recorded, Remaining and a persistent unpaid-balance status. It only submits the sale when the full quoted total is covered. Cash overpayment produces change; non-cash payments cannot exceed the balance.

For a $100 sale, recording $20 cash leaves $80. Recording an actual $78.81 terminal approval leaves $1.19. The final $1.19 cash completes the sale. Existing card surcharges, loyalty, account permissions, age checks, receipt tenders and refund allocation still apply.

## Terminal research and integration boundary

Partial authorization depends on both processor support and the card issuer. A POS must use the returned approved amount and clearly display any unpaid remainder. Adyen documents `AllowPartialAuthorisation`, the `Partial` response and `AuthorizedAmount`: [Adyen partial authorizations](https://docs.adyen.com/point-of-sale/partial-authorizations).

Support is not interchangeable between providers. Stripe currently documents partial authorization for online card payments: [Stripe partial authorization](https://docs.stripe.com/payments/partial-authorization). Square describes separate terminal requests for successive tenders and partial authorization support: [Square Terminal overview](https://developer.squareup.com/docs/terminal-api/overview).

This POS currently records payments made on a separate terminal. The cashier enters the actual approved amount and terminal reference. The application does not send a card charge, inspect a card balance, or infer approval from insufficient funds. Automatic partial-approval handling requires a connected, supported terminal processor and its verified payment responses. Provider declines and timeouts must never be converted into assumed payments.

## Recovery and accounting

An IndexedDB `paymentSessions` table preserves unfinished payments, the original cart, cashier, store, drawer, customer, age verification and loyalty selection. It survives ordinary reload and logout on the same browser. Closing Payment saves the session; the register blocks a new cart until it is resolved. A revision check protects against stale writes from another browser tab. Browser storage must remain available; it is not a substitute for a server-side terminal settlement feed.

Before final submission, the original payload and idempotency key are saved. An uncertain submission retries that same sale. Separate terminal recovery and manager reconciliation also close the associated payment session. Offline cash completion moves into the existing durable offline queue. Unfinished sessions prevent local register-data clearing and drawer closure in this browser.

Partial entries do not book sales, COGS or stock depletion. Those occur together when the final sale is accepted. Gift-card and customer-account allocations are applied only on successful sale completion. Received cash requires return confirmation before removal. Removing a card payment requires a reference for a reversal already completed on the separate terminal; removing the entry never refunds a card by itself. Local session events retain these changes.

No store records are renumbered or recalculated by this change. The server keeps its existing underpayment and cash-change checks, caps a sale at 20 payment entries, and rejects duplicate terminal approval references within one sale.

## Verification

Frontend lint and production build passed. The targeted frontend unit run passed 23 tests; backend sale, drawer, offline-reconciliation and new successive-payment coverage passed 44 tests. Checkout, loyalty, terminal recovery, offline cash, receipt/refund, age verification and manager-approval browser regressions passed after updating the approval retry assertion for retained payments. The final six new payment scenarios passed, including the $20/$78.81/$1.19 example, cashier isolation, reversals, uncertain cash saves, concurrent windows, storage failure and rejected account allocation recovery. Desktop and phone screenshots are preserved under `.local/payment-review/`.

Browser tests use isolated fixture stores and simulated external approval references. No real card was charged and no physical terminal partial approval was tested. Local UI and API health checks returned HTTP 200 after the API restart.

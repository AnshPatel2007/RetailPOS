# Lottery daily entry

Updated October 27, 2026. The current interface has three sections: **Daily Entry**, **Reports**, and **Ticket Setup**.

## Equipment

Platform administration offers only **Lottery rack** or **Lottery machine**. Both include online lottery entry. There are no pilot-review checkboxes, barcode-verification forms or activation-evidence requirements in this workflow. Equipment changes take effect on the next unopened business day; open and historical days retain their source settings. Existing mixed-store records remain readable and usable without counting either source twice.

## Ticket Setup

The games table lists bin, lottery name, ticket range, price and active status. Each rack game needs a bin, official game number, ticket price, numbered range, counting direction, and a one-time starting number. Enter the actual ticket range; roll sizes are not assumed to be $300 or $600.

The starting number is used only when there is no prior saved closing. Later openings use the last closed entry for that game. Price and range snapshots in existing daily entries do not change when setup changes. Newly added games join an open simple-entry draft, with a new revision so another user's unfinished draft cannot silently overwrite them.

The interface has no physical-book register, book identities, stock-status controls or settlement tracking.

## Daily Entry

Only **Scratch sales** and **Online sales** appear below Daily Entry.

Rack entry has columns for bin, lottery name, opening number, closing number, tickets sold, ticket price, and total sales. Opening numbers are read-only. Cashiers type or scan the next unsold ticket in the closing field. A completed short number advances to the next row after a short input pause; an Enter-terminated scanner burst advances immediately. The input waits for the complete barcode rather than moving after its first three digits. Invalid numbers and mismatched games stay in the current row with an error.

A compact **New roll** action supports multiple replacements. For an ascending 000–059 roll, opening 055, two new rolls and closing 003 means 5 + 60 + 3 = 68 tickets. Descending ranges work in the opposite direction. **Last roll sold out** includes the final ticket. **Undo new roll** corrects an accidental replacement entry.

Machine stores enter sales and cancellations from the machine report. Dollar totals never manufacture ticket quantities.

Online sales records gross sales, cancellations, draw/FastPlay/scratch payouts, and optional supporting amounts. Commissions remain separate from sales and collections. Leaving required commission amounts blank keeps dependent profit totals pending; it does not record zero profit.

Save draft retains unfinished entries, and saved requests can be retried without duplicate posting. Managers and owners can close complete entries from Online sales. There is no review stage, cash-verification stage or settlement step. Owners can reopen the latest eligible day; existing historical correction and dependency protections remain.

## Reports and accounting

Reports contains the period summary and daily table only. Dates open their saved daily entries. CSV exports include daily activity and recorded earnings/corrections. Earlier records remain accessible.

Scratch face-value sales and prize payouts remain separate from merchandise revenue and COGS. Only recorded lottery earnings feed financial reports. Existing settlement postings and earlier records are preserved as history even though there is no settlement-management screen.

The backend retains store scoping, role checks, locks, optimistic revisions, idempotency receipts, immutable earnings postings and audit events. Simplifying the interface does not remove numeric validation or change previously posted financial records.

## Barcode support

The standard Illinois game–book–ticket inventory serial is accepted without a separate verification step. Short ticket numbers are accepted in the focused bin. Existing custom barcode profiles remain compatible. The game portion is checked against the focused row; unsupported codes are rejected instead of treating arbitrary trailing digits as a count.

- [Illinois game rules, game–book–ticket definition](https://mapp.illinoislottery.com/content/dam/il/games/instants/games-rules/IL-284%20%24250%2C000%20Crossword%20RRs-converted.pdf) document the three-digit game, six-digit book and three-digit ticket serial.
- [CStoreiQ barcode reference](https://help.cstoreiq.com/portal/en/kb/articles/reading-a-lottery-ticket-barcode) distinguishes inventory serials from retail-price and prize-validation codes. This interface also accepts four-digit game serials and compatible existing profiles.

The POS does not activate lottery tickets, validate prizes or communicate with the state terminal. Retailers continue those operations on their lottery equipment.

## Data and verification

The additive migration 20261027193000_lottery_rack_entry adds nullable bin/starting-number fields and a counting-direction default. Existing business columns and rows were verified unchanged across 76 tables. Backup: .local/backups/lottery-2026-10-27T19-34-04-251Z.

Daily rack snapshots are stored with the existing canonical store-day report. No synthetic physical-book records are created. Existing closed entries remain unchanged. Converting an open older entry preserves its existing counts and amounts.

Verification covers automatic focus advance, full barcode bursts, wrong-game input, carry-forward, descending counts, final tickets, multiple replacements, concurrent edits, retry recovery, permissions, historical data, P&L/Excel separation, and laptop/phone layouts in both themes. Relevant suites are the lottery backend workflow tests, financial/auth regressions, frontend lottery draft/input tests, and the lottery/reporting browser regressions.

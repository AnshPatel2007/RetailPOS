import type { LotteryRack, BarcodeProfile } from './lotteryWorkbench';
export const ticketWidth = (row: Pick<LotteryRack, 'lastTicket'>) => Math.max(3, String(row.lastTicket).length);
export const ticketLabel = (value: number | string | null, row: Pick<LotteryRack, 'lastTicket'>) => value === null ? '' : Number(value) < 0 ? 'Sold out' : String(value).padStart(ticketWidth(row), '0');
export function parseRackInput(raw: string, row: LotteryRack, profile?: BarcodeProfile | null): string {
  const value = raw.trim();
  let number: number;
  if (/^-?\d+$/.test(value) && value.length <= ticketWidth(row)) number = Number(value);
  else {
    const digits = value.replace(/[ -]/g, '');
    let game = '', ticket = '';
    if (profile && digits.length === profile.prefixDigits + profile.gameDigits + profile.bookDigits + profile.ticketDigits + profile.suffixDigits) {
      game = digits.slice(profile.prefixDigits, profile.prefixDigits + profile.gameDigits);
      ticket = digits.slice(profile.prefixDigits + profile.gameDigits + profile.bookDigits, profile.prefixDigits + profile.gameDigits + profile.bookDigits + profile.ticketDigits);
    } else if (/^\d{12,13}$/.test(digits)) {
      // Illinois game-book-ticket serial: 3 or 4 game digits, 6 book digits, 3 ticket digits.
      game = digits.slice(0, -9); ticket = digits.slice(-3);
    }
    if (!/^\d+$/.test(game) || !/^\d+$/.test(ticket)) throw new Error('Use the inventory barcode or type the closing number.');
    if (Number(game) !== Number(row.gameNumber)) throw new Error('This barcode belongs to another game. Check Bin ' + row.bin + '.');
    number = Number(ticket);
  }
  const position = row.direction === 'ASC' ? number - row.firstTicket : row.lastTicket - number;
  if (!Number.isInteger(number) || position < 0 || position > row.lastTicket - row.firstTicket + 1) throw new Error('Number is outside this game’s range.');
  const opening = row.direction === 'ASC' ? row.openingNumber - row.firstTicket : row.lastTicket - row.openingNumber;
  if (row.finishedRolls * (row.lastTicket - row.firstTicket + 1) + position - opening - row.lossQuantity < 0) throw new Error('Use New roll if the numbers restarted.');
  return number < 0 ? String(number) : String(number).padStart(ticketWidth(row), '0');
}
export function rackSold(row: LotteryRack): number | null {
  if (row.closingNumber === null || !/^-?\d{1,6}$/.test(row.closingNumber)) return null;
  try { parseRackInput(row.closingNumber, row); } catch { return null; }
  return row.finishedRolls * (row.lastTicket - row.firstTicket + 1) + (row.direction === 'ASC' ? Number(row.closingNumber) - row.openingNumber : row.openingNumber - Number(row.closingNumber)) - row.lossQuantity;
}

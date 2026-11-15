/**
 * Reading the barcode on the back of a US or Canadian driver's license or ID card
 * (PDF417, AAMVA format). A scanner types it as one long burst: a header such as
 * "@ ANSI 636014…", then one element per line: a three-letter code and its value
 * (DBB = date of birth, DBA = expiry, DCS = last name, DAC/DCT = first name).
 * Some scanners keep the line breaks, others drop them, so both are read. Unit
 * tested in tests/id-scan.test.cjs.
 */

export interface IdScan {
  birthDate: Date | null;
  expires: Date | null;
  firstName: string | null;
  lastName: string | null;
}

/** A real calendar date, or null (Feb 30 is not one). */
function calendarDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/**
 * Eight digits as a date: MMDDCCYY (US) or CCYYMMDD (Canada). A month is never
 * 19, 20 or 21, so the two forms cannot be confused.
 */
export function aamvaDate(digits: string): Date | null {
  if (!/^\d{8}$/.test(digits)) return null;
  const us = calendarDate(Number(digits.slice(4, 8)), Number(digits.slice(0, 2)), Number(digits.slice(2, 4)));
  if (us && us.getFullYear() >= 1900) return us;
  const canada = calendarDate(Number(digits.slice(0, 4)), Number(digits.slice(4, 6)), Number(digits.slice(6, 8)));
  return canada && canada.getFullYear() >= 1900 ? canada : null;
}

const ELEMENT = /^(D[A-Z]{2})(.*)$/;
const name = (value: string | undefined) => {
  const clean = value?.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  return clean && !/^(NONE|UNAVL)$/i.test(clean) ? clean : null;
};

/** Is this text an ID card's barcode (rather than a product's)? */
export const looksLikeIdBarcode = (raw: string) => /ANSI ?\d{6}|AAMVA/.test(raw) || /DBB\d{8}/.test(raw) || (/DAQ/.test(raw) && /DCS/.test(raw));

/** What the barcode says, or null when it is not an ID card's barcode. */
export function readIdBarcode(raw: string, today = new Date()): IdScan | null {
  if (!looksLikeIdBarcode(raw)) return null;
  const elements = new Map<string, string>();
  // Lines end with a line feed or carriage return; the header also holds a record separator (character 30).
  for (let line of raw.split(String.fromCharCode(30)).join('\n').split(/[\n\r]+/)) {
    line = line.trim();
    // The first element follows the subfile type ("DL" or "ID") on the same line.
    const subfile = line.match(/^(?:DL|ID)(D[A-Z]{2}.*)$/);
    if (subfile) line = subfile[1];
    const element = line.match(ELEMENT);
    if (element && !elements.has(element[1])) elements.set(element[1], element[2].trim());
  }
  // Line breaks dropped by the scanner: the dates can still be found by their codes.
  const date = (code: string) => aamvaDate((elements.get(code) ?? '').slice(0, 8)) ?? aamvaDate(raw.match(new RegExp(code + '(\\d{8})'))?.[1] ?? '');
  const birthDate = date('DBB');
  return {
    birthDate: birthDate && birthDate <= today ? birthDate : null,
    expires: date('DBA'),
    firstName: name(elements.get('DAC') ?? elements.get('DCT')?.split(/[ ,]/)[0]),
    lastName: name(elements.get('DCS')),
  };
}

/** Age in whole years on the given day. */
export function ageOn(birthDate: Date, today = new Date()): number {
  let age = today.getFullYear() - birthDate.getFullYear();
  if (today.getMonth() < birthDate.getMonth() || (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate())) age -= 1;
  return age;
}

/** The ID expired before today (it is still valid on its expiry date). */
export function isExpired(expires: Date | null, today = new Date()): boolean {
  if (!expires) return false;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return expires < start;
}

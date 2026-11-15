/**
 * Reading a US or Canadian driver's license or ID card from what a scanner types.
 * Scanners differ, so every common output is read:
 *
 * - The raw barcode (PDF417, AAMVA format), the usual default: a header such as
 *   "@ ANSI 636035…", then one element per line, a three-letter code and its value
 *   (DBB = date of birth, DBA = expiry, DCS = last name, DAC/DCT = first name; older
 *   cards: DAA = "LAST,FIRST,MIDDLE"). Line breaks may be kept, dropped, or typed out
 *   as "<LF>"; with Caps Lock on, a scanner types the letters in the wrong case.
 * - Fields the scanner read itself ("driver's license parsing") and typed with
 *   separators ($ ^ | , ; tab or line breaks), in any order, sometimes labeled
 *   ("DOB: 05/20/1995", "EXP …"). Only the dates are used (see readSeparatedFields).
 * - A magnetic stripe swipe: track 2 holds the expiry (YYMM) and the date of birth
 *   (CCYYMMDD) after "=".
 *
 * Dates may be MMDDCCYY (US), CCYYMMDD (Canada, older cards), MM/DD/YYYY or YYYY-MM-DD.
 * Unit tested in tests/id-scan.test.cjs.
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

/** The first date written with separators in the text: MM/DD/YYYY or YYYY-MM-DD (/ or -). */
function writtenDateIn(text: string): Date | null {
  const us = text.match(/(?:^|\D)(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?!\d)/);
  const usDate = us ? calendarDate(Number(us[3]), Number(us[1]), Number(us[2])) : null;
  if (usDate) return usDate;
  const iso = text.match(/(?:^|\D)(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?!\d)/);
  return iso ? calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3])) : null;
}

/** The first run of exactly eight digits in the text, read as a date. */
function digitsDateIn(text: string): Date | null {
  const run = text.match(/(?:^|\D)(\d{8})(?!\d)/);
  return run ? aamvaDate(run[1]) : null;
}

const ELEMENT = /^(D[A-Z]{2})(.*)$/;
const personName = (value: string | undefined) => {
  const clean = value?.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  return clean && !/^(NONE|UNAVL)$/.test(clean) ? clean : null;
};

/** Is this text a license barcode as printed (AAMVA), rather than a product's? Expects upper case. */
export const looksLikeIdBarcode = (text: string) => {
  const upper = text.toUpperCase();
  return /ANSI ?\d{6}|AAMVA/.test(upper) || /DBB(\d{8}|\d{1,2}[/-])/.test(upper) || (/DAQ/.test(upper) && /DCS/.test(upper));
};

/** The raw barcode: one element per line. */
function readAamva(text: string, today: Date): IdScan {
  const elements = new Map<string, string>();
  for (let line of text.split(/\n+/)) {
    line = line.trim();
    // The first element follows the subfile type ("DL" or "ID") on the same line.
    const subfile = line.match(/^(?:DL|ID)(D[A-Z]{2}.*)$/);
    if (subfile) line = subfile[1];
    const element = line.match(ELEMENT);
    if (element && !elements.has(element[1])) elements.set(element[1], element[2].trim());
  }
  // Line breaks dropped by the scanner: the dates can still be found by their codes.
  const date = (code: string) => {
    const value = elements.get(code);
    return (value ? writtenDateIn(value) ?? aamvaDate(value.slice(0, 8)) : null) ?? aamvaDate(text.match(new RegExp(code + '(\\d{8})'))?.[1] ?? '');
  };
  const birthDate = date('DBB');
  const fullName = elements.get('DAA')?.split(/[,$]/).map(part => part.trim());
  return {
    birthDate: birthDate && birthDate <= today ? birthDate : null,
    expires: date('DBA'),
    firstName: personName(elements.get('DAC') ?? elements.get('DCT')?.split(/[ ,]/)[0] ?? fullName?.[1]),
    lastName: personName(elements.get('DCS') ?? fullName?.[0]),
  };
}

type Label = 'birth' | 'expiry' | 'issue' | null;
const labelOf = (field: string): Label => /\b(DOB|BIRTH|BIRTHDATE|BORN|DBB|BD)\b/.test(field) ? 'birth'
  : /\b(EXP|EXPIRES?|EXPIRY|EXPIRATION|DBA)\b/.test(field) ? 'expiry' : /\b(ISS|ISSUED?|ISSUE|DBD)\b/.test(field) ? 'issue' : null;

/**
 * Fields the scanner read itself, typed with separators, e.g.
 * FIRST$MIDDLE$LAST$MM/DD/YYYY$STREET$$CITY$ST$ZIP$…$NUMBER. The order of the fields
 * differs between scanners, so only dates are used. A labeled date ("DOB …", "EXP …")
 * is taken as labeled; otherwise the earliest is the date of birth and a date still
 * ahead is the expiry (an unlabeled past date may be the issue date, so it is not taken
 * as an expiry). Without a birth label, it must look like a record (five fields or more).
 */
function readSeparatedFields(text: string, today: Date): IdScan | null {
  const fields = text.split(/[$^|,;\t\n]/).map(field => field.trim());
  const datesFrom = (find: (field: string) => Date | null) => fields.flatMap(field => {
    const date = find(field);
    return date && date.getFullYear() >= 1900 ? [{ date, label: labelOf(field) }] : [];
  });
  // Eight-digit dates only when no field writes a date with separators.
  let dates = datesFrom(writtenDateIn);
  if (!dates.length) dates = datesFrom(digitsDateIn);
  const labeledBirth = dates.find(entry => entry.label === 'birth' && entry.date <= today)?.date;
  if (!labeledBirth && fields.length < 5) return null;
  const unlabeled = dates.filter(entry => entry.label === null);
  const birthDate = labeledBirth ?? unlabeled.filter(entry => entry.date <= today).sort((a, b) => a.date.getTime() - b.date.getTime())[0]?.date;
  if (!birthDate) return null;
  const expires = dates.find(entry => entry.label === 'expiry')?.date
    ?? unlabeled.filter(entry => entry.date > today).sort((a, b) => b.date.getTime() - a.date.getTime())[0]?.date ?? null;
  return { birthDate, expires, firstName: null, lastName: null };
}

/** What the scan says, or null when it is not an ID card's barcode or stripe. */
export function readIdBarcode(raw: string, today = new Date()): IdScan | null {
  // One spelling for every scanner: upper case (Caps Lock inverts it), real line breaks.
  const text = raw.toUpperCase()
    .replace(/<(CR|LF|CRLF|RS|GS|FS)>|\[(CR|LF|CRLF|RS|GS|FS)\]/g, '\n')
    .split(String.fromCharCode(30)).join('\n')
    .replace(/\r\n?/g, '\n');
  if (looksLikeIdBarcode(text)) return readAamva(text, today);
  // A magnetic stripe: track 2 is ";<card number>=<YYMM expiry><CCYYMMDD birth>".
  const track = text.match(/;\d{6,19}=\d{4}(\d{8})/);
  const swiped = track ? aamvaDate(track[1]) : null;
  if (swiped && swiped <= today) return { birthDate: swiped, expires: null, firstName: null, lastName: null };
  return readSeparatedFields(text, today);
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

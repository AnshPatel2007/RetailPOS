/**
 * Reading a US or Canadian driver's license or ID card from what a scanner types.
 * Scanners differ, so every common output is read:
 *
 * - The raw barcode (PDF417, AAMVA format), the usual default: a header such as
 *   "@ ANSI 636035…", then one element per line, a three-letter code and its value
 *   (DBB = date of birth, DBA = expiry, DCS = last name, DAC/DCT = first name,
 *   DAD = middle name, DAI = city, DAJ = state; older cards: DAA = "LAST,FIRST,MIDDLE").
 *   Line breaks may be kept, dropped, or typed out as "<LF>"; with Caps Lock on, a
 *   scanner types the letters in the wrong case.
 * - Fields the scanner read itself ("driver's license parsing") and typed with
 *   separators ($ ^ | , ; tab or line breaks), in any order, sometimes labeled
 *   ("DOB: 05/20/1995", "EXP …", "CITY …"). See readSeparatedFields.
 * - A magnetic stripe swipe: track 1 holds the state, city and name; track 2 the
 *   expiry (YYMM) and the date of birth (CCYYMMDD) after "=".
 *
 * Dates may be MMDDCCYY (US), CCYYMMDD (Canada, older cards), MM/DD/YYYY or YYYY-MM-DD.
 * The name, city and state are shown to the cashier to compare with the card and the
 * customer; they are never stored. Unit tested in tests/id-scan.test.cjs.
 */

export interface IdScan {
  birthDate: Date | null;
  expires: Date | null;
  /** As printed on the card: first, middle, last (a scanner's own layout keeps its order). */
  name: string | null;
  city: string | null;
  state: string | null;
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

/** US states and territories, and Canadian provinces: what a card's state field holds. */
const REGIONS = new Set(('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK '
  + 'OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR GU VI AS MP AB BC MB NB NL NS NT NU ON PE QC SK YT').split(' '));
const POSTAL = /^(\d{5}(-?\d{4})?|[A-Z]\d[A-Z] ?\d[A-Z]\d)$/;
const WORDS = /^[A-Z][A-Z .'-]*$/;

const clean = (value: string | undefined | null) => {
  const text = value?.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  return text && !/^(NONE|UNAVL|UNKNOWN|N\/A)$/.test(text) ? text : null;
};
const joinName = (...parts: (string | null | undefined)[]) => clean(parts.map(clean).filter(Boolean).join(' '));

/** Is this text a license barcode as printed (AAMVA), rather than a product's? */
export const looksLikeIdBarcode = (text: string) => {
  const upper = text.toUpperCase();
  return /ANSI ?\d{6}|AAMVA/.test(upper) || /DBB(\d{8}|\d{1,2}[/-])/.test(upper) || (/DAQ/.test(upper) && /DCS/.test(upper));
};

const ELEMENT = /^(D[A-Z]{2})(.*)$/;

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
  // Older cards: DAA = "LAST,FIRST,MIDDLE"; DCT = given names ("FIRST,MIDDLE").
  const full = elements.get('DAA')?.split(/[,$]/).map(part => part.trim());
  const given = elements.get('DAC') ? joinName(elements.get('DAC'), elements.get('DAD')) : joinName(elements.get('DCT')) ?? joinName(...(full?.slice(1) ?? []));
  return {
    birthDate: birthDate && birthDate <= today ? birthDate : null,
    expires: date('DBA'),
    name: joinName(given, elements.get('DCS') ?? full?.[0]),
    city: clean(elements.get('DAI')),
    state: clean(elements.get('DAJ')),
  };
}

type Label = 'birth' | 'expiry' | 'issue' | null;
const labelOf = (field: string): Label => /\b(DOB|BIRTH|BIRTHDATE|BORN|DBB|BD)\b/.test(field) ? 'birth'
  : /\b(EXP|EXPIRES?|EXPIRY|EXPIRATION|DBA)\b/.test(field) ? 'expiry' : /\b(ISS|ISSUED?|ISSUE|DBD)\b/.test(field) ? 'issue' : null;
const labeled = (fields: string[], label: RegExp) => {
  for (const field of fields) {
    const match = field.match(label);
    if (match) return clean(match[1]);
  }
  return null;
};

/**
 * Fields the scanner read itself, typed with separators, e.g.
 * FIRST$MIDDLE$LAST$MM/DD/YYYY$STREET$$CITY$ST$ZIP$…$NUMBER. The order differs between
 * scanners. A labeled field ("DOB …", "EXP …", "NAME …", "CITY …") is taken as labeled.
 * Otherwise: the earliest date is the date of birth, a date still ahead is the expiry (an
 * unlabeled past date may be the issue date, so it is not taken as an expiry), the words
 * before the birth date are the name, and a state code (followed by a ZIP, or after the
 * birth date) has the city before it. Without a birth label it must look like a record
 * (five fields or more).
 */
function readSeparatedFields(text: string, today: Date): IdScan | null {
  const fields = text.split(/[$^|,;\t\n]/).map(field => field.trim());
  const datesFrom = (find: (field: string) => Date | null) => fields.flatMap((field, index) => {
    const date = find(field);
    return date && date.getFullYear() >= 1900 ? [{ date, index, label: labelOf(field) }] : [];
  });
  // Eight-digit dates only when no field writes a date with separators.
  let dates = datesFrom(writtenDateIn);
  if (!dates.length) dates = datesFrom(digitsDateIn);
  const labeledBirth = dates.find(entry => entry.label === 'birth' && entry.date <= today);
  if (!labeledBirth && fields.length < 5) return null;
  const unlabeled = dates.filter(entry => entry.label === null);
  const birth = labeledBirth ?? unlabeled.filter(entry => entry.date <= today).sort((a, b) => a.date.getTime() - b.date.getTime())[0];
  if (!birth) return null;
  const expires = dates.find(entry => entry.label === 'expiry')?.date
    ?? unlabeled.filter(entry => entry.date > today).sort((a, b) => b.date.getTime() - a.date.getTime())[0]?.date ?? null;

  const name = labeled(fields, /^(?:FULL )?NAME\s*:?\s*(.+)$/)
    ?? joinName(...fields.slice(0, birth.index).filter(field => WORDS.test(field) && !REGIONS.has(field)).slice(-4));
  let city = labeled(fields, /^CITY\s*:?\s*(.+)$/);
  let state = labeled(fields, /^(?:STATE|ST)\s*:?\s*([A-Z]{2})$/);
  if (!city || !state) {
    const isRegion = (index: number) => REGIONS.has(fields[index]) && index > 0 && WORDS.test(fields[index - 1]);
    const withPostal = fields.findIndex((_field, index) => isRegion(index) && POSTAL.test(fields[index + 1] ?? ''));
    const afterBirth = fields.findIndex((_field, index) => index > birth.index && isRegion(index));
    const at = withPostal >= 0 ? withPostal : afterBirth;
    if (at > 0) { city = city ?? clean(fields[at - 1]); state = state ?? fields[at]; }
  }
  return { birthDate: birth.date, expires, name, city, state };
}

/** A magnetic stripe swipe: "%<state><city>^<LAST>$<FIRST>$<MIDDLE>^…?;<number>=<YYMM><CCYYMMDD>…". */
function readStripe(text: string, today: Date): IdScan | null {
  const track = text.match(/;\d{6,19}=\d{4}(\d{8})/);
  const birthDate = track ? aamvaDate(track[1]) : null;
  if (!birthDate || birthDate > today) return null;
  const first = text.match(/%([A-Z]{2})([^^]*)\^([^^]*)\^/);
  const [last, ...given] = (first?.[3] ?? '').split('$');
  return { birthDate, expires: null, name: first ? joinName(...given, last) : null, city: clean(first?.[2]), state: first?.[1] ?? null };
}

/** What the scan says, or null when it is not an ID card's barcode or stripe. */
export function readIdBarcode(raw: string, today = new Date()): IdScan | null {
  // One spelling for every scanner: upper case (Caps Lock inverts it), real line breaks.
  const text = raw.toUpperCase()
    .replace(/<(CR|LF|CRLF|RS|GS|FS)>|\[(CR|LF|CRLF|RS|GS|FS)\]/g, '\n')
    .split(String.fromCharCode(30)).join('\n')
    .replace(/\r\n?/g, '\n');
  if (looksLikeIdBarcode(text)) return readAamva(text, today);
  return readStripe(text, today) ?? readSeparatedFields(text, today);
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

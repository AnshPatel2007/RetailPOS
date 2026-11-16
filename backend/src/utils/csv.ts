/**
 * One CSV cell, always quoted. Text a spreadsheet would run as a formula (it starts
 * with = + @ - or a tab) gets a leading apostrophe; numbers are written as they are.
 */
export const csvCell = (value: unknown): string => {
  let content = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === 'string' && /^[=+@\-\t\r]/.test(content)) content = "'" + content;
  return '"' + content.replace(/"/g, '""') + '"';
};

/** A money amount with its cents. A minus sign here is a number, never a formula. */
export const csvMoney = (amount: number): string => '"' + (Math.round((amount + Number.EPSILON) * 100) / 100).toFixed(2) + '"';

/** One line of already-built cells, ending as spreadsheets expect. */
export const csvLine = (cells: string[]): string => cells.join(',') + '\r\n';

import { reportCalendar } from '../services/reportDates.service';

/** Globally unique across stores and simultaneous registers; no count/read race. */
export const generateSaleNumber = (now: Date, timezone: string, sequence: bigint): string => {
  if (sequence <= 0n) throw new Error('A reserved document number is required');
  const { year, month, dayOfMonth } = reportCalendar(timezone, now);
  const date = `${String(year).slice(-2)}${String(month).padStart(2, '0')}${String(dayOfMonth).padStart(2, '0')}`;
  return `S-${date}-${sequence}`;
};

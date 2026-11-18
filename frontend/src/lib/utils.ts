import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Utility for merging Tailwind classes
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Display enum labels without exposing storage-style identifiers. */
export function formatEnumLabel(value: string): string {
  if (['EBT', 'SKU', 'CSV', 'PDF', 'POS', 'ATM', 'API'].includes(value)) return value;
  return value.toLowerCase().split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/**
 * Format currency
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

/** Preserve small dollar values while keeping large chart ticks compact. */
export function formatChartCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', notation: Math.abs(amount) >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: Math.abs(amount) < 1 && amount !== 0 ? 2 : 1,
  }).format(amount);
}

const validDate = (value: string | number | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** "Nov 4, 2026" — the one date format shown everywhere. A missing date reads "—". */
export function formatDate(date: string | number | Date, timeZone?: string): string {
  const value = validDate(date);
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', ...(timeZone ? { timeZone } : {}) }).format(value);
}

/** "Nov 4, 2026, 2:11 PM" — the one date-and-time format shown everywhere. */
export function formatDateTime(date: string | number | Date, timeZone?: string): string {
  const value = validDate(date);
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) }).format(value);
}

/**
 * Format time
 */
export function formatTime(date: string | number | Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(date));
}

/**
 * Truncate text
 */
export function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  return text.substring(0, length) + '...';
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Generate barcode (simple implementation)
 */
export function generateBarcode(): string {
  return Math.random().toString().slice(2, 15);
}

/**
 * Calculate percentage
 */
export function calculatePercentage(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((value / total) * 100 * 100) / 100;
}

/**
 * Sleep function for delays
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Categorical palette for chart fills (Recharts cells, bars, pies).
 * Hex is allowed inside charts only — everywhere else use semantic tokens.
 */
export const CHART_COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f97316', // orange
  '#84cc16', // lime
];

/**
 * Escape a value for a CSV cell: wrap in quotes, double inner quotes.
 * Text that could be interpreted as a spreadsheet formula gets an apostrophe.
 * CSV quoting alone does not prevent formulas. Numeric negatives stay numeric.
 */
export function escapeCsvValue(value: unknown): string {
  let str = value === null || value === undefined ? '' : String(value);
  if (typeof value === 'string' && (/^\s*[=+@-]/.test(str) || /^[\t\r\n]/.test(str))) str = "'" + str;
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Build a CSV string from a header row and data rows, escaping every cell.
 */
export function buildCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows]
    .map((row) => row.map(escapeCsvValue).join(','))
    .join('\n');
}

/**
 * Trigger a browser download of a CSV string.
 */
export function downloadCsv(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

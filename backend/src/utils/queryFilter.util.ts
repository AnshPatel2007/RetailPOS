/**
 * Query Filter Utility
 * Helpers for turning query-string values into Prisma where-clause filters
 */

/**
 * Parses a query value that may contain comma-separated values into a Prisma
 * filter: a single value stays a plain equality match, multiple values become
 * an { in: [...] } filter.
 * @param value - Raw query value (e.g. "COMPLETED" or "COMPLETED,VOIDED")
 * @returns Prisma-compatible filter, or undefined when the value is empty
 */
export function parseListFilter(value?: unknown): string | { in: string[] } | undefined {
  if (!value || typeof value !== 'string') {
    return undefined;
  }

  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return undefined;
  }

  return parts.length === 1 ? parts[0] : { in: parts };
}

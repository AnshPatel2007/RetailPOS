export const isSaleReference = (value: string) => /^(?:S-\d{6}-\d{6,19}|SALE-\d{8}-(?:\d{4}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))$/i.test(value.trim());

export function normalizeSaleReference(value: string) {
  const reference = value.trim().replace(/^#/, '');
  if (/^S-\d{6}-\d{6,19}$/i.test(reference)) return reference.toUpperCase();
  if (/^SALE-/i.test(reference)) return 'SALE-' + reference.slice(5).toLowerCase();
  return reference;
}

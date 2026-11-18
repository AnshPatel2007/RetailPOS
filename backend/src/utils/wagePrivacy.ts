const privateKeys = new Set(['hourlyRate', 'grossPay', 'payrollEntries', 'payrollFrequency', 'payrollTimezone']);

/** Defense in depth for nested user/shift snapshots in operational responses. */
export function omitWageDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitWageDetails);
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value;
  const entries = Object.fromEntries(Object.entries(value).filter(([key]) => !privateKeys.has(key)).map(([key, item]) => [key, omitWageDetails(item)]));
  // Cashiers/managers still need the cash movement to reconcile their drawer.
  // Its payroll source, employee reference and explanation remain owner-only.
  if (entries.type === 'PAYROLL') {
    entries.type = 'CASH_PAYOUT';
    entries.sourceKey = null;
    entries.reference = null;
    entries.notes = 'Cash payout';
  }
  return entries;
}

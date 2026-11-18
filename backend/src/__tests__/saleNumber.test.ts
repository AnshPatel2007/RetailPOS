import { generateSaleNumber } from '../utils/saleNumber';

it.each([
  ['2026-10-24T04:59:59Z', '20261023'],
  ['2026-10-24T05:00:01Z', '20261024'],
  ['2026-01-01T05:59:59Z', '20251231'],
  ['2026-01-01T06:00:01Z', '20260101'],
  ['2026-11-01T06:30:00Z', '20261101'],
  ['2026-11-01T07:30:00Z', '20261101'],
])('uses the Chicago sale date for %s', (timestamp, date) => {
  expect(generateSaleNumber(new Date(timestamp), 'America/Chicago', 100001n)).toBe(`S-${date.slice(2)}-100001`);
});

it('uses the specified store instead of the server timezone', () => {
  const at = new Date('2026-10-24T04:59:59Z');
  expect(generateSaleNumber(at, 'Asia/Tokyo', 100002n)).toBe('S-261024-100002');
  expect(generateSaleNumber(at, 'America/Chicago', 100003n)).toBe('S-261023-100003');
  expect(() => generateSaleNumber(at, 'Invalid/Zone', 100004n)).toThrow();
  expect(() => generateSaleNumber(at, 'America/Chicago', 0n)).toThrow();
});

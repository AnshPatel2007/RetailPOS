/**
 * Alerts the owners get the moment something happens (services/storeAlert.service.ts):
 * a refund or void of at least the owner's amount (Settings > Notifications, $50 unless
 * changed), and a drawer that closes off by at least theirs ($5). One plain sentence each,
 * from the recorded figures. Called after the response; never fails the request.
 */
import prisma from '../config/database';
import { raiseStoreAlert, storeAlertSettings } from './storeAlert.service';

const usd = (amount: number) => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const firstName = async (userId: string) => (await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true } }))?.firstName || 'Someone';
const how: Record<string, string> = { CASH: ' in cash', CARD: ' to a card', STORE_CREDIT: ' as store credit', GIFT_CARD: ' to a gift card', HOUSE_ACCOUNT: ' off a house account' };
const SALES_PAGE = '/insights/reports/sales';

/** One refund of at least the owner's amount. */
export async function alertRefund(locationId: string | null, userId: string, refund: { id: string; amount: number; method: string | null; saleNumber: string }) {
  if (!locationId) return;
  const { refundAlertOver } = await storeAlertSettings(locationId);
  if (refundAlertOver === null || refund.amount < refundAlertOver) return;
  await raiseStoreAlert(locationId, { key: 'refund:' + refund.id, kind: 'REFUND', severity: 'medium', href: SALES_PAGE,
    sentence: `${await firstName(userId)} refunded ${usd(refund.amount)}${how[refund.method ?? ''] ?? ''} on sale ${refund.saleNumber}.` });
}

/** One void of a sale of at least the owner's amount. */
export async function alertVoid(locationId: string | null, userId: string, sale: { id: string; total: number; saleNumber: string; cashReturned: number }) {
  if (!locationId) return;
  const { refundAlertOver } = await storeAlertSettings(locationId);
  if (refundAlertOver === null || sale.total < refundAlertOver) return;
  await raiseStoreAlert(locationId, { key: 'void:' + sale.id, kind: 'VOID', severity: 'medium', href: SALES_PAGE,
    sentence: `${await firstName(userId)} voided sale ${sale.saleNumber} (${usd(sale.total)}${sale.cashReturned > 0 ? ', paid in cash' : ''}).` });
}

/** A batch of refunds or voids whose total reaches the owner's amount: one alert for the batch. */
export async function alertBatch(locationId: string | null, userId: string, batch: { key: string; kind: 'REFUND' | 'VOID'; count: number; total: number }) {
  if (!locationId || !batch.count) return;
  const { refundAlertOver } = await storeAlertSettings(locationId);
  if (refundAlertOver === null || batch.total < refundAlertOver) return;
  await raiseStoreAlert(locationId, { key: batch.key, kind: batch.kind, severity: 'medium', href: SALES_PAGE,
    sentence: `${await firstName(userId)} ${batch.kind === 'REFUND' ? 'refunded' : 'voided'} ${batch.count} ${batch.count === 1 ? 'sale' : 'sales'} totaling ${usd(batch.total)}.` });
}

/** A drawer that closed off by at least the owner's amount; $20 or more is urgent. */
export async function alertDrawer(shift: { id: string; locationId: string | null; cashDifference: unknown; user: { firstName: string } }) {
  const difference = shift.cashDifference === null || shift.cashDifference === undefined ? null : Number(shift.cashDifference);
  if (!shift.locationId || difference === null || !Number.isFinite(difference)) return;
  const { drawerAlertOver } = await storeAlertSettings(shift.locationId);
  if (drawerAlertOver === null || Math.abs(difference) < drawerAlertOver || difference === 0) return;
  await raiseStoreAlert(shift.locationId, { key: 'drawer:' + shift.id, kind: 'DRAWER', severity: Math.abs(difference) >= 20 ? 'high' : 'medium', href: '/team-time/shifts',
    sentence: `${shift.user.firstName}'s drawer closed ${usd(Math.abs(difference))} ${difference < 0 ? 'short' : 'over'}.` });
}

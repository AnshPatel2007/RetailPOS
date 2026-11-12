const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const target = new URL(process.env.DATABASE_URL_E2E || process.env.DATABASE_URL);
if (!process.env.DATABASE_URL_E2E) target.pathname += '_e2e';
process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../tsconfig.json');
require('ts-node/register');
const { assertDisposableDatabase } = require('../src/utils/testDatabase');
assertDisposableDatabase(target.toString(), process.env.DATABASE_URL);
if (!target.pathname.endsWith('_e2e')) throw new Error('Browser fixtures require a database ending in _e2e');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient({ datasources: { db: { url: target.toString() } } });
(async () => {
  const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations'`;
  if (!tables.length) throw new Error('Deploy migrations to the disposable browser database first');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map(t => '"' + t.tablename.replaceAll('"', '""') + '"').join(', ')} RESTART IDENTITY CASCADE`);
  const stores = [];
  for (const name of ['Store A', 'Store B', 'Store C', 'Empty Store']) stores.push(await prisma.location.create({ data: { name, address: 'Test address', city: 'Test', state: 'IL', zipCode: '60000', phone: '555', email: name.replaceAll(' ', '') + '@example.test', timezone: 'America/Chicago', taxRate: 10 } }));
  const password = await bcrypt.hash('BrowserTest123!', 10);
  const bulkStore = await prisma.location.create({ data: { name: 'Bulk Void Store', address: 'Test address', city: 'Test', state: 'IL', zipCode: '60000', phone: '555', email: 'bulk@example.test', timezone: 'America/Chicago', taxRate: 10 } });
  for (const email of ['bulk-voids@example.test', 'bulk-other@example.test', 'two-factor@example.test', 'payroll@example.test', 'recon@example.test', 'offline-manager@example.test', 'jobs@example.test']) {
    const user = await prisma.user.create({ data: { email, password, firstName: 'Bulk', lastName: 'Fixture', role: 'ADMIN', locationId: bulkStore.id } });
    await prisma.shift.create({ data: { userId: user.id, locationId: bulkStore.id, clockInAt: new Date(), startingCash: email === 'payroll@example.test' ? 200 : 100 } });
    if (email === 'payroll@example.test') await prisma.expense.create({ data: { expenseNumber: 'PAYROLL-REVIEW-FIXTURE', category: 'PAYROLL', description: 'Recorded fixture gross wages', amount: 160, locationId: bulkStore.id, userId: user.id } });
  }
  await prisma.product.create({ data: { name: 'Fixture Bulk Void', sku: 'FIXTURE-BULK-VOID', price: 10, cost: 4, stockQuantity: 20, locationId: bulkStore.id } });
  // Tender tests must not inherit pricing changes made by offline/quote tests.
  const refundStore = await prisma.location.create({ data: { name: 'Refund Tender Store', address: 'Test address', city: 'Test', state: 'IL', zipCode: '60000', phone: '555', email: 'refund-store@example.test', timezone: 'America/Chicago', taxRate: 10, cardSurchargePercent: 0 } });
  const refundUser = await prisma.user.create({ data: { email: 'refund-tenders@example.test', password, firstName: 'Refund', lastName: 'Fixture', role: 'ADMIN', locationId: refundStore.id } });
  await prisma.shift.create({ data: { userId: refundUser.id, locationId: refundStore.id, clockInAt: new Date(), startingCash: 100 } });
  await prisma.product.create({ data: { name: 'Fixture Refund Tender', sku: 'FIXTURE-REFUND-TENDER', price: 10, cost: 4, stockQuantity: 20, locationId: refundStore.id } });
  const voidUser = await prisma.user.create({ data: { email: 'voids@example.test', password, firstName: 'Voids', lastName: 'Fixture', role: 'ADMIN', locationId: stores[1].id, hourlyRate: 20 } });
  await prisma.shift.create({ data: { userId: voidUser.id, locationId: stores[1].id, clockInAt: new Date(), startingCash: 100, hourlyRate: 20 } });
  await prisma.product.create({ data: { name: 'Fixture Void', sku: 'FIXTURE-VOID', price: 10, cost: 4, stockQuantity: 20, locationId: stores[1].id } });
  const reportingUser = await prisma.user.create({ data: { email: 'reporting@example.test', password, firstName: 'Reporting', lastName: 'Fixture', role: 'ADMIN', locationId: stores[2].id } });
  const legacyProduct = await prisma.product.create({ data: { name: 'Legacy Report Item', sku: 'LEGACY-REPORT', price: 10, cost: 5, stockQuantity: 5, locationId: stores[2].id } });
  await prisma.sale.create({ data: { saleNumber: 'REPORT-LEGACY', userId: reportingUser.id, locationId: stores[2].id,
    subtotal: 20, total: 22, tax: 2, paymentMethod: 'CARD', amountPaid: 22,
    items: { create: { productId: legacyProduct.id, productName: legacyProduct.name, sku: legacyProduct.sku, quantity: 2, price: 10, total: 22, tax: 2 } } } });
  const priorReportSale = await prisma.sale.create({ data: { saleNumber: 'REPORT-PRIOR', userId: reportingUser.id, locationId: stores[2].id,
    createdAt: new Date('2025-01-01T12:00:00Z'), subtotal: 20, total: 22, tax: 2, paymentMethod: 'CASH', amountPaid: 22,
    items: { create: { productId: legacyProduct.id, productName: legacyProduct.name, sku: legacyProduct.sku, quantity: 2, price: 10, total: 22, tax: 2, unitCost: 5 } } } });
  await prisma.refund.create({ data: { saleId: priorReportSale.id, amount: 11, taxAmount: 1, method: 'CASH', reason: 'Earlier sale returned today', refundedBy: reportingUser.id } });
  await prisma.expense.createMany({ data: [
    { expenseNumber: 'REPORT-PURCHASE', category: 'INVENTORY_PURCHASE', description: 'Report stock acquisition', amount: 80, status: 'PAID', locationId: stores[2].id, userId: reportingUser.id },
    { expenseNumber: 'REPORT-WAGES', category: 'PAYROLL', description: 'Report gross wages', amount: 3, status: 'APPROVED', locationId: stores[2].id, userId: reportingUser.id },
  ] });
  await prisma.recurringExpense.create({ data: { category: 'RENT', description: 'Store C recurring supplier', amount: 25, frequency: 'MONTHLY', startDate: new Date(), nextDueDate: new Date('2030-01-01T06:00:00Z'), locationId: stores[2].id, userId: reportingUser.id } });
  let platform;
  for (const [name, role] of [['owner', 'ADMIN'], ['manager', 'MANAGER'], ['cashier', 'CASHIER'], ['platform', 'SUPER_ADMIN']]) {
    const user = await prisma.user.create({ data: { email: name + '@example.test', password, firstName: name, lastName: 'Fixture', role, locationId: role === 'SUPER_ADMIN' ? null : stores[0].id, hourlyRate: role === 'SUPER_ADMIN' ? null : 20 } });
    if (role === 'SUPER_ADMIN') platform = user;
    else await prisma.shift.create({ data: { userId: user.id, locationId: stores[0].id, clockInAt: new Date(), startingCash: 100, hourlyRate: 20 } });
  }
  // Synthetic profiles below are browser fixtures, never live barcode verification.
  for (const mode of ['MANUAL', 'DISPENSER', 'BOTH']) {
    const lotteryStore = await prisma.location.create({ data: { name: 'Lottery ' + mode, address: 'Test', city: 'Test', state: 'IL', zipCode: '60000', phone: '555', email: mode + '@lottery.test', timezone: 'America/Chicago' } });
    for (const [name, role] of (mode === 'MANUAL' ? [['lottery', 'ADMIN'], ['lottery-cashier', 'CASHIER'], ['lottery-manager', 'MANAGER']] : [[mode === 'BOTH' ? 'lottery-mixed' : 'lottery-machine', 'ADMIN']])) {
      await prisma.user.create({ data: { email: name + '@example.test', password, firstName: name, lastName: 'Fixture', role, locationId: lotteryStore.id } });
    }
    await prisma.lotteryConfiguration.create({ data: { locationId: lotteryStore.id, userId: platform.id, effectiveDate: '2026-01-01', settings: {
      mode, workflow: 'SIMPLE', cashMode: mode === 'BOTH' ? 'SHARED' : 'SEPARATE', dispensers: mode !== 'MANUAL' ? [{ id: 'machine', name: 'Cashier dispenser' }] : [], pilotEvidence: '',
      barcodeProfile: mode !== 'DISPENSER' ? { gameDigits: 4, bookDigits: 6, ticketDigits: 3, prefixDigits: 0, suffixDigits: 0, evidence: 'Synthetic fixture codes', samples: [
        { raw: '0001000001010', game: '0001', book: '000001', ticket: '010' }, { raw: '0001000001011', game: '0001', book: '000001', ticket: '011' }] } : null,
    } } });
    if (mode !== 'DISPENSER') {
      const game = await prisma.lotteryTicketType.create({ data: { locationId: lotteryStore.id, ticketName: 'Bright Stars', ticketCode: 'BRIGHT', gameNumber: '0001', pricePerTicket: 10, firstTicket: 0, lastTicket: 59, binNumber: 'A1', startingNumber: 10 } });
      if (mode === 'MANUAL') await prisma.lotteryTicketType.create({ data: { locationId: lotteryStore.id, ticketName: 'Crossword', ticketCode: 'CROSSWORD', gameNumber: '284', pricePerTicket: 5, firstTicket: 0, lastTicket: 99, binNumber: '2', startingNumber: 20 } });
      await prisma.lotteryBook.create({ data: { locationId: lotteryStore.id, ticketTypeId: game.id, name: game.ticketName, gameNumber: '0001', bookNumber: '000001', slot: 'A1', direction: 'ASC', firstTicket: 0, lastTicket: 59, ticketCount: 60, price: 10, position: 10, registeredDate: '2026-01-01', evidence: 'Synthetic opening fixture', userId: platform.id } });
      if (mode === 'BOTH') for (const [bookNumber, slot] of [['000002', '10'], ['000003', '2']]) await prisma.lotteryBook.create({ data: { locationId: lotteryStore.id, ticketTypeId: game.id, name: game.ticketName, gameNumber: '0001', bookNumber, slot, direction: 'ASC', firstTicket: 0, lastTicket: 59, ticketCount: 60, price: 10, position: 0, registeredDate: '2026-01-01', evidence: 'Synthetic mixed-store opening', userId: platform.id } });
    }
  }
  const [locationAId, locationBId] = [stores[0].id, stores[1].id].sort();
  const loyaltyUser = await prisma.user.create({ data: { email: 'loyalty@example.test', password, firstName: 'Loyalty', lastName: 'Fixture', role: 'ADMIN', locationId: stores[0].id, hourlyRate: 20 } });
  await prisma.shift.create({ data: { userId: loyaltyUser.id, locationId: stores[0].id, clockInAt: new Date(), startingCash: 100, hourlyRate: 20 } });
  await prisma.customer.create({ data: { firstName: 'Loyalty', lastName: 'Customer', phone: '5557770011', loyaltyPoints: 1000, locationId: stores[0].id } });
  await prisma.product.create({ data: { name: 'Fixture Loyalty', sku: 'FIXTURE-LOYALTY', price: 1, cost: 0.4, stockQuantity: 30, locationId: stores[0].id } });
  const accountsUser = await prisma.user.create({ data: { email: 'accounts@example.test', password, firstName: 'Accounts', lastName: 'Fixture', role: 'ADMIN', locationId: stores[0].id, hourlyRate: 20 } });
  await prisma.shift.create({ data: { userId: accountsUser.id, locationId: stores[0].id, clockInAt: new Date(), startingCash: 100, hourlyRate: 20 } });
  const accountCustomer = await prisma.customer.create({ data: { firstName: 'Account', lastName: 'Fixture', email: 'accountcustomer@example.test', locationId: stores[0].id } });
  await prisma.houseAccount.create({ data: { customerId: accountCustomer.id, locationId: stores[0].id, creditLimit: 200, balance: 80 } });
  await prisma.storeConnection.create({ data: { locationAId, locationBId, createdBy: platform.id } });
  for (const [name, quantity] of [['Fixture Coffee', 99], ['Fixture Empty', 0], ['Fixture Low', 2], ['Fixture Refund', 10]]) await prisma.product.create({ data: { name, sku: name.replaceAll(' ', '-'), price: 10, cost: 5, stockQuantity: quantity, locationId: stores[0].id } });
  const supplier = await prisma.supplier.create({ data: { name: 'Fixture Supplier', locationId: stores[0].id } });
  const deliveryProduct = await prisma.product.create({ data: { name: 'Fixture Delivery', sku: 'FIXTURE-DELIVERY', price: 10, cost: 5, stockQuantity: 100, locationId: stores[0].id } });
  await prisma.purchaseOrder.create({ data: { orderNumber: 'PO-FIXTURE', supplierId: supplier.id, locationId: stores[0].id, status: 'ORDERED', totalAmount: 50,
    items: { create: { productId: deliveryProduct.id, productName: deliveryProduct.name, sku: deliveryProduct.sku, quantity: 10, cost: 5, total: 50 } },
  } });
  await prisma.user.create({ data: { email: 'receiving@example.test', password, firstName: 'Receiving', lastName: 'Fixture', role: 'ADMIN', locationId: stores[1].id } });
  const transferProduct = await prisma.product.create({ data: { name: 'Fixture Transfer', sku: 'FIXTURE-TRANSFER', barcode: '444444', price: 10, cost: 5, stockQuantity: 100, locationId: stores[0].id } });
  await prisma.product.create({ data: { name: 'Fixture Received', sku: 'FIXTURE-TRANSFER', barcode: '444444', price: 10, cost: 5, stockQuantity: 5, locationId: stores[1].id } });
  await prisma.inventoryTransfer.create({ data: { transferNumber: 'TRF-FIXTURE', fromLocationId: stores[0].id, toLocationId: stores[1].id, createdBy: platform.id,
    items: { create: { productId: transferProduct.id, quantity: 10 } },
  } });
  // Stores of their own for the not-final profit and stock-loss specs, so no other spec's sales,
  // costs or write-offs change the figures they check (profit@, losses@, attention@, receive@, counts@, reorder@example.test).
  for (const [name, store] of [['profit', 'Profit Check Store'], ['losses', 'Loss Check Store'], ['attention', 'Attention Check Store'], ['receive', 'Receive Check Store'], ['counts', 'Count Check Store'], ['reorder', 'Reorder Check Store']]) {
    const ownStore = await prisma.location.create({ data: { name: store, address: 'Test', city: 'Test', state: 'IL', zipCode: '60000', phone: '555', email: name + '-store@example.test', timezone: 'America/Chicago' } });
    const ownUser = await prisma.user.create({ data: { email: name + '@example.test', password, firstName: name, lastName: 'Fixture', role: 'ADMIN', locationId: ownStore.id } });
    await prisma.shift.create({ data: { userId: ownUser.id, locationId: ownStore.id, clockInAt: new Date(), startingCash: 100 } });
  }
  // One business with two stores for the store-switching spec (stores@example.test owns both).
  // South Street sold $42.00 two days ago; North Street sold nothing.
  const northStore = await prisma.location.create({ data: { name: 'North Street Store', address: 'Test', city: 'Test', state: 'IL', zipCode: '60000', phone: '555', email: 'north-store@example.test', timezone: 'America/Chicago' } });
  const southStore = await prisma.location.create({ data: { name: 'South Street Store', address: 'Test', city: 'Test', state: 'IL', zipCode: '60000', phone: '555', email: 'south-store@example.test', timezone: 'America/Chicago', organizationId: northStore.organizationId } });
  const storesOwner = await prisma.user.create({ data: { email: 'stores@example.test', password, firstName: 'Multi', lastName: 'Store', role: 'ADMIN', locationId: northStore.id } });
  await prisma.organizationOwner.create({ data: { organizationId: northStore.organizationId, userId: storesOwner.id } });
  await prisma.userStoreAccess.create({ data: { userId: storesOwner.id, locationId: southStore.id, role: 'ADMIN' } });
  await prisma.user.create({ data: { email: 'north-cashier@example.test', password, firstName: 'Nora', lastName: 'North', role: 'CASHIER', locationId: northStore.id } });
  await prisma.product.create({ data: { name: 'North Only Lemonade', sku: 'NORTH-LEMONADE', price: 3, cost: 1, stockQuantity: 10, locationId: northStore.id } });
  await prisma.product.create({ data: { name: 'South Only Iced Tea', sku: 'SOUTH-ICED-TEA', price: 3, cost: 1, stockQuantity: 10, locationId: southStore.id } });
  const southCalendar = require('../src/services/reportDates.service').reportCalendar('America/Chicago');
  await prisma.sale.create({ data: { saleNumber: 'SOUTH-STREET-1', userId: storesOwner.id, locationId: southStore.id,
    createdAt: new Date(southCalendar.day(-2).getTime() + 3600000), subtotal: 40, total: 42, tax: 2, paymentMethod: 'CASH', amountPaid: 42, pricingVersion: 1 } });
  const forecastStore = await prisma.location.create({ data: { name: 'Forecast Store', address: 'Test', city: 'Test', state: 'IL', zipCode: '60000', phone: '555', email: 'forecast-store@example.test', timezone: 'America/Chicago' } });
  const forecastUser = await prisma.user.create({ data: { email: 'forecast@example.test', password, firstName: 'Forecast', lastName: 'Fixture', role: 'ADMIN', locationId: forecastStore.id } });
  const { reportCalendar } = require('../src/services/reportDates.service');
  const forecastCalendar = reportCalendar('America/Chicago');
  for (let day = -28; day < 0; day += 2) await prisma.sale.create({ data: { saleNumber: 'FORECAST-' + Math.abs(day), userId: forecastUser.id, locationId: forecastStore.id,
    createdAt: new Date(forecastCalendar.day(day).getTime() + 3600000), subtotal: 20, total: 22, tax: 2, paymentMethod: 'CASH', amountPaid: 22, pricingVersion: 1 } });
  const digestOwner = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@example.test' } });
  await prisma.emailDelivery.create({ data: { locationId: stores[0].id, recipientId: digestOwner.id, recipientEmail: digestOwner.email, idempotencyKey: 'digest-review-fixture', subject: 'Fixture uncertain daily digest', html: '<p>Fixture totals</p>', status: 'REVIEW', errorCode: 'DELIVERY_UNKNOWN', attempts: 1 } });
  await prisma.activityLog.createMany({ data: [
    { action: 'HOURLY_RATE_UPDATED', entity: 'User', entityId: 'WAGE-FIXTURE', locationId: stores[0].id, details: { previous: 17, hourlyRate: 23 } },
    { action: 'UPDATE', entity: 'USER', entityId: 'PRIVACY-FIXTURE', locationId: stores[0].id, details: { hourlyRate: 23, nested: { grossPay: 987, password: 'secret-audit-password' }, permitted: 'Safe value' } },
  ] });
  console.log('Browser fixtures ready: isolated stores and all four roles');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());

import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { apiToken, record } from './shared';

/**
 * Fill Store A (owner@example.test) with realistic store data so audited
 * screens show real tables, totals and charts rather than empty states.
 * Best effort: every call is logged, and a failed call never stops the audit.
 */
export async function seedDemo(page: Page) {
  const token = await apiToken(page, 'owner@example.test');
  const headers = { Authorization: 'Bearer ' + token };
  const log = (step: string, status: number, note = '') => record('seed-log.jsonl', { step, status, note });
  const post = async (url: string, data: object, step: string) => {
    const res = await page.request.post(url, { headers, data });
    log(step, res.status(), res.ok() ? '' : (await res.text()).slice(0, 200));
    return res.ok() ? (await res.json()).data : null;
  };
  const put = async (url: string, data: object, step: string) => {
    const res = await page.request.put(url, { headers, data });
    log(step, res.status(), res.ok() ? '' : (await res.text()).slice(0, 200));
    return res.ok() ? (await res.json()).data : null;
  };

  const categories: Record<string, string> = {};
  for (const name of ['Beverages', 'Snacks', 'Tobacco', 'Grocery', 'Household']) {
    const created = await post('/api/categories', { name }, `category ${name}`);
    if (created) categories[name] = created.id;
  }

  const catalog: [string, string, number, number, number, object?][] = [
    ['Coca-Cola 20 oz', 'Beverages', 2.49, 1.1, 48], ['Pepsi 20 oz', 'Beverages', 2.49, 1.05, 36], ['Monster Energy 16 oz', 'Beverages', 3.29, 1.6, 24],
    ['Red Bull 8.4 oz', 'Beverages', 3.49, 1.9, 30], ['Dasani Water 1 L', 'Beverages', 1.99, 0.6, 60], ['Gatorade Red 28 oz', 'Beverages', 2.79, 1.2, 0],
    ['Gatorade Blue 28 oz', 'Beverages', 2.79, 1.2, 0], ['Gatorade Orange 28 oz', 'Beverages', 2.79, 1.2, 0], ['Starbucks Frappuccino', 'Beverages', 3.99, 2.1, 12],
    ["Lay's Classic", 'Snacks', 2.19, 1.0, 40], ['Doritos Nacho Cheese', 'Snacks', 2.19, 1.0, 35], ['Snickers Bar', 'Snacks', 1.79, 0.7, 80],
    ['Reese’s Cups', 'Snacks', 1.79, 0.7, 64], ['Pringles Original', 'Snacks', 2.99, 1.4, 3], ['Trail Mix 6 oz', 'Snacks', 4.49, 2.2, 15],
    ['Marlboro Red', 'Tobacco', 12.5, 9.0, 40, { minimumAge: 21 }], ['Newport Menthol', 'Tobacco', 12.75, 9.2, 30, { minimumAge: 21 }], ['Swisher Sweets', 'Tobacco', 1.99, 0.9, 50, { minimumAge: 21 }],
    ['Whole Milk 1 gal', 'Grocery', 4.29, 2.9, 10, { ebtEligible: true, isTaxable: false }], ['White Bread', 'Grocery', 2.99, 1.5, 8, { ebtEligible: true, isTaxable: false }],
    ['Large Eggs dozen', 'Grocery', 3.89, 2.4, 6, { ebtEligible: true, isTaxable: false }], ['Banana each', 'Grocery', 0.35, 0.15, 90, { ebtEligible: true, isTaxable: false }],
    ['Paper Towels 2 pk', 'Household', 5.99, 3.4, 14], ['Dish Soap 20 oz', 'Household', 3.49, 1.8, 9], ['AA Batteries 4 pk', 'Household', 6.99, 3.5, 2],
    ['Phone Charger USB-C', 'Household', 9.99, 3.0, 7],
  ];
  const products: Record<string, { id: string; price: number }> = {};
  let barcode = 7_100_000_000_00;
  for (const [name, category, price, cost, stockQuantity, extra] of catalog) {
    const created = await post('/api/products', { name, sku: name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 30), barcode: String(barcode++),
      price, cost, stockQuantity, lowStockAlert: 5, trackInventory: true, isTaxable: true, categoryId: categories[category], ...extra }, `product ${name}`);
    if (created) products[name] = { id: created.id, price };
  }

  // Connected pack and a variety pack.
  if (products['Marlboro Red']) await post(`/api/products/${products['Marlboro Red'].id}/selling-units`,
    { name: 'Carton', barcode: '7199999999901', unitsPerPackage: 10, price: 119.99, packCost: 90 }, 'pack Marlboro carton');
  const variety = await post('/api/products', { name: 'Gatorade Variety 24-pack', sku: 'GATORADE-VARIETY-24', barcode: '7199999999902', price: 34.99, cost: 24,
    stockQuantity: 3, lowStockAlert: 1, trackInventory: true, isTaxable: true, categoryId: categories.Beverages }, 'variety pack');
  if (variety && products['Gatorade Red 28 oz']) await put(`/api/products/${variety.id}/bundle`, { components: [
    { productId: products['Gatorade Red 28 oz'].id, quantity: 12 }, { productId: products['Gatorade Blue 28 oz'].id, quantity: 6 },
    { productId: products['Gatorade Orange 28 oz'].id, quantity: 6 }] }, 'variety contents');

  const customers: string[] = [];
  for (const [firstName, lastName, phone] of [['Maria', 'Gonzalez', '5551230001'], ['James', 'Carter', '5551230002'], ['Aisha', 'Khan', '5551230003'],
    ['Tom', 'Nguyen', '5551230004'], ['Priya', 'Patel', '5551230005'], ['Luis', 'Romero', '5551230006']]) {
    const created = await post('/api/customers', { firstName, lastName, phone, email: `${firstName.toLowerCase()}@example.test` }, `customer ${firstName}`);
    if (created) customers.push(created.id);
  }

  // A morning of sales: cash and card, some with customers.
  const names = Object.keys(products).filter(name => !name.startsWith('Gatorade') && !/Marlboro|Newport|Swisher/.test(name));
  const sales: { id: string; items: { id: string }[] }[] = [];
  for (let index = 0; index < 15; index++) {
    const picks = [names[index % names.length], names[(index * 3 + 1) % names.length], names[(index * 5 + 2) % names.length]];
    const items = [...new Set(picks)].map((name, i) => ({ productId: products[name].id, quantity: 1 + ((index + i) % 3), price: products[name].price }));
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const card = index % 3 === 0;
    const sale = await post('/api/sales', { items, idempotencyKey: randomUUID(), customerId: index % 4 === 0 ? customers[index % customers.length] : undefined,
      ...(card ? { paymentMethod: 'CARD', amountPaid: 0, payments: undefined } : { paymentMethod: 'CASH', amountPaid: Math.ceil(subtotal * 1.25) + 1 }) }, `sale ${index + 1} ${card ? 'card' : 'cash'}`);
    if (!sale && card) {
      // Card sales may need an approval reference; fall back to cash so the day still has sales.
      const cash = await post('/api/sales', { items, idempotencyKey: randomUUID(), paymentMethod: 'CASH', amountPaid: Math.ceil(subtotal * 1.25) + 1 }, `sale ${index + 1} cash fallback`);
      if (cash) sales.push(cash);
    } else if (sale) sales.push(sale);
  }
  if (sales[1]) await post(`/api/sales/${sales[1].id}/refund`, { items: [{ saleItemId: sales[1].items[0].id, quantity: 1 }], reason: 'Customer return' }, 'refund');
  if (sales[2]) await post(`/api/sales/${sales[2].id}/void`, { reason: 'Rang up by mistake' }, 'void');

  // An item sold with nothing recorded on hand opens a stock exception.
  if (products['Gatorade Red 28 oz']) await post('/api/sales', { items: [{ productId: products['Gatorade Red 28 oz'].id, quantity: 2, price: 2.79 }],
    paymentMethod: 'CASH', amountPaid: 10, idempotencyKey: randomUUID() }, 'sale beyond stock');

  for (const [category, description, amount, vendor] of [['RENT', 'November rent', 2400, 'Oak Street Properties'], ['UTILITIES', 'Electric bill', 386.4, 'ComEd'],
    ['SUPPLIES', 'Register paper and bags', 74.25, 'Uline'], ['MAINTENANCE', 'Cooler repair', 210, 'Cold Tech']] as const) {
    await post('/api/expenses', { category, description, amount, vendor, expenseDate: new Date().toISOString().slice(0, 10) }, `expense ${description}`);
  }
  if (products['Snickers Bar']) await post('/api/promotions', { name: 'Candy 10% off', type: 'PERCENT_OFF', percentOff: 10,
    productIds: [products['Snickers Bar'].id, products['Reese’s Cups']?.id].filter(Boolean), isActive: true }, 'promotion');
  await put('/api/pricing/rules', { scope: 'STORE', targetMargin: 0.3, rounding: 'NINE' }, 'pricing rule');
}

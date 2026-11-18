import { test, expect, type Page } from '@playwright/test';
import { login } from './utils/auth-helper';

// Age-restricted items ask for the customer's ID the moment they go into the cart, and the
// barcode on the back of a driver's license is read from a 2D scanner's keystrokes.
const auth = async (page: Page) => ({ Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) });
let serial = 0;
async function product(page: Page, name: string, extra = {}) {
  const unique = `${Date.now()}${serial++}`;
  const response = await page.request.post('/api/products', { headers: await auth(page), data: {
    name, sku: `${name.replaceAll(' ', '-')}-${unique}`, barcode: unique, price: 5, cost: 2, stockQuantity: 20, isTaxable: false, trackInventory: true, ...extra,
  } });
  expect(response.status()).toBe(201);
  return (await response.json()).data as { barcode: string };
}
async function scan(page: Page, barcode: string) {
  await page.getByRole('heading', { name: 'Current Sale', exact: true }).click();
  await page.keyboard.type(barcode, { delay: 2 }); await page.keyboard.press('Enter');
}
const digits = (date: Date) => `${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}${date.getFullYear()}`;
/** A US license barcode (sample data) as a 2D scanner types it: one element per line. */
const license = (born: Date, expires: Date) => ['@', 'ANSI 636014090102DL00410279ZC03200024DLDAQD1234567', 'DCSDOE', 'DDEN', 'DACJANE', 'DDFN',
  `DBB${digits(born)}`, `DBA${digits(expires)}`, 'DBC2', 'DAISPRINGFIELD', 'DAJIL', 'DCGUSA'];
async function scanLicense(page: Page, lines: string[]) {
  for (const [index, line] of lines.entries()) {
    await page.keyboard.type(line);
    if (index < lines.length - 1) await page.keyboard.press('Enter');
  }
}
const year = new Date().getFullYear();
const ageDialog = (page: Page) => page.getByRole('dialog', { name: 'Age Verification Required', exact: true });
const cart = (page: Page) => page.locator('[data-sale-cart]').filter({ visible: true });

test('a 21+ item asks for ID as soon as it is scanned, and a license scan reads the birth date once for the sale', async ({ page }) => {
  await login(page, 'owner@example.test');
  const chips = await product(page, 'Age check chips');
  const beer = await product(page, 'Age check beer', { minimumAge: 21 });
  const wine = await product(page, 'Age check wine', { minimumAge: 21 });
  await page.goto('/pos');
  await scan(page, chips.barcode);
  await expect(cart(page).getByText('Age check chips')).toBeVisible();
  await expect(ageDialog(page)).toHaveCount(0);

  await scan(page, beer.barcode);
  const age = ageDialog(page);
  await expect(age).toBeVisible();
  await expect(age).toContainText('Restricted: Age check beer');
  await scanLicense(page, license(new Date(year - 30, 0, 1), new Date(year + 3, 0, 1)));
  // The name and city are shown to compare with the card and the customer.
  await expect(age).toContainText('JANE DOE · 30 years old');
  await expect(age).toContainText('SPRINGFIELD, IL');
  await expect(age).toContainText('Check that the name, photo and city on the card match the customer.');
  await expect(age).toContainText('OK to sell');
  // The license's lines were never looked up as products.
  await expect(page.getByText(/No product has barcode/)).toHaveCount(0);
  await age.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(age).toHaveCount(0);
  await expect(cart(page).getByText('Age check beer')).toBeVisible();

  // Checked once for this sale: another 21+ item goes straight in, and Charge goes straight to payment.
  await scan(page, wine.barcode);
  await expect(cart(page).getByText('Age check wine')).toBeVisible();
  await expect(ageDialog(page)).toHaveCount(0);
  await page.getByRole('button', { name: /^Charge \$/ }).click();
  await expect(page.getByRole('dialog', { name: 'Payment', exact: true })).toBeVisible();
});

test('a scanner that reads the license itself and types its fields separated by $ is read too', async ({ page }) => {
  await login(page, 'owner@example.test');
  const beer = await product(page, 'Age check beer', { minimumAge: 21 });
  await page.goto('/pos');
  await scan(page, beer.barcode);
  const age = ageDialog(page);
  await expect(age).toBeVisible();
  // Sample data in one scanner's layout: first, middle, last, birth date, street, -, city, state, ZIP, -, number.
  await page.keyboard.type(`JANE$Q$DOE$01/01/${year - 30}$123 MAIN ST$$SPRINGFIELD$IL$627010000$NONE$D12345678901`);
  await page.keyboard.press('Enter');
  await expect(age).toContainText('JANE Q DOE · 30 years old');
  await expect(age).toContainText('SPRINGFIELD, IL');
  await expect(age).toContainText('OK to sell');
  await age.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(age).toHaveCount(0);
});

test('an under-age or expired ID is refused, and Remove item takes the restricted item out of the sale', async ({ page }) => {
  await login(page, 'owner@example.test');
  const chips = await product(page, 'Age check chips');
  const beer = await product(page, 'Age check beer', { minimumAge: 21 });
  await page.goto('/pos');
  await scan(page, chips.barcode);
  await expect(cart(page).getByText('Age check chips')).toBeVisible();
  await scan(page, beer.barcode);
  const age = ageDialog(page);
  await expect(age).toBeVisible();

  // The small barcode at the top of a license holds no details: the cashier is told to scan the larger one.
  await page.keyboard.type('D12345678901'); await page.keyboard.press('Enter');
  await expect(age).toContainText('That barcode does not hold the ID\'s details. On the back of the license, scan the larger barcode');

  await scanLicense(page, license(new Date(year - 19, 0, 1), new Date(year + 2, 0, 1)));
  await expect(age).toContainText('JANE DOE · 19 years old');
  await expect(age).toContainText('DO NOT SELL');
  await expect(age.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();

  await age.getByRole('button', { name: 'Scan another ID', exact: true }).click();
  await scanLicense(page, license(new Date(year - 40, 0, 1), new Date(year - 1, 0, 1)));
  await expect(age).toContainText('This ID has expired. Ask for a valid ID.');
  await expect(age.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();

  await age.getByRole('button', { name: 'Remove item', exact: true }).click();
  await expect(age).toHaveCount(0);
  await expect(page.getByText('Age check beer was removed: the customer\'s age was not verified.')).toBeVisible();
  await expect(cart(page).getByText('Age check chips')).toBeVisible();
  await expect(cart(page).getByText('Age check beer')).toHaveCount(0);
});

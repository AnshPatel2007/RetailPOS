import { parseProductCsv } from '../utils/productCsv';

test('CSV preserves quoted commas, escaped quotes, multiline cells and leading zero barcodes', () => {
  expect(parseProductCsv('\uFEFFsku,name,barcode\r\nA,"Coffee, ""Dark""\nRoast",001234\r\n')[0]).toEqual({ number: 2, values: { sku: 'A', name: 'Coffee, "Dark"\nRoast', barcode: '001234' } });
});
test('malformed columns and quotes are rejected before importing any rows', () => {
  for (const csv of ['sku,name\nA,"bad', 'sku,name\nA,One,Extra', 'sku,price,retail_price\nA,1,2', 'sku,unknown\nA,X']) expect(() => parseProductCsv(csv)).toThrow();
});

import {
  caseCostOf, contentTokens, lineUnits, normalizeInvoiceText, normalizeItemCode, normalizeSupplierName, pickSupplier,
  printedUpcVariants, shelfName, similarity, unitsPerCase,
} from '../services/invoiceMatching.service';
import { combinePages, detectInvoiceType } from '../services/invoiceReading.service';

describe('invoice text', () => {
  it('writes sizes, counts and abbreviations one way', () => {
    expect(normalizeInvoiceText('COKE CLASSIC 12Z CN 24CT')).toBe('coke classic 12oz can 24pk');
    expect(normalizeInvoiceText('Coke Classic 12 oz. Can, 24 ct')).toBe('coke classic 12oz can 24pk');
    expect(normalizeInvoiceText('PEPSI 2LTR BTL')).toBe('pepsi 2l bottle');
    expect(normalizeInvoiceText('Pepsi 2 Liter Bottle')).toBe('pepsi 2l bottle');
    expect(normalizeInvoiceText('TITO\'S VODKA 750ML')).toBe('tito vodka 750ml');
    expect(normalizeInvoiceText('MTN DEW 20 FL OZ')).toBe('mountain dew 20oz');
    expect(normalizeInvoiceText('BUD LIGHT 12OZ CN 2/12')).toBe('bud light 12oz can 2x12');
  });

  it('reads pack/size and fractions of a measure', () => {
    expect(normalizeInvoiceText('GATORADE 6/32OZ')).toBe('gatorade 6pk 32oz');
    expect(normalizeInvoiceText('MILK WHOLE 1/2 GAL')).toBe('milk whole 0.5gal');
    expect(normalizeInvoiceText('SPRING WATER 24/16.9OZ')).toBe('spring water 24pk 16.9oz');
  });

  it('keeps only the words that name the item', () => {
    expect(contentTokens(normalizeInvoiceText('COKE CLASSIC 12Z CN 2/12 CS 10234'))).toEqual(['coke', 'classic', 'can']);
  });

  it('turns supplier text into a starting shelf name without the case count', () => {
    expect(shelfName('COKE CLASSIC 12Z CN 24CT')).toBe('Coke Classic 12 oz Can');
    expect(shelfName('PEPSI 2LTR BTL')).toBe('Pepsi 2 L Bottle');
  });
});

describe('units per case', () => {
  it('reads printed case sizes', () => {
    expect(unitsPerCase('BUD LIGHT 12OZ CN 2/12')).toBe(24);
    expect(unitsPerCase('COKE 12OZ 4/6PK')).toBe(24);
    expect(unitsPerCase('DORITOS NACHO 1/24')).toBe(24);
    expect(unitsPerCase('COKE CLASSIC 12Z CN 24CT')).toBe(24);
    expect(unitsPerCase('GATORADE 6/32OZ')).toBe(6);
    expect(unitsPerCase('RED BULL 12-12OZ')).toBe(12);
  });

  it('a printed number wins, and a measure is not a pack', () => {
    expect(unitsPerCase('COKE 2/12', 12)).toBe(12);
    expect(unitsPerCase('MILK WHOLE 1/2 GAL')).toBeNull();
    expect(unitsPerCase('SNICKERS KING SIZE')).toBeNull();
  });
});

describe('similarity', () => {
  it('prefers the same item and size', () => {
    const can = similarity('COKE CLASSIC 12OZ CAN', 'Coca-Cola Classic 12 oz Can');
    const bottle = similarity('COKE CLASSIC 12OZ CAN', 'Coca-Cola Classic 20 oz Bottle');
    expect(can).toBeGreaterThan(bottle);
    expect(similarity('PEPSI 2LTR BTL', 'Pepsi 2 Liter Bottle')).toBe(1);
  });

  it('a different printed size halves the score', () => {
    const same = similarity('MOUNTAIN DEW 20OZ', 'Mountain Dew 20 oz');
    const other = similarity('MOUNTAIN DEW 20OZ', 'Mountain Dew 12 oz');
    expect(other).toBeLessThanOrEqual(same / 2 + 0.001);
  });

  it('a shortened word still counts', () => {
    expect(similarity('HERSHEY CHOC BAR', 'Hershey Chocolate Bar')).toBeGreaterThan(0.8);
    expect(similarity('', 'Anything')).toBe(0);
  });
});

describe('suppliers, item numbers and barcodes', () => {
  it('matches a printed vendor name to the store supplier', () => {
    const suppliers = [{ id: 'a', name: 'Coca-Cola Bottling' }, { id: 'b', name: 'Frito-Lay' }, { id: 'c', name: 'Pepsi' }];
    expect(normalizeSupplierName('The Coca-Cola Bottling Co., Inc.')).toBe('coca cola bottling');
    expect(pickSupplier('COCA-COLA BOTTLING CO INC', suppliers)?.id).toBe('a');
    expect(pickSupplier('Frito Lay, LLC', suppliers)?.id).toBe('b');
    expect(pickSupplier('Pepsi Beverages Company', suppliers)?.id).toBe('c');
    expect(pickSupplier('McLane Company', suppliers)).toBeNull();
    expect(pickSupplier(null, suppliers)).toBeNull();
  });

  it('writes item numbers one way', () => {
    expect(normalizeItemCode(' 00 1234-5 ')).toBe('12345');
    expect(normalizeItemCode('a-0123')).toBe('A0123');
    expect(normalizeItemCode('')).toBeNull();
  });

  it('completes printed UPCs missing their check digit or leading zero', () => {
    expect(printedUpcVariants('04900000044')).toContain('049000000443');
    expect(printedUpcVariants('4900000044')).toContain('049000000443');
    expect(printedUpcVariants('0-49000-00044-3')).toContain('0049000000443');
    expect(printedUpcVariants('123')).toEqual([]);
  });
});

describe('amounts', () => {
  it('a case cost is the printed price, else the line total over the quantity', () => {
    expect(caseCostOf({ unitPrice: 12.5, lineTotal: 25, quantity: 2 })).toBe(12.5);
    expect(caseCostOf({ unitPrice: null, lineTotal: 25, quantity: 2 })).toBe(12.5);
    expect(caseCostOf({ unitPrice: null, lineTotal: null, quantity: 2 })).toBeNull();
  });

  it('units are cases times case size; cost per unit is the case cost over its size', () => {
    expect(lineUnits({ receivedQuantity: 2, unitsPerCase: 24, caseCost: 12 })).toEqual({ units: 48, unitCost: 0.5 });
    expect(lineUnits({ receivedQuantity: 1.5, unitsPerCase: 24, caseCost: null })).toEqual({ units: 36, unitCost: null });
  });
});

describe('reading', () => {
  it('knows a file by its first bytes', () => {
    expect(detectInvoiceType(Buffer.from('%PDF-1.7'))).toBe('application/pdf');
    expect(detectInvoiceType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectInvoiceType(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1'))).toBe('image/webp');
    expect(detectInvoiceType(Buffer.from('<html>'))).toBeNull();
  });

  it('puts pages together: header from the first page, totals from the page with the total', () => {
    const page = (overrides: object) => ({ isInvoice: true, problem: '', vendor: '', invoiceNumber: '', invoiceDate: '', subtotal: null, tax: null, fees: null, discount: null, total: null, lines: [], ...overrides });
    const line = (description: string) => ({ description, itemCode: '', upc: '0-12000-00129-1', quantity: 2, unit: 'CASE' as const, unitsPerCase: 24, unitPrice: 10, lineTotal: 20, changedByHand: false });
    const reading = combinePages([
      page({ vendor: 'Coca-Cola', invoiceNumber: 'A-1', invoiceDate: '2026-11-14', lines: [line('COKE 12Z CN')], fees: 3 }),
      page({ problem: 'cut off at the bottom', lines: [line('SPRITE 12Z CN')], subtotal: 40, tax: 0, fees: 5, total: 45 }),
    ]);
    expect(reading.header).toEqual({ vendorName: 'Coca-Cola', invoiceNumber: 'A-1', invoiceDate: '2026-11-14', subtotal: 40, tax: 0, fees: 5, discount: null, total: 45 });
    expect(reading.lines.map(entry => [entry.page, entry.description, entry.upc, entry.printedUnitsPerCase])).toEqual([[1, 'COKE 12Z CN', '012000001291', 24], [2, 'SPRITE 12Z CN', '012000001291', 24]]);
    expect(reading.notes).toEqual(['Photo 2: cut off at the bottom']);
  });
});

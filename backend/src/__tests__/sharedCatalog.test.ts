import { groupForLinking } from '../services/sharedCatalog.service';

const product = (id: string, locationId: string, name: string, sku: string, barcode: string | null = null) => ({ id, locationId, name, sku, barcode });

describe('which products are the same item across stores', () => {
  it('matches by barcode in any UPC/EAN form first, then by SKU and name', () => {
    const groups = groupForLinking([
      product('a1', 'A', 'Coca-Cola 12 oz Can', 'COKE-12', '049000000443'),
      product('b1', 'B', 'Coke 12oz Can', 'C12', '0049000000443'),
      product('a2', 'A', 'Snack Bar', 'SNACK-1'),
      product('b2', 'B', 'snack  bar', 'snack-1'),
      product('a3', 'A', 'Only Here', 'ONLY-1', '012345678905'),
    ], []);
    expect(groups.map(group => [group.match, group.members.map(member => member.id)])).toEqual([
      ['BARCODE', ['a1', 'b1']],
      ['SKU_NAME', ['a2', 'b2']],
    ]);
  });

  it('a barcode match wins over the same SKU and name, and one store alone is not a group', () => {
    const groups = groupForLinking([
      product('a1', 'A', 'Gum', 'GUM', '012345678905'),
      product('b1', 'B', 'Gum', 'GUM', '036000291452'),
      product('a2', 'A', 'Water', 'WATER', '036000291452'),
    ], []);
    // b1 joins a2 by barcode; a1 is then alone (its SKU twin b1 is taken).
    expect(groups.map(group => group.members.map(member => member.id))).toEqual([['b1', 'a2']]);
  });

  it('an item already in the catalog takes even one store\'s product', () => {
    const existing = [{ id: 'item-1', name: 'Only Here', sku: 'ONLY-1', barcode: '012345678905' }, { id: 'item-2', name: 'Chips', sku: 'CHIPS', barcode: null }];
    const groups = groupForLinking([
      product('b3', 'B', 'Only Here (new)', 'O1', '0012345678905'),
      product('b4', 'B', 'chips', 'chips'),
      product('b5', 'B', 'Nothing Like It', 'NONE'),
    ], existing);
    expect(groups.map(group => [group.match, group.existing?.id, group.members.map(member => member.id)])).toEqual([
      ['SKU_NAME', 'item-2', ['b4']],
      ['BARCODE', 'item-1', ['b3']],
    ]);
  });
});

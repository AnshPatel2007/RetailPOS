import { inferCatalogAgeRestriction } from '../services/catalogAgeRestriction';

describe('catalog age restriction suggestions', () => {
  it.each([
    ['Beer', 'Example Lager 12 pack'],
    ['Food, Beverages & Tobacco > Beverages > Alcoholic Beverages > Liquor & Spirits > Vodka', 'Example Vodka'],
    ['en:red-wines', 'Example Cabernet 750 ml'],
    ['Hard Seltzers', 'Example Lime 12 pack'],
    ['Liquor & Spirits', 'Example Reserve 750 ml'],
    ['Cigarettes', 'Example Original 20 count'],
    ['Tobacco Products', 'Example Blend'],
    ['Nicotine Pouches', 'Example Mint 6 mg'],
    ['E-Cigarettes', 'Example Device'],
  ])('suggests 21 for specific category %s', (category, name) => {
    expect(inferCatalogAgeRestriction({ category, name })).toMatchObject({ status: 'restricted', minimumAge: 21 });
  });

  it('uses a specific ancestor when the leaf alone is not recognized', () => {
    expect(inferCatalogAgeRestriction({ name: 'Example White Blend', category: 'Dry white blends',
      categoryCandidates: ['Dry white blends', 'White wines', 'Wines', 'Beverages'] }))
      .toMatchObject({ status: 'restricted', minimumAge: 21, evidence: ['White wines', 'Wines'] });
  });

  it.each([
    {},
    { name: 'Marlboro' },
    { name: 'Budweiser' },
    { name: 'Coca-Cola 20 fl oz', category: 'Food, Beverages & Tobacco' },
    { name: 'Coca-Cola', category: 'Soda', categoryCandidates: ['Food, Beverages & Tobacco', 'Beverages'] },
    { name: 'A&W Root Beer', category: 'Sodas' },
    { name: 'Ginger Beer', category: 'Soft drinks' },
    { name: 'Red Wine Vinegar', category: 'Vinegars' },
    { name: 'Beer Battered Fish', category: 'Frozen food' },
    { name: 'Apple Cider', category: 'Ciders' },
  ])('does not infer a restriction or an exemption from insufficient evidence %j', input => {
    expect(inferCatalogAgeRestriction(input)).toMatchObject({ status: 'unknown', minimumAge: null });
  });

  it.each([
    ['Beers', 'Example 0.0 Lager'],
    ['Beers', 'Example 0% ABV Beer'],
    ['Wine', 'Example Non-Alcoholic Red Wine'],
    ['Wines', 'Example Dealcoholized Wine'],
    ['Beer', 'A&W Root Beer'],
    ['Beer', 'Ginger Beer'],
    ['Beer', 'Beer Battered Fish'],
    ['Beer', 'Beer Flavored Chips'],
    ['Wine', 'Red Wine Vinegar'],
    ['Wine', 'Wine Glasses Set'],
    ['Liquor', 'Bourbon Vanilla Sauce'],
    ['Tobacco Products', 'Cigar Cutter'],
    ['Tobacco', 'Tobacco Vanilla Candle'],
    ['Nicotine Products', 'Nicotine Gum'],
    ['Nicotine Pouches', 'Nicotine-Free Mint Pouches'],
    ['E-Liquids', 'Example 0 mg Nicotine Liquid'],
    ['E-Liquids', 'Example Mint 0mg Liquid'],
    ['E-Cigarettes', 'Replacement Coils'],
  ])('requires review for conflicting category/name: %s / %s', (category, name) => {
    expect(inferCatalogAgeRestriction({ category, name })).toMatchObject({ status: 'review', minimumAge: null });
  });

  it.each([
    { category: 'Beer', categoryCandidates: ['Beers', 'Soft drinks'] },
    { category: 'Vodka', categoryCandidates: ['Tobacco products'] },
    { category: 'Beer', categoryCandidates: ['Non-alcoholic beverages'] },
    { category: 'Tobacco', name: 'Beer Gift Pack' },
  ])('does not resolve contradictory catalog evidence automatically %j', input => {
    expect(inferCatalogAgeRestriction(input)).toMatchObject({ status: 'review', minimumAge: null });
  });

  it.each([
    { name: 'Example Beer', category: 'Beverages' },
    { name: 'Example Cigarettes', category: 'Food, Beverages & Tobacco' },
    { name: 'Example Nicotine Pouches' },
    { name: 'Wine Bottle Opener', category: 'Kitchen tools' },
    { name: 'Example Accessory', category: 'Tobacco Accessories' },
  ])('asks for review rather than assigning 21 from a name or accessory category %j', input => {
    expect(inferCatalogAgeRestriction(input)).toMatchObject({ status: 'review', minimumAge: null });
  });

  it('does not treat zero sugar as zero alcohol', () => {
    expect(inferCatalogAgeRestriction({ name: 'Example Zero Sugar Hard Seltzer', category: 'Hard Seltzer' }))
      .toMatchObject({ status: 'restricted', minimumAge: 21 });
  });

  it('does not mutate shared category candidates and deduplicates evidence', () => {
    const categoryCandidates = Object.freeze(['en:beers', 'Beers', 'Beverages']);
    expect(inferCatalogAgeRestriction({ category: 'Beers', categoryCandidates }).evidence).toEqual(['Beers']);
    expect(categoryCandidates).toEqual(['en:beers', 'Beers', 'Beverages']);
  });
});

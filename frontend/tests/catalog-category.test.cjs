const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const file = path.join(__dirname, '../src/lib/catalogCategory.ts');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const exported = { exports: {} };
vm.runInNewContext(compiled, { exports: exported.exports, module: exported, require }, { filename: file });
const { matchCatalogCategory, suggestedCatalogCategory } = exported.exports;
const categories = (...names) => names.map((name, index) => ({ id: `category-${index}`, name }));

test('Coca-Cola catalog ancestors select an existing Drinks category', () => {
  const available = categories('Groceries', 'Drinks', 'Tobacco');
  assert.equal(matchCatalogCategory(available, ['en:beverages', 'en:carbonated-drinks', 'en:colas']), available[1]);
});

test('selects the most specific existing beverage category independently of candidate order', () => {
  const available = categories('Beverages', 'Soft Drinks', 'Cola');
  for (const suggestions of [['en:beverages', 'en:colas'], ['en:colas', 'en:beverages']]) {
    assert.equal(matchCatalogCategory(available, suggestions), available[2]);
    assert.equal(matchCatalogCategory(available.slice(0, 2), suggestions), available[1]);
  }
});

test('normalizes provider language tags, hyphens, case, accents and known singulars', () => {
  const available = categories('SOFT DRINK', 'Café', 'Potato chip');
  assert.equal(matchCatalogCategory(available, ['en-US:soft-drinks']), available[0]);
  assert.equal(matchCatalogCategory(available, ['fr:cafe']), available[1]);
  assert.equal(matchCatalogCategory(available, ['en:potato-chips']), available[2]);
});

test('explicit provider paths prefer matching leaf categories over their ancestors', () => {
  const available = categories('Food', 'Snacks', 'Potato Chips');
  assert.equal(matchCatalogCategory(available, ['Food > Snacks > Potato chips']), available[2]);
  assert.equal(matchCatalogCategory(available, ['Food / Snacks / Potato chips']), available[2]);
  assert.equal(matchCatalogCategory(available.slice(0, 2), ['Food > Snacks > Potato chips']), available[1]);
});

test('a specific alias outranks an exact broad beverage ancestor', () => {
  const available = categories('Beverages', 'Soda');
  assert.equal(matchCatalogCategory(available, ['en:beverages', 'en:carbonated-drinks']), available[1]);
});

test('equal-confidence matches remain unselected, including duplicate normalized category names', () => {
  assert.equal(matchCatalogCategory(categories('Drinks', 'Beverages'), ['en:colas']), undefined);
  assert.equal(matchCatalogCategory(categories('Soda', 'Soft Drinks'), ['en:carbonated-drinks']), undefined);
  assert.equal(matchCatalogCategory(categories('Soft Drink', 'soft-drinks'), ['en:soft-drinks']), undefined);
  assert.equal(matchCatalogCategory(categories('Beverages', 'Drinks'), ['en:beverages', 'en:drinks']), undefined);
});

test('an explicitly named category resolves otherwise synonymous alternatives', () => {
  const available = categories('Drinks', 'Beverages', 'Soda', 'Soft Drinks');
  assert.equal(matchCatalogCategory(available, ['en:soft-drinks']), available[3]);
  assert.equal(matchCatalogCategory(available.slice(0, 2), ['en:beverages']), available[1]);
});

test('does not guess specific drink types from a broad parent or conflate drink types', () => {
  assert.equal(matchCatalogCategory(categories('Soda', 'Energy Drinks'), ['en:beverages']), undefined);
  assert.equal(matchCatalogCategory(categories('Cola'), ['en:soft-drinks']), undefined);
  assert.equal(matchCatalogCategory(categories('Soda'), ['en:sparkling-water']), undefined);
  assert.equal(matchCatalogCategory(categories('Energy Drinks'), ['en:energy-bars']), undefined);
  assert.equal(matchCatalogCategory(categories('Vegetable Juice'), ['en:fruit-juices']), undefined);
  assert.equal(matchCatalogCategory(categories('Spring Water'), ['en:sparkling-water']), undefined);
  assert.equal(matchCatalogCategory(categories('Non-alcoholic beverages'), ['en:beverages', 'en:wines']), undefined);
  assert.equal(matchCatalogCategory(categories('Juice'), ['en:fruit-juices'])?.name, 'Juice');
  assert.equal(matchCatalogCategory(categories('Water'), ['en:sparkling-water'])?.name, 'Water');
});

test('never uses arbitrary substring or product-name matching', () => {
  assert.equal(matchCatalogCategory(categories('Wine'), ['en:wine-vinegar']), undefined);
  assert.equal(matchCatalogCategory(categories('Water'), ['en:watermelon']), undefined);
  assert.equal(matchCatalogCategory(categories('Soda'), ['Coca-Cola 20 oz bottle']), undefined);
  assert.equal(matchCatalogCategory(categories('Glass'), ['en:glas']), undefined);
});

test('returns no category for empty or unmatched data and does not mutate inputs', () => {
  const available = Object.freeze(categories('Drinks').map(Object.freeze));
  const suggestions = Object.freeze(['en:colas']);
  assert.equal(matchCatalogCategory(available, suggestions), available[0]);
  assert.equal(matchCatalogCategory(available, ['', '  ', 'en:']), undefined);
  assert.equal(matchCatalogCategory([], suggestions), undefined);
  assert.equal(matchCatalogCategory(categories('Tobacco'), suggestions), undefined);
});

test('suggests a familiar department from catalog classifications without inventing product details', () => {
  assert.equal(suggestedCatalogCategory(['Sweetened beverages', 'Soda', 'Colas', 'Beverages']), 'Soda');
  assert.equal(suggestedCatalogCategory(['en:sparkling-water', 'en:beverages']), 'Water');
  assert.equal(suggestedCatalogCategory(['en:energy-drinks', 'en:beverages']), 'Energy Drinks');
  assert.equal(suggestedCatalogCategory(['Food > Snacks > Potato chips']), 'Potato chips');
  assert.equal(suggestedCatalogCategory(['en:energy-bars']), 'Energy bars');
  assert.equal(suggestedCatalogCategory([]), undefined);
});

test('matches restricted-product departments without assigning them to similar food names', () => {
  assert.equal(suggestedCatalogCategory(['Whisky', 'Distilled spirits', 'Alcoholic beverages', 'Beverages']), 'Liquor');
  assert.equal(suggestedCatalogCategory(['Lagers', 'Beers', 'Beverages']), 'Beer');
  assert.equal(suggestedCatalogCategory(['Red wines', 'Wines', 'Beverages']), 'Wine');
  assert.equal(suggestedCatalogCategory(['Cigarettes', 'Tobacco products']), 'Cigarettes');
  assert.equal(suggestedCatalogCategory(['Nicotine pouches', 'Tobacco products']), 'Nicotine Pouches');
  assert.equal(matchCatalogCategory(categories('Tobacco'), ['en:cigarettes'])?.name, 'Tobacco');
  assert.equal(matchCatalogCategory(categories('Liquor'), ['en:vodka', 'en:distilled-spirits'])?.name, 'Liquor');
  assert.equal(matchCatalogCategory(categories('Vodka'), ['en:whisky', 'en:distilled-spirits']), undefined);
  assert.equal(matchCatalogCategory(categories('Beer'), ['en:root-beers']), undefined);
  assert.equal(matchCatalogCategory(categories('Tobacco'), ['Food, Beverages & Tobacco']), undefined);
});

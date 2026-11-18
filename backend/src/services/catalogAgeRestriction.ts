/**
 * Catalog suggestions for the current US/Illinois stores, never proof of a
 * purchaser's age. Missing evidence must not remove a store's existing setting.
 *
 * Policy references (reviewed 2026-10-29):
 * https://www.fda.gov/tobacco-products/retail-sales-tobacco-products/tobacco-21
 * https://www.ilga.gov/legislation/ilcs/fulltext?DocName=023500050K6-20
 */
export interface CatalogAgeInput {
  name?: string | null;
  category?: string | null;
  categoryCandidates?: readonly string[];
}

export interface CatalogAgeRestriction {
  status: 'restricted' | 'review' | 'unknown';
  minimumAge: 21 | null;
  reason: string;
  evidence: string[];
}

const normalize = (value: string): string => value.slice(0, 500).normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/^[a-z]{2,3}:/i, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();

// Whole category names only: a broad ancestor such as "Food, Beverages &
// Tobacco" does not identify a restricted product. Do not match substrings.
const alcoholCategories = new Set([
  'alcoholic beverages', 'alcoholic drinks', 'beer', 'beers', 'ale', 'ales',
  'lager', 'lagers', 'stout', 'stouts', 'porter', 'porters', 'india pale ale',
  'india pale ales', 'ipa', 'ipas', 'wine', 'wines', 'red wine', 'red wines',
  'white wine', 'white wines', 'rose wine', 'rose wines', 'sparkling wine',
  'sparkling wines', 'champagne', 'champagnes', 'fortified wine', 'fortified wines',
  'vermouth', 'liquor', 'liquors', 'liqueur', 'liqueurs', 'spirits', 'liquor and spirits',
  'wine and spirits', 'wines and spirits', 'beer and wine',
  'distilled spirits', 'whiskey', 'whiskeys', 'whisky', 'whiskies', 'bourbon',
  'bourbons', 'scotch whisky', 'rye whiskey', 'vodka', 'vodkas', 'gin', 'gins',
  'rum', 'rums', 'tequila', 'tequilas', 'mezcal', 'brandy', 'brandies', 'cognac',
  'hard cider', 'hard ciders', 'alcoholic cider', 'alcoholic ciders',
  'hard seltzer', 'hard seltzers', 'hard soda', 'hard sodas',
  'alcoholic cocktails', 'ready to drink alcoholic beverages',
]);

const tobaccoCategories = new Set([
  'tobacco', 'tobacco products', 'cigarette', 'cigarettes', 'cigar', 'cigars',
  'cigarillo', 'cigarillos', 'pipe tobacco', 'rolling tobacco', 'roll your own tobacco',
  'smokeless tobacco', 'chewing tobacco', 'snus', 'snuff', 'hookah tobacco',
  'waterpipe tobacco', 'nicotine pouches', 'nicotine products', 'liquid nicotine',
  'e cigarette', 'e cigarettes', 'electronic cigarette', 'electronic cigarettes', 'electronic nicotine delivery systems',
  'e liquid', 'e liquids', 'electronic cigarette liquid', 'electronic cigarette liquids',
  'vape liquid', 'vape liquids', 'vape juice',
]);

const nonAlcoholCategories = new Set([
  'non alcoholic beverages', 'non alcoholic drinks', 'non alcoholic beer',
  'non alcoholic beers', 'alcohol free beer', 'alcohol free beers',
  'non alcoholic wine', 'non alcoholic wines', 'alcohol free wine',
  'root beer', 'root beers', 'ginger beer', 'ginger beers', 'soda', 'sodas',
  'soft drinks', 'fruit juice', 'fruit juices', 'wine vinegar', 'wine vinegars',
]);

const alcoholWords = /\b(?:alcoholic|beer|beers|ale|ales|lager|stout|porter|wine|wines|champagne|liquor|liqueur|spirits|whisk(?:e)?y|bourbon|vodka|gin|rum|tequila|mezcal|brandy|cognac|vermouth|hard (?:cider|seltzer|soda))\b/;
const tobaccoWords = /\b(?:tobacco|cigarettes?|cigars?|cigarillos?|nicotine|snus|snuff|vapes?|vaping|e cigarettes?|e liquids?|electronic cigarettes?)\b/;
const alcoholException = /\b(?:non ?alcoholic|alcohol ?free|dealcoholi[sz]ed|de alcoholi[sz]ed|root beer|ginger beer|wine vinegar|cooking wine|cooking sherry|beer battered|beer batter|beer bread|beer cheese|(?:beer|wine|whisk(?:e)?y|bourbon|rum|tequila) flavou?red)\b|\b0[.,]0\b|\b0\s*%\s*(?:abv|alcohol)?/;
const nicotineException = /\b(?:nicotine free|zero nicotine|0\s*(?:mg|milligrams?)|nicotine (?:gum|patch(?:es)?|lozenges?|replacement)|smoking cessation)\b/;
const accessoryOrFood = /\b(?:accessor(?:y|ies)|bottle openers?|corkscrews?|glassware|wine glasses?|beer glasses?|shot glasses?|empty bottles?|candles?|perfumes?|fragrances?|sauces?|vinegars?|chocolates?|candy|candies|cakes?|marinades?|barbecue|bbq|cooking|rubbing alcohol|isopropyl|saniti[sz]er|empty cartridges?|replacement coils?|lighters?|ashtrays?|cigar cutters?|tobacco seeds?)\b/;

export function inferCatalogAgeRestriction(input: CatalogAgeInput): CatalogAgeRestriction {
  const name = normalize(input.name || '');
  const categories: { text: string; normalized: string }[] = [];
  const seen = new Set<string>();
  for (const value of [input.category, ...(input.categoryCandidates || []).slice(0, 32)]) {
    if (typeof value !== 'string') continue;
    for (const part of value.slice(0, 1000).split('>').slice(0, 8)) {
      const normalized = normalize(part);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      categories.push({ text: part.trim().slice(0, 250), normalized });
    }
  }

  const alcohol = categories.filter(item => alcoholCategories.has(item.normalized));
  const tobacco = categories.filter(item => tobaccoCategories.has(item.normalized));
  const evidence = [...alcohol, ...tobacco].map(item => item.text).slice(0, 8);
  const nameHasAlcohol = alcoholWords.test(name);
  const nameHasTobacco = tobaccoWords.test(name);
  const allText = [name, ...categories.map(item => item.normalized)].join(' ');

  const review = (reason: string): CatalogAgeRestriction => ({
    status: 'review', minimumAge: null, reason, evidence,
  });

  if (alcohol.length && tobacco.length) {
    return review('Catalog categories conflict between alcohol and tobacco. Review the age restriction.');
  }

  if (alcohol.length) {
    if (alcoholException.test(allText) || accessoryOrFood.test(allText)
      || categories.some(item => nonAlcoholCategories.has(item.normalized)) || nameHasTobacco) {
      return review('The alcohol category conflicts with other product details. Review the label and age restriction.');
    }
    return { status: 'restricted', minimumAge: 21,
      reason: 'Catalog category identifies an alcoholic beverage (21+).', evidence };
  }

  if (tobacco.length) {
    if (nicotineException.test(allText) || accessoryOrFood.test(allText) || nameHasAlcohol) {
      return review('The tobacco or nicotine category needs review against the product label.');
    }
    return { status: 'restricted', minimumAge: 21,
      reason: 'Catalog category identifies a tobacco or nicotine product (21+).', evidence };
  }

  // A name is enough to ask for a review, never enough to auto-classify. Keep
  // familiar non-alcoholic food names out of the name-only alcohol heuristic.
  if (nameHasTobacco || (nameHasAlcohol && !alcoholException.test(name))
    || categories.some(item => tobaccoWords.test(item.normalized)
      && !/^(?:food,? beverages and tobacco|food beverages tobacco)$/.test(item.normalized))) {
    return review('The product may require an age restriction, but its catalog category is not specific enough.');
  }

  return { status: 'unknown', minimumAge: null,
    reason: 'No specific age-restricted category was supplied. Keep or review the store age setting.', evidence: [] };
}

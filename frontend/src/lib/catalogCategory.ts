type CatalogCategory = { id: string; name: string };

// Keep this vocabulary deliberate: substring matching can confuse wine with wine
// vinegar, or energy bars with energy drinks. Catalog labels are not product names.
const singularWords: Record<string, string> = {
  beverages: 'beverage', drinks: 'drink', sodas: 'soda', colas: 'cola',
  juices: 'juice', waters: 'water', snacks: 'snack', chips: 'chip',
  chocolates: 'chocolate', candies: 'candy', biscuits: 'biscuit',
  cookies: 'cookie', crackers: 'cracker', cigarettes: 'cigarette',
  cigars: 'cigar', beers: 'beer', wines: 'wine', spirits: 'spirit',
};

function normalize(value: string): string {
  return value.trim().replace(/^[a-z]{2}(?:-[a-z]{2})?:/i, '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
    .trim().split(/\s+/).map(word => singularWords[word] ?? word).join(' ');
}

type BeverageGroup = 'beverage' | 'nonAlcoholic' | 'soda' | 'cola' | 'energy' | 'sports' |
  'juice' | 'fruitJuice' | 'vegetableJuice' | 'water' | 'mineralWater' | 'springWater' | 'sparklingWater' |
  'alcohol' | 'beer' | 'wine' | 'liquor' | 'tobacco' | 'cigarette' | 'cigar' | 'nicotine' | 'vape';
const groups: Record<BeverageGroup, string[]> = {
  beverage: ['beverage', 'drink'],
  nonAlcoholic: ['non alcoholic beverage', 'non alcoholic drink'],
  soda: ['soda', 'soft drink', 'carbonated drink', 'carbonated beverage', 'carbonated soft drink', 'fizzy drink'],
  cola: ['cola', 'cola soft drink', 'cola soda'],
  energy: ['energy drink', 'energy beverage'],
  sports: ['sports drink', 'sport drink', 'isotonic drink'],
  juice: ['juice'],
  fruitJuice: ['fruit juice'],
  vegetableJuice: ['vegetable juice'],
  water: ['water', 'bottled water', 'drinking water'],
  mineralWater: ['mineral water'],
  springWater: ['spring water'],
  sparklingWater: ['sparkling water'],
  alcohol: ['alcohol', 'alcoholic beverage', 'alcoholic drink'],
  beer: ['beer'],
  wine: ['wine'],
  liquor: ['liquor', 'liquor and spirit', 'spirit', 'distilled spirit'],
  tobacco: ['tobacco', 'tobacco products'],
  cigarette: ['cigarette'],
  cigar: ['cigar'],
  nicotine: ['nicotine pouch', 'nicotine pouches'],
  vape: ['vape', 'vapes', 'vaping'],
};
const groupByLabel = new Map<string, BeverageGroup>(
  Object.entries(groups).flatMap(([group, labels]) => labels.map(label => [label, group as BeverageGroup])),
);
const specificity: Record<BeverageGroup, number> = {
  beverage: 1, nonAlcoholic: 2, soda: 3, cola: 4, energy: 3, sports: 3, juice: 3, water: 3,
  fruitJuice: 4, vegetableJuice: 4, mineralWater: 4, springWater: 4, sparklingWater: 4,
  alcohol: 2, beer: 3, wine: 3, liquor: 3, tobacco: 2, cigarette: 3, cigar: 3, nicotine: 3, vape: 3,
};
const parentGroups: Partial<Record<BeverageGroup, BeverageGroup>> = {
  nonAlcoholic: 'beverage', soda: 'nonAlcoholic', cola: 'soda', energy: 'nonAlcoholic',
  sports: 'nonAlcoholic', juice: 'nonAlcoholic', water: 'nonAlcoholic',
  fruitJuice: 'juice', vegetableJuice: 'juice', mineralWater: 'water', springWater: 'water', sparklingWater: 'water',
  alcohol: 'beverage', beer: 'alcohol', wine: 'alcohol', liquor: 'alcohol',
  cigarette: 'tobacco', cigar: 'tobacco', nicotine: 'tobacco', vape: 'tobacco',
};
const broadCategories = new Set(['food', 'food and beverage', 'food beverage and tobacco', 'grocery', 'groceries']);

function acceptsGroup(category: BeverageGroup, suggestion: BeverageGroup): boolean {
  let current: BeverageGroup | undefined = suggestion;
  while (current) {
    if (current === category) return true;
    current = parentGroups[current];
  }
  return false;
}

type Score = [number, number, number];
function compareScores(left: Score, right: Score): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/**
 * Match catalog categories against existing store categories without creating one.
 * Accepts language-tagged labels and provider paths ordered parent > child (or /).
 * Known beverage descendants can fall back to an existing broader department.
 * Equal-confidence alternatives remain unselected for the owner to review.
 */
export function matchCatalogCategory(categories: CatalogCategory[], suggestions: string[]): CatalogCategory | undefined {
  const labels = suggestions.flatMap(suggestion => {
    const path = suggestion.split(/\s*>\s*|\s+\/\s+/).map(normalize).filter(Boolean);
    return path.map((label, index) => ({ label, depth: index - path.length + 1 }));
  });
  let best: { category: CatalogCategory; score: Score } | undefined;
  let ambiguous = false;

  for (const category of categories) {
    const categoryLabel = normalize(category.name);
    if (!categoryLabel) continue;
    const categoryGroup = groupByLabel.get(categoryLabel);
    let categoryScore: Score | undefined;
    for (const { label, depth } of labels) {
      const exact = categoryLabel === label;
      const suggestionGroup = groupByLabel.get(label);
      if (!exact && !(categoryGroup && suggestionGroup && acceptsGroup(categoryGroup, suggestionGroup))) continue;
      const rank = categoryGroup ? specificity[categoryGroup] : broadCategories.has(categoryLabel) ? 0 : 2;
      const score: Score = [depth, rank, exact ? 1 : 0];
      if (!categoryScore || compareScores(score, categoryScore) > 0) categoryScore = score;
    }
    if (!categoryScore) continue;
    const comparison = best ? compareScores(categoryScore, best.score) : 1;
    if (comparison > 0) {
      best = { category, score: categoryScore };
      ambiguous = false;
    } else if (comparison === 0 && best?.category.id !== category.id) {
      ambiguous = true;
    }
  }
  return ambiguous ? undefined : best?.category;
}

/** A reviewable name for a new category, based only on catalog classification. */
export function suggestedCatalogCategory(suggestions: string[]): string | undefined {
  const departments = ['Soda', 'Energy Drinks', 'Sports Drinks', 'Juice', 'Water', 'Beer', 'Wine', 'Liquor', 'Tobacco', 'Cigarettes', 'Cigars', 'Nicotine Pouches', 'Vape', 'Beverages'];
  const match = matchCatalogCategory(departments.map(name => ({ id: name, name })), suggestions);
  if (match) return match.name;
  for (const suggestion of suggestions) {
    const leaf = suggestion.split(/\s*>\s*|\s+\/\s+/).pop()?.trim()
      .replace(/^[a-z]{2}(?:-[a-z]{2})?:/i, '').replace(/-/g, ' ').trim();
    if (leaf) return leaf.charAt(0).toUpperCase() + leaf.slice(1);
  }
  return undefined;
}

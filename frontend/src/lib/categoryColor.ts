/**
 * A steady color for a category that has none of its own: the same category
 * always gets the same hue, so tiles and the category list agree.
 */
export function categoryColor(key: string): string {
  let hash = 0;
  for (let index = 0; index < key.length; index++) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  return `hsl(${hash % 360} 62% 46%)`;
}

/** A category's own color when it is a plain hex value, otherwise its steady generated one. */
export function categoryTint(category: { id?: string; name?: string; color?: string | null } | null | undefined): string | undefined {
  if (!category) return undefined;
  if (category.color && /^#[0-9a-f]{3,8}$/i.test(category.color)) return category.color;
  const key = category.id || category.name;
  return key ? categoryColor(key) : undefined;
}

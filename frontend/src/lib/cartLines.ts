/**
 * How the cart tells its lines apart. A product normally has one line, known by
 * the product's id. Each price-label scan of a deli or scale item is a line of
 * its own, at the price printed on that label: two packages of the same cheese
 * at $4.37 and $6.12 are two lines, never two units at one price.
 */
interface Line { lineId?: string; product: { id: string } }

export const lineKey = (item: Line): string => item.lineId ?? item.product.id;

/** Units of a product in the cart over all of its lines (the number shown on its tile). */
export const quantityOfProduct = (items: (Line & { quantity: number })[], productId: string): number =>
  items.reduce((sum, item) => item.product.id === productId ? sum + item.quantity : sum, 0);

/** The id of one more price-label line for this product, unused by the lines in the cart. */
export function newLineId(items: Line[], productId: string): string {
  for (let number = 1; ; number++) {
    const id = `${productId}:label-${number}`;
    if (!items.some(item => item.lineId === id)) return id;
  }
}

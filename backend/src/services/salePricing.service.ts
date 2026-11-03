import { lineMoney, roundMoney, taxMoney } from '../utils/moneyNumbers';
import { numeric } from '../utils/money';
import { AppError } from '../utils/errorHandler';
import { applyPromotions } from '../utils/promotionEngine';

export function priceSaleItems(items: any[], freshProductMap: Map<string, any>, miscProduct: any, activePromotions: any[], locationTaxRate: number, canOverridePrice: boolean) {
    freshProductMap = new Map([...freshProductMap].map(([id, product]) => [id, numeric(product)]));
    miscProduct = numeric(miscProduct);
    activePromotions = numeric(activePromotions);
    const regularIds = items.filter(i => !i.productId.startsWith('misc-')).map(i => i.productId);
    if (new Set(regularIds).size !== regularIds.length) throw new AppError('Combine quantities of the same product into one line',400);
    for (const product of freshProductMap.values()) if (product.isActive === false) throw new AppError('Product is inactive: ' + product.name,400);
    // Validate and calculate totals using fresh data
    let subtotal = 0;
    let totalTax = 0;
    let totalDiscount = 0;

    // Pre-pass: resolve products and verified prices so promotions evaluate
    // against the same numbers the sale is priced with
    const pricedItems = items.map((item: any, index: number) => {
      const isMisc = !item.productId || item.productId.startsWith('misc-');
      const product = isMisc ? miscProduct : freshProductMap.get(item.productId);

      if (!product) {
        throw new AppError(`Product not found: ${item.productId}. It may have been deleted.`, 404);
      }

      if (!isMisc && product.trackInventory && product.stockQuantity < item.quantity) {
        throw new AppError(
          `Insufficient stock for "${product.name}": requested ${item.quantity}, only ${product.stockQuantity} available`,
          400
        );
      }

      // Use the ACTUAL product price from DB, not the frontend-supplied price
      const verifiedPrice = isMisc ? item.price : product.price;
      // Honor the override flag for manager+ users, and for price-embedded-barcode
      // products (deli/scale items whose price comes from the label, any role)
      const itemPrice =
        item.priceOverride && (canOverridePrice || product.priceEmbedded)
          ? item.price
          : verifiedPrice;

      return { item, isMisc, product, itemPrice, key: String(index) };
    });

    // A pack and its carton are separate sale lines backed by the same stock.
    // Validate their combined base-unit demand before accepting any payment.
    const inventoryDemand = new Map<string, { quantity: number; available: number; name: string }>();
    for (const { item, product, isMisc } of pricedItems) {
      if (isMisc || !product.trackInventory) continue;
      const baseId = product.inventoryProductId || product.id;
      const quantity = item.quantity * (product.sellingUnitId ? product.unitsPerPackage : 1);
      if (!Number.isSafeInteger(quantity) || quantity > 2147483647) throw new AppError('Invalid inventory quantity', 400);
      const prior = inventoryDemand.get(baseId);
      const available = product.baseStockQuantity ?? product.stockQuantity;
      inventoryDemand.set(baseId, { quantity: (prior?.quantity || 0) + quantity, available: Math.min(prior?.available ?? available, available), name: product.name });
    }
    for (const demand of inventoryDemand.values()) if (demand.quantity > demand.available) {
      throw new AppError(`Insufficient shared stock for "${demand.name}": the selected packs and cartons require ${demand.quantity} base units, only ${demand.available} available`, 400);
    }

    // Promotions apply to real catalog items only (misc lines have no identity)
    const promoResults = applyPromotions(
      pricedItems
        .filter((pi: any) => !pi.isMisc)
        .map((pi: any) => ({
          key: pi.key,
          productId: pi.product.id,
          categoryId: pi.product.categoryId,
          unitPrice: pi.itemPrice,
          quantity: pi.item.quantity,
        })),
      activePromotions
    );

    // SNAP/EBT can only pay for eligible items — accumulate their share of the total
    let ebtEligibleTotal = 0;

    const itemsWithDetails = pricedItems.map(({ item, isMisc, product, itemPrice, key }: any) => {
      const itemSubtotal = lineMoney(itemPrice, item.quantity);
      const manualDiscount = roundMoney(Math.min(item.discount || 0, itemSubtotal));
      const promo = promoResults.get(key);
      // Combined discount can't exceed the line total; the promo portion absorbs the clamp
      const itemDiscount = roundMoney(Math.min(manualDiscount + (promo?.discount || 0), itemSubtotal));
      const promoDiscount = roundMoney(itemDiscount - manualDiscount);
      const itemTotal = roundMoney(itemSubtotal - itemDiscount);

      let itemTax = 0;
      if (product.isTaxable) {
        itemTax = taxMoney(itemTotal, locationTaxRate);
      }

      subtotal += itemSubtotal;
      totalDiscount += itemDiscount;
      totalTax += itemTax;
      if (!isMisc && product.ebtEligible) {
        ebtEligibleTotal += itemTotal;
      }

      return {
        productId: product.inventoryProductId || product.id,
        sellingUnitId: product.sellingUnitId || null,
        unitsPerPackage: product.sellingUnitId ? product.unitsPerPackage : 1,
        inventoryQuantity: item.quantity * (product.sellingUnitId ? product.unitsPerPackage : 1),
        sku: isMisc ? 'MISC' : product.sku,
        productName: isMisc ? (item.name || 'Misc Item') : product.name,
        unitCost: !isMisc && Number.isFinite(product.cost) && product.cost > 0 ? product.cost : null,
        taxRate: product.isTaxable ? locationTaxRate : 0,
        taxTreatment: product.isTaxable ? 'STANDARD' : 'EXEMPT',
        manualDiscount,
        quantity: item.quantity,
        price: itemPrice,
        discount: itemDiscount,
        tax: itemTax,
        total: itemTotal + itemTax,
        notes: item.notes,
        promotionId: promoDiscount > 0 ? promo!.promotionId : null,
        promotionName: promoDiscount > 0 ? promo!.promotionName : null,
        promotionDiscount: promoDiscount,
      };
    });

    // Round all monetary values to 2 decimal places
    subtotal = Math.round(subtotal * 100) / 100;
    totalDiscount = Math.round(totalDiscount * 100) / 100;
    totalTax = Math.round(totalTax * 100) / 100;
    let total = Math.round(Math.max(0, subtotal - totalDiscount + totalTax) * 100) / 100;


  return { subtotal, totalTax, totalDiscount, total, ebtEligibleTotal, itemsWithDetails };
}

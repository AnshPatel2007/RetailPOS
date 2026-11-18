import { ExpenseCategory } from '@prisma/client';

// The POS already recognizes merchandise cost through original sale-line COGS.
// Buying that merchandise must not deduct its cost a second time in P&L.
// This classifies recorded purchases; it does not create stock or mark bills paid.
export const inventoryPurchaseCategory = ExpenseCategory.INVENTORY_PURCHASE;
export const isInventoryPurchase = (category: string) => category === inventoryPurchaseCategory;
export const expenseDebitAccount = (category: string) => isInventoryPurchase(category) ? 'Inventory Asset' : `Expense - ${category}`;

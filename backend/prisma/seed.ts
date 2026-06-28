import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Create default location
  const location = await prisma.location.create({
    data: {
      name: 'Main Store',
      address: '123 Main Street',
      city: 'New York',
      state: 'NY',
      zipCode: '10001',
      country: 'US',
      phone: '(555) 123-4567',
      email: 'store@pos.com',
      taxRate: 8.875,
      businessHours: {
        monday: { open: '09:00', close: '18:00' },
        tuesday: { open: '09:00', close: '18:00' },
        wednesday: { open: '09:00', close: '18:00' },
        thursday: { open: '09:00', close: '18:00' },
        friday: { open: '09:00', close: '20:00' },
        saturday: { open: '10:00', close: '20:00' },
        sunday: { open: '11:00', close: '17:00' },
      },
    },
  });

  console.log('✅ Created location:', location.name);

  // Create users
  const hashedPassword = await bcrypt.hash('admin123', 10);
  const hashedPasswordManager = await bcrypt.hash('manager123', 10);
  const hashedPasswordCashier = await bcrypt.hash('cashier123', 10);
  const hashedPasswordSuperAdmin = await bcrypt.hash('superadmin123', 10);

  // Create Super Admin (no location - can manage all stores)
  const superAdmin = await prisma.user.create({
    data: {
      email: 'superadmin@pos.com',
      password: hashedPasswordSuperAdmin,
      firstName: 'Super',
      lastName: 'Admin',
      role: UserRole.SUPER_ADMIN,
      locationId: null,
    },
  });

  console.log('✅ Created super admin:', superAdmin.email);

  const admin = await prisma.user.create({
    data: {
      email: 'admin@pos.com',
      password: hashedPassword,
      firstName: 'Admin',
      lastName: 'User',
      role: UserRole.ADMIN,
      locationId: location.id,
    },
  });

  const manager = await prisma.user.create({
    data: {
      email: 'manager@pos.com',
      password: hashedPasswordManager,
      firstName: 'Manager',
      lastName: 'User',
      role: UserRole.MANAGER,
      locationId: location.id,
    },
  });

  const cashier = await prisma.user.create({
    data: {
      email: 'cashier@pos.com',
      password: hashedPasswordCashier,
      firstName: 'Cashier',
      lastName: 'User',
      role: UserRole.CASHIER,
      locationId: location.id,
    },
  });

  console.log('✅ Created users:', admin.email, manager.email, cashier.email);

  // Create categories
  const electronics = await prisma.category.create({
    data: {
      name: 'Electronics',
      description: 'Electronic devices and accessories',
      color: '#3B82F6',
      icon: 'laptop',
      sortOrder: 1,
    },
  });

  const clothing = await prisma.category.create({
    data: {
      name: 'Clothing',
      description: 'Apparel and fashion items',
      color: '#EC4899',
      icon: 'shirt',
      sortOrder: 2,
    },
  });

  const food = await prisma.category.create({
    data: {
      name: 'Food & Beverage',
      description: 'Food and drink items',
      color: '#10B981',
      icon: 'coffee',
      sortOrder: 3,
    },
  });

  console.log('✅ Created categories');

  // Create products
  const products = await prisma.product.createMany({
    data: [
      // Electronics
      {
        sku: 'ELEC-001',
        name: 'Wireless Mouse',
        description: 'Ergonomic wireless mouse with USB receiver',
        categoryId: electronics.id,
        cost: 15.00,
        price: 29.99,
        stockQuantity: 50,
        lowStockAlert: 10,
        barcode: '123456789001',
        locationId: location.id,
        isTaxable: true,
      },
      {
        sku: 'ELEC-002',
        name: 'USB-C Cable',
        description: '6ft USB-C charging cable',
        categoryId: electronics.id,
        cost: 5.00,
        price: 14.99,
        stockQuantity: 100,
        lowStockAlert: 20,
        barcode: '123456789002',
        locationId: location.id,
        isTaxable: true,
      },
      {
        sku: 'ELEC-003',
        name: 'Bluetooth Headphones',
        description: 'Noise-cancelling over-ear headphones',
        categoryId: electronics.id,
        cost: 50.00,
        price: 99.99,
        compareAtPrice: 129.99,
        stockQuantity: 25,
        lowStockAlert: 5,
        barcode: '123456789003',
        locationId: location.id,
        isTaxable: true,
      },
      // Clothing
      {
        sku: 'CLO-001',
        name: 'Cotton T-Shirt',
        description: 'Classic crew neck t-shirt',
        categoryId: clothing.id,
        cost: 8.00,
        price: 19.99,
        stockQuantity: 75,
        lowStockAlert: 15,
        barcode: '123456789004',
        locationId: location.id,
        isTaxable: true,
      },
      {
        sku: 'CLO-002',
        name: 'Denim Jeans',
        description: 'Classic fit denim jeans',
        categoryId: clothing.id,
        cost: 25.00,
        price: 59.99,
        stockQuantity: 40,
        lowStockAlert: 10,
        barcode: '123456789005',
        locationId: location.id,
        isTaxable: true,
      },
      // Food & Beverage
      {
        sku: 'FOOD-001',
        name: 'Bottled Water',
        description: '16.9oz purified water',
        categoryId: food.id,
        cost: 0.50,
        price: 1.99,
        stockQuantity: 200,
        lowStockAlert: 50,
        barcode: '123456789006',
        locationId: location.id,
        isTaxable: false,
      },
      {
        sku: 'FOOD-002',
        name: 'Energy Bar',
        description: 'Chocolate chip protein bar',
        categoryId: food.id,
        cost: 1.00,
        price: 2.99,
        stockQuantity: 150,
        lowStockAlert: 30,
        barcode: '123456789007',
        locationId: location.id,
        isTaxable: false,
      },
      {
        sku: 'FOOD-003',
        name: 'Coffee - Medium Roast',
        description: 'Premium ground coffee 12oz',
        categoryId: food.id,
        cost: 6.00,
        price: 12.99,
        stockQuantity: 60,
        lowStockAlert: 15,
        barcode: '123456789008',
        locationId: location.id,
        isTaxable: false,
      },
    ],
  });

  // Create MISC product for ad-hoc charges
  await prisma.product.create({
    data: {
      sku: 'MISC-001',
      name: 'Misc Item',
      description: 'Miscellaneous / ad-hoc item',
      cost: 0,
      price: 0,
      stockQuantity: 0,
      lowStockAlert: 0,
      trackInventory: false,
      isTaxable: true,
      locationId: location.id,
    },
  });

  console.log('✅ Created', products.count + 1, 'products (including MISC)');

  // Create customers
  await prisma.customer.create({
    data: {
      email: 'john.doe@email.com',
      phone: '(555) 111-2222',
      firstName: 'John',
      lastName: 'Doe',
      address: '456 Oak Avenue',
      city: 'New York',
      state: 'NY',
      zipCode: '10002',
      emailMarketing: true,
      loyaltyPoints: 150,
      totalSpent: 450.75,
      visitCount: 12,
    },
  });

  await prisma.customer.create({
    data: {
      email: 'jane.smith@email.com',
      phone: '(555) 333-4444',
      firstName: 'Jane',
      lastName: 'Smith',
      address: '789 Pine Street',
      city: 'New York',
      state: 'NY',
      zipCode: '10003',
      emailMarketing: true,
      smsMarketing: true,
      loyaltyPoints: 300,
      totalSpent: 890.50,
      visitCount: 25,
    },
  });

  console.log('✅ Created customers');

  // Create suppliers
  await prisma.supplier.create({
    data: {
      name: 'Tech Supplies Inc.',
      contactName: 'Robert Johnson',
      email: 'sales@techsupplies.com',
      phone: '(555) 999-8888',
      address: '100 Industrial Park, Austin, TX 78701',
    },
  });

  await prisma.supplier.create({
    data: {
      name: 'Fashion Wholesale Co.',
      contactName: 'Sarah Williams',
      email: 'orders@fashionwholesale.com',
      phone: '(555) 777-6666',
      address: '250 Garment District, Los Angeles, CA 90014',
    },
  });

  console.log('✅ Created suppliers');

  // Create tax rates
  await prisma.taxRate.createMany({
    data: [
      {
        name: 'Standard Tax',
        rate: 8.875,
        isDefault: true,
      },
      {
        name: 'Reduced Tax',
        rate: 4.0,
        isDefault: false,
      },
      {
        name: 'No Tax',
        rate: 0,
        isDefault: false,
      },
    ],
  });

  console.log('✅ Created tax rates');

  // Create discounts
  await prisma.discount.createMany({
    data: [
      {
        code: 'WELCOME10',
        name: '10% Off First Purchase',
        description: 'New customer discount',
        type: 'PERCENTAGE',
        value: 10,
        isActive: true,
      },
      {
        code: 'SAVE20',
        name: '$20 Off $100+',
        description: 'Save $20 on orders over $100',
        type: 'FIXED',
        value: 20,
        minPurchase: 100,
        isActive: true,
      },
    ],
  });

  console.log('✅ Created discounts');

  // Create settings
  await prisma.setting.createMany({
    data: [
      {
        key: 'receipt_footer',
        value: 'Thank you for your business!',
        description: 'Footer text on receipts',
      },
      {
        key: 'low_stock_notification',
        value: true,
        description: 'Enable low stock notifications',
      },
      {
        key: 'loyalty_points_rate',
        value: 1,
        description: 'Points earned per dollar spent',
      },
    ],
  });

  console.log('✅ Created settings');

  console.log('🎉 Database seeded successfully!');
  console.log('\n📝 Login credentials:');
  console.log('Admin: admin@pos.com / admin123');
  console.log('Manager: manager@pos.com / manager123');
  console.log('Cashier: cashier@pos.com / cashier123');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

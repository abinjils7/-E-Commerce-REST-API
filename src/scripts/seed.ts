import bcrypt from 'bcrypt';
import { env } from '../config/env';
import { connectDB, disconnectDB, ensureIndexes } from '../config/db';
import { logger } from '../config/logger';
import { User } from '../models/user.model';
import { Category } from '../models/category.model';
import { Product } from '../models/product.model';

export const seedDatabase = async (): Promise<void> => {
  logger.info('Starting database seeding...');
  await connectDB(env.MONGODB_URI);
  await ensureIndexes();

  // 1. Create or update Default Admin (idempotent, uses env.ADMIN_EMAIL & env.ADMIN_PASSWORD)
  const adminPasswordHash = await bcrypt.hash(env.ADMIN_PASSWORD, env.BCRYPT_SALT_ROUNDS);
  const adminUser = await User.findOneAndUpdate(
    { email: env.ADMIN_EMAIL.toLowerCase().trim() },
    {
      $set: {
        name: 'System Administrator',
        email: env.ADMIN_EMAIL.toLowerCase().trim(),
        passwordHash: adminPasswordHash,
        role: 'admin',
        isActive: true,
      },
    },
    { upsert: true, new: true }
  );

  logger.info(`Admin seeded: ${adminUser.email} (admin)`);

  // 2. Create Multi-level Category Tree idempotently
  let electronics = await Category.findOne({ slug: 'electronics' });
  if (!electronics) {
    electronics = await Category.create({
      name: 'Electronics',
      slug: 'electronics',
      description: 'Electronic devices and personal computing',
      parent: null,
      ancestors: [],
      isActive: true,
    });
  }

  let computers = await Category.findOne({ slug: 'computers-laptops' });
  if (!computers) {
    computers = await Category.create({
      name: 'Computers & Laptops',
      slug: 'computers-laptops',
      description: 'Desktops, laptops, and workstations',
      parent: electronics._id,
      ancestors: [electronics._id],
      isActive: true,
    });
  }

  let laptops = await Category.findOne({ slug: 'laptops' });
  if (!laptops) {
    laptops = await Category.create({
      name: 'Laptops',
      slug: 'laptops',
      description: 'Portable computing devices',
      parent: computers._id,
      ancestors: [electronics._id, computers._id],
      isActive: true,
    });
  }

  let gamingLaptops = await Category.findOne({ slug: 'gaming-laptops' });
  if (!gamingLaptops) {
    gamingLaptops = await Category.create({
      name: 'Gaming Laptops',
      slug: 'gaming-laptops',
      description: 'High-performance laptops for gaming and intensive workloads',
      parent: laptops._id,
      ancestors: [electronics._id, computers._id, laptops._id],
      isActive: true,
    });
  }

  let smartphones = await Category.findOne({ slug: 'smartphones' });
  if (!smartphones) {
    smartphones = await Category.create({
      name: 'Smartphones',
      slug: 'smartphones',
      description: 'Mobile smartphones and cellular phones',
      parent: electronics._id,
      ancestors: [electronics._id],
      isActive: true,
    });
  }

  logger.info('Categories seeded/verified');

  // 3. Create Sample Products idempotently
  const sampleProducts = [
    {
      name: 'Pro Gaming Laptop 16-inch',
      sku: 'LAP-GAMING-001',
      description: 'Flagship RTX 4080 Gaming Laptop with 32GB RAM and 1TB SSD',
      price: 18999900,
      salePrice: 17499900,
      stock: 15,
      category: gamingLaptops._id,
      status: 'active' as const,
    },
    {
      name: 'Ultraportable Laptop 14-inch',
      sku: 'LAP-ULTRA-002',
      description: 'Lightweight ultrabook with 16-hour battery life and 16GB RAM',
      price: 8999900,
      salePrice: undefined,
      stock: 25,
      category: laptops._id,
      status: 'active' as const,
    },
    {
      name: 'Flagship Smartphone Pro 256GB',
      sku: 'PHN-FLAGSHIP-001',
      description: 'Premium smartphone with titanium chassis and triple camera system',
      price: 11999900,
      salePrice: 10999900,
      stock: 40,
      category: smartphones._id,
      status: 'active' as const,
    },
    {
      name: 'Budget Smartphone 64GB',
      sku: 'PHN-BUDGET-002',
      description: 'Reliable everyday smartphone with 5000mAh battery',
      price: 1499900,
      salePrice: undefined,
      stock: 0,
      category: smartphones._id,
      status: 'active' as const,
    },
    {
      name: 'Legacy Desktop Workstation',
      sku: 'DSK-LEGACY-003',
      description: 'Discontinued legacy desktop tower',
      price: 4999900,
      salePrice: undefined,
      stock: 2,
      category: computers._id,
      status: 'inactive' as const,
    },
  ];

  for (const prod of sampleProducts) {
    await Product.findOneAndUpdate(
      { sku: prod.sku },
      {
        $set: {
          name: prod.name,
          sku: prod.sku,
          description: prod.description,
          price: prod.price,
          salePrice: prod.salePrice,
          effectivePrice: prod.salePrice ?? prod.price,
          stock: prod.stock,
          category: prod.category,
          status: prod.status,
        },
      },
      { upsert: true, new: true }
    );
  }

  logger.info('Sample products seeded/verified');
  logger.info('Database seeding completed successfully.');
};

if (require.main === module) {
  seedDatabase()
    .then(async () => {
      await disconnectDB();
      process.exit(0);
    })
    .catch(async (error) => {
      logger.fatal({ error }, 'Database seeding failed');
      await disconnectDB();
      process.exit(1);
    });
}

import { Types } from 'mongoose';
import { Product, IProductDocument, calculateEffectivePrice } from '../../models/product.model';
import { Category } from '../../models/category.model';
import { AppError } from '../../utils/AppError';
import {
  CreateProductInput,
  UpdateProductInput,
  AdjustStockInput,
  CustomerProductQueryInput,
  AdminProductQueryInput,
} from './product.schema';
import { buildProductQuery } from './product.query';
import { getPagination, buildPaginationMeta, PaginationMeta } from '../../utils/pagination';

export interface CustomerProductItem {
  id: string;
  name: string;
  sku: string;
  description: string;
  price: number;
  salePrice?: number;
  effectivePrice: number;
  stock: number;
  inStock: boolean;
  category: Types.ObjectId | string;
  status: 'active' | 'inactive';
  createdAt: Date;
  updatedAt: Date;
}

export const mapCustomerProduct = (product: IProductDocument): CustomerProductItem => ({
  id: product._id.toString(),
  name: product.name,
  sku: product.sku,
  description: product.description,
  price: product.price,
  salePrice: product.salePrice,
  effectivePrice: product.effectivePrice,
  stock: product.stock,
  inStock: product.stock > 0,
  category: product.category,
  status: product.status,
  createdAt: product.createdAt,
  updatedAt: product.updatedAt,
});

export class ProductService {
  async createProduct(input: CreateProductInput): Promise<IProductDocument> {
    const categoryId = new Types.ObjectId(input.category);
    const category = await Category.findById(categoryId);
    if (!category) {
      throw AppError.badRequest('Category does not exist');
    }
    if (!category.isActive) {
      throw AppError.badRequest('Cannot add product to an inactive category');
    }

    const effectivePrice = calculateEffectivePrice(input.price, input.salePrice);

    try {
      const product = await Product.create({
        name: input.name.trim(),
        sku: input.sku.toUpperCase().trim(),
        description: input.description.trim(),
        price: input.price,
        salePrice: input.salePrice ?? undefined,
        effectivePrice,
        stock: input.stock,
        category: categoryId,
        status: input.status ?? 'active',
      });

      return product;
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: number }).code === 11000
      ) {
        throw AppError.conflict(`Product with SKU '${input.sku.toUpperCase()}' already exists`);
      }
      throw error;
    }
  }

  async updateProduct(id: string, input: UpdateProductInput): Promise<IProductDocument> {
    const product = await Product.findById(id);
    if (!product) {
      throw AppError.notFound('Product not found');
    }

    if (input.category) {
      const categoryId = new Types.ObjectId(input.category);
      const category = await Category.findById(categoryId);
      if (!category) {
        throw AppError.badRequest('Category does not exist');
      }
      if (!category.isActive) {
        throw AppError.badRequest('Cannot assign product to an inactive category');
      }
      product.category = categoryId;
    }

    if (input.price !== undefined || input.salePrice !== undefined) {
      const newPrice = input.price !== undefined ? input.price : product.price;
      const newSalePrice = input.salePrice !== undefined ? input.salePrice : product.salePrice;

      if (newSalePrice !== null && newSalePrice !== undefined && newSalePrice > newPrice) {
        throw AppError.badRequest('salePrice cannot be greater than original price');
      }

      product.price = newPrice;
      product.salePrice = newSalePrice === null ? undefined : newSalePrice;
      product.effectivePrice = calculateEffectivePrice(newPrice, newSalePrice);
    }

    if (input.name) product.name = input.name.trim();
    if (input.sku) product.sku = input.sku.toUpperCase().trim();
    if (input.description) product.description = input.description.trim();
    if (input.status) product.status = input.status;

    try {
      await product.save();
      return product;
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: number }).code === 11000
      ) {
        throw AppError.conflict(`Product with SKU '${input.sku?.toUpperCase()}' already exists`);
      }
      throw error;
    }
  }

  async adjustStock(id: string, input: AdjustStockInput): Promise<IProductDocument> {
    const { adjustBy } = input;

    let query: Record<string, unknown> = { _id: id };
    if (adjustBy < 0) {
      query = {
        _id: id,
        stock: { $gte: Math.abs(adjustBy) },
      };
    }

    const updated = await Product.findOneAndUpdate(
      query,
      { $inc: { stock: adjustBy } },
      { new: true }
    );

    if (!updated) {
      const exists = await Product.findById(id);
      if (!exists) {
        throw AppError.notFound('Product not found');
      }
      throw AppError.conflict(
        `Insufficient stock for adjustment: current stock (${exists.stock}) cannot be reduced by ${Math.abs(adjustBy)}`
      );
    }

    return updated;
  }

  async deleteProduct(id: string): Promise<IProductDocument> {
    const product = await Product.findById(id);
    if (!product) {
      throw AppError.notFound('Product not found');
    }

    // Soft delete: status=inactive per spec
    product.status = 'inactive';
    await product.save();

    return product;
  }

  async getProductsForCustomers(
    query: CustomerProductQueryInput
  ): Promise<{ data: CustomerProductItem[]; meta: PaginationMeta }> {
    const { page, limit, skip } = getPagination({
      page: query.page,
      limit: query.limit,
      defaultLimit: 12,
      maxLimit: 50,
    });

    let categoryIds: Types.ObjectId[] | undefined;
    if (query.category) {
      const rootCatId = new Types.ObjectId(query.category);
      // Category filter includes ALL descendants
      const descendants = await Category.find({ ancestors: rootCatId }, { _id: 1 }).lean();
      categoryIds = [rootCatId, ...descendants.map((d) => d._id as Types.ObjectId)];
    }

    const { filter, sort } = buildProductQuery(
      {
        status: 'active',
        categoryIds,
        search: query.search,
        minPrice: query.minPrice,
        maxPrice: query.maxPrice,
        inStock: query.inStock,
      },
      query.sort
    );

    const [products, total] = await Promise.all([
      Product.find(filter).sort(sort).skip(skip).limit(limit),
      Product.countDocuments(filter),
    ]);

    return {
      data: products.map(mapCustomerProduct),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async getProductsForAdmin(
    query: AdminProductQueryInput
  ): Promise<{ data: IProductDocument[]; meta: PaginationMeta }> {
    const { page, limit, skip } = getPagination({
      page: query.page,
      limit: query.limit,
      defaultLimit: 20,
      maxLimit: 50,
    });

    let categoryIds: Types.ObjectId[] | undefined;
    if (query.category) {
      const rootCatId = new Types.ObjectId(query.category);
      const descendants = await Category.find({ ancestors: rootCatId }, { _id: 1 }).lean();
      categoryIds = [rootCatId, ...descendants.map((d) => d._id as Types.ObjectId)];
    }

    const { filter, sort } = buildProductQuery(
      {
        status: query.status,
        categoryIds,
        search: query.search,
        minPrice: query.minPrice,
        maxPrice: query.maxPrice,
        inStock: query.inStock,
      },
      query.sort
    );

    const [products, total] = await Promise.all([
      Product.find(filter).sort(sort).skip(skip).limit(limit),
      Product.countDocuments(filter),
    ]);

    return {
      data: products,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async getProductById(id: string): Promise<CustomerProductItem> {
    const product = await Product.findById(id);
    if (!product || product.status === 'inactive') {
      throw AppError.notFound('Product not found');
    }

    return mapCustomerProduct(product);
  }
}

export const productService = new ProductService();

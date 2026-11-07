import { Types } from 'mongoose';

export type ProductSortOption = 'price_asc' | 'price_desc' | 'newest' | 'name_asc';

export interface ProductQueryFilters {
  search?: string;
  categoryIds?: (Types.ObjectId | string)[];
  minPrice?: number; // in paise
  maxPrice?: number; // in paise
  status?: 'active' | 'inactive';
  inStock?: boolean;
}

export interface BuiltProductQuery {
  filter: Record<string, unknown>;
  sort: Record<string, 1 | -1>;
}

export const SORT_MAP: Record<ProductSortOption, Record<string, 1 | -1>> = {
  price_asc: { effectivePrice: 1, _id: 1 },
  price_desc: { effectivePrice: -1, _id: 1 },
  newest: { createdAt: -1, _id: 1 },
  name_asc: { name: 1, _id: 1 },
};

export const DEFAULT_SORT: Record<string, 1 | -1> = { createdAt: -1, _id: 1 };

/**
 * Pure function to construct MongoDB filter and sort objects from input parameters.
 */
export const buildProductQuery = (
  filters: ProductQueryFilters,
  sortOption?: ProductSortOption
): BuiltProductQuery => {
  const filter: Record<string, unknown> = {};

  // Status constraint
  if (filters.status) {
    filter.status = filters.status;
  }

  // Category filter (includes category and all its descendants)
  if (filters.categoryIds && filters.categoryIds.length > 0) {
    filter.category = {
      $in: filters.categoryIds.map((id) => (typeof id === 'string' ? new Types.ObjectId(id) : id)),
    };
  }

  // Full-text search
  if (filters.search && filters.search.trim().length > 0) {
    filter.$text = { $search: filters.search.trim() };
  }

  // Price range on effectivePrice (in paise)
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    const priceFilter: Record<string, number> = {};
    if (filters.minPrice !== undefined) {
      priceFilter.$gte = filters.minPrice;
    }
    if (filters.maxPrice !== undefined) {
      priceFilter.$lte = filters.maxPrice;
    }
    filter.effectivePrice = priceFilter;
  }

  // Stock availability filter
  if (filters.inStock !== undefined) {
    filter.stock = filters.inStock ? { $gt: 0 } : { $lte: 0 };
  }

  // Whitelisted sort with safe default
  const sort = sortOption && SORT_MAP[sortOption] ? SORT_MAP[sortOption] : DEFAULT_SORT;

  return { filter, sort };
};

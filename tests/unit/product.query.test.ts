import { Types } from 'mongoose';
import {
  buildProductQuery,
  SORT_MAP,
  DEFAULT_SORT,
  ProductSortOption,
} from '../../src/modules/products/product.query';

describe('Product Query Builder (Pure Unit Tests)', () => {
  it('returns empty filter and default newest sort when no filters are provided', () => {
    const result = buildProductQuery({});
    expect(result.filter).toEqual({});
    expect(result.sort).toEqual(DEFAULT_SORT);
    expect(result.sort).toEqual({ createdAt: -1, _id: 1 });
  });

  it('applies status constraint when specified', () => {
    const activeResult = buildProductQuery({ status: 'active' });
    expect(activeResult.filter).toEqual({ status: 'active' });

    const inactiveResult = buildProductQuery({ status: 'inactive' });
    expect(inactiveResult.filter).toEqual({ status: 'inactive' });
  });

  it('builds category $in filter for category IDs and descendants', () => {
    const id1 = new Types.ObjectId();
    const id2 = new Types.ObjectId().toString();

    const result = buildProductQuery({ categoryIds: [id1, id2] });
    expect(result.filter).toHaveProperty('category');
    expect(result.filter.category).toEqual({
      $in: [id1, new Types.ObjectId(id2)],
    });
  });

  it('builds full-text search constraint using $text index', () => {
    const result = buildProductQuery({ search: 'gaming laptop' });
    expect(result.filter).toHaveProperty('$text');
    expect(result.filter.$text).toEqual({ $search: 'gaming laptop' });
  });

  it('ignores empty or whitespace-only search queries', () => {
    const result = buildProductQuery({ search: '   ' });
    expect(result.filter).not.toHaveProperty('$text');
  });

  describe('Effective price filtering ($gte and $lte in paise)', () => {
    it('applies minPrice correctly', () => {
      const result = buildProductQuery({ minPrice: 5000 });
      expect(result.filter.effectivePrice).toEqual({ $gte: 5000 });
    });

    it('applies maxPrice correctly', () => {
      const result = buildProductQuery({ maxPrice: 15000 });
      expect(result.filter.effectivePrice).toEqual({ $lte: 15000 });
    });

    it('combines minPrice and maxPrice correctly', () => {
      const result = buildProductQuery({ minPrice: 5000, maxPrice: 15000 });
      expect(result.filter.effectivePrice).toEqual({ $gte: 5000, $lte: 15000 });
    });
  });

  describe('Stock availability filtering (inStock flag)', () => {
    it('filters for in-stock items (stock > 0)', () => {
      const result = buildProductQuery({ inStock: true });
      expect(result.filter.stock).toEqual({ $gt: 0 });
    });

    it('filters for out-of-stock items (stock <= 0)', () => {
      const result = buildProductQuery({ inStock: false });
      expect(result.filter.stock).toEqual({ $lte: 0 });
    });
  });

  describe('Sort options and fallback whitelist', () => {
    it('maps all whitelisted sort options accurately', () => {
      expect(buildProductQuery({}, 'price_asc').sort).toEqual(SORT_MAP.price_asc);
      expect(buildProductQuery({}, 'price_desc').sort).toEqual(SORT_MAP.price_desc);
      expect(buildProductQuery({}, 'newest').sort).toEqual(SORT_MAP.newest);
      expect(buildProductQuery({}, 'name_asc').sort).toEqual(SORT_MAP.name_asc);
    });

    it('safely falls back to DEFAULT_SORT ({ createdAt: -1 }) for invalid sort option', () => {
      const invalidSort = 'unsupported_sort' as unknown as ProductSortOption;
      const result = buildProductQuery({}, invalidSort);
      expect(result.sort).toEqual(DEFAULT_SORT);
      expect(result.sort).toEqual({ createdAt: -1, _id: 1 });
    });
  });
});

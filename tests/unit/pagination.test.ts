import {
  parsePagination,
  getPagination,
  buildPaginationMeta,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from '../../src/utils/pagination';

describe('Pagination Utility', () => {
  describe('parsePagination / getPagination', () => {
    it('uses defaults when no options are provided', () => {
      const result = parsePagination();
      expect(result.page).toBe(DEFAULT_PAGE);
      expect(result.limit).toBe(DEFAULT_LIMIT);
      expect(result.skip).toBe(0);
    });

    it('calculates skip accurately for valid page and limit', () => {
      const result = parsePagination({ page: 3, limit: 20 });
      expect(result.page).toBe(3);
      expect(result.limit).toBe(20);
      expect(result.skip).toBe(40);
    });

    it('caps limit at MAX_LIMIT (50)', () => {
      const result = parsePagination({ page: 1, limit: 100 });
      expect(result.limit).toBe(MAX_LIMIT);
    });

    it('handles negative or invalid values gracefully', () => {
      const result = parsePagination({ page: -5, limit: -10 });
      expect(result.page).toBe(1);
      expect(result.limit).toBe(1);
      expect(result.skip).toBe(0);
    });

    it('respects custom defaultLimit and maxLimit when provided', () => {
      const result = parsePagination({ limit: 40, maxLimit: 25, defaultLimit: 15 });
      expect(result.limit).toBe(25);
    });

    it('alias getPagination functions identically', () => {
      expect(getPagination).toBe(parsePagination);
    });
  });

  describe('buildPaginationMeta', () => {
    it('builds metadata accurately', () => {
      const meta = buildPaginationMeta(45, 2, 10);
      expect(meta).toEqual({
        total: 45,
        page: 2,
        limit: 10,
        totalPages: 5,
      });
    });

    it('handles 0 total records', () => {
      const meta = buildPaginationMeta(0, 1, 10);
      expect(meta).toEqual({
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 0,
      });
    });

    it('handles exact division', () => {
      const meta = buildPaginationMeta(50, 1, 10);
      expect(meta.totalPages).toBe(5);
    });
  });
});

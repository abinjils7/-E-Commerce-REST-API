import {
  toMinorUnits,
  toMajorUnits,
  formatMoney,
  isValidMinorUnit,
  calculateLineTotal,
} from '../../src/utils/money';

describe('Money Utility', () => {
  describe('toMinorUnits', () => {
    it('converts major units (rupees/dollars) to minor units (paise/cents)', () => {
      expect(toMinorUnits(10.5)).toBe(1050);
      expect(toMinorUnits(0)).toBe(0);
      expect(toMinorUnits(99.99)).toBe(9999);
      expect(toMinorUnits(100)).toBe(10000);
    });

    it('handles floating point precision safely', () => {
      // In JS, 0.1 + 0.2 = 0.30000000000000004
      expect(toMinorUnits(0.29)).toBe(29);
      expect(toMinorUnits(19.99)).toBe(1999);
    });

    it('throws error for negative or invalid numbers', () => {
      expect(() => toMinorUnits(-5)).toThrow('Major units must be a non-negative finite number');
      expect(() => toMinorUnits(NaN)).toThrow('Major units must be a non-negative finite number');
      expect(() => toMinorUnits(Infinity)).toThrow(
        'Major units must be a non-negative finite number'
      );
    });
  });

  describe('toMajorUnits', () => {
    it('converts minor units to major units', () => {
      expect(toMajorUnits(1050)).toBe(10.5);
      expect(toMajorUnits(0)).toBe(0);
      expect(toMajorUnits(9999)).toBe(99.99);
      expect(toMajorUnits(10000)).toBe(100);
    });

    it('throws error for non-integer or negative values', () => {
      expect(() => toMajorUnits(-100)).toThrow('Minor units must be a non-negative integer');
      expect(() => toMajorUnits(10.5)).toThrow('Minor units must be a non-negative integer');
    });
  });

  describe('formatMoney', () => {
    it('formats minor units to currency string representation', () => {
      const formatted = formatMoney(1050, 'INR');
      expect(formatted).toContain('10.50');
    });
  });

  describe('isValidMinorUnit', () => {
    it('validates positive integers', () => {
      expect(isValidMinorUnit(0)).toBe(true);
      expect(isValidMinorUnit(100)).toBe(true);
      expect(isValidMinorUnit(50000)).toBe(true);
    });

    it('rejects invalid inputs', () => {
      expect(isValidMinorUnit(-10)).toBe(false);
      expect(isValidMinorUnit(10.5)).toBe(false);
      expect(isValidMinorUnit('100')).toBe(false);
      expect(isValidMinorUnit(null)).toBe(false);
      expect(isValidMinorUnit(undefined)).toBe(false);
    });
  });

  describe('calculateLineTotal', () => {
    it('calculates total for unitPrice and quantity correctly', () => {
      expect(calculateLineTotal(1000, 2)).toBe(2000);
      expect(calculateLineTotal(499, 3)).toBe(1497);
      expect(calculateLineTotal(0, 5)).toBe(0);
    });

    it('throws error for invalid unit price or quantity', () => {
      expect(() => calculateLineTotal(-10, 2)).toThrow();
      expect(() => calculateLineTotal(100, 0)).toThrow();
      expect(() => calculateLineTotal(100, -1)).toThrow();
      expect(() => calculateLineTotal(10.5, 2)).toThrow();
    });
  });
});

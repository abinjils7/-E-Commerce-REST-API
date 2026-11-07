/**
 * Money utility for dealing with integer minor units (e.g. paise/cents).
 * Guarantees no floating-point arithmetic inaccuracies occur in business logic or database storage.
 */

export const toMinorUnits = (majorUnits: number): number => {
  if (typeof majorUnits !== 'number' || !Number.isFinite(majorUnits) || majorUnits < 0) {
    throw new Error('Major units must be a non-negative finite number');
  }
  return Math.round(majorUnits * 100);
};

export const toMajorUnits = (minorUnits: number): number => {
  if (!Number.isInteger(minorUnits) || minorUnits < 0) {
    throw new Error('Minor units must be a non-negative integer');
  }
  return Number((minorUnits / 100).toFixed(2));
};

export const formatMoney = (minorUnits: number, currency: string = 'INR'): string => {
  const major = toMajorUnits(minorUnits);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
  }).format(major);
};

export const isValidMinorUnit = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
};

export const calculateLineTotal = (unitPrice: number, quantity: number): number => {
  if (!isValidMinorUnit(unitPrice) || !Number.isInteger(quantity) || quantity < 1) {
    throw new Error('Invalid unitPrice or quantity for line total calculation');
  }
  return unitPrice * quantity;
};

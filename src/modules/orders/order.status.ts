export type OrderStatus =
  'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled';

export const ORDER_STATUSES: OrderStatus[] = [
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
];

export const VALID_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

/**
 * Pure function to check if a transition from one status to another is valid.
 */
export const isValidTransition = (from: OrderStatus, to: OrderStatus): boolean => {
  const allowed = VALID_STATUS_TRANSITIONS[from];
  if (!allowed) {
    return false;
  }
  return allowed.includes(to);
};

/**
 * Pure function to check if a transition from one status to another is permitted.
 * Alias for isValidTransition per specification.
 */
export const canTransition = isValidTransition;

/**
 * Pure function to check if an order status is terminal (cannot transition further).
 */
export const isTerminalStatus = (status: OrderStatus): boolean => {
  return VALID_STATUS_TRANSITIONS[status]?.length === 0;
};

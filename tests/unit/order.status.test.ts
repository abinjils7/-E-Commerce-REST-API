import {
  ORDER_STATUSES,
  VALID_STATUS_TRANSITIONS,
  isValidTransition,
  canTransition,
  isTerminalStatus,
  OrderStatus,
} from '../../src/modules/orders/order.status';

describe('Order Status Machine (Unit Tests)', () => {
  describe('canTransition & isValidTransition aliases', () => {
    it('behaves identically for canTransition and isValidTransition', () => {
      expect(canTransition).toBe(isValidTransition);
    });
  });

  describe('Valid Status Transitions', () => {
    it('allows valid transitions from pending -> confirmed, cancelled', () => {
      expect(isValidTransition('pending', 'confirmed')).toBe(true);
      expect(isValidTransition('pending', 'cancelled')).toBe(true);
    });

    it('allows valid transitions from confirmed -> processing, cancelled', () => {
      expect(isValidTransition('confirmed', 'processing')).toBe(true);
      expect(isValidTransition('confirmed', 'cancelled')).toBe(true);
    });

    it('allows valid transitions from processing -> shipped, cancelled', () => {
      expect(isValidTransition('processing', 'shipped')).toBe(true);
      expect(isValidTransition('processing', 'cancelled')).toBe(true);
    });

    it('allows valid transition from shipped -> delivered', () => {
      expect(isValidTransition('shipped', 'delivered')).toBe(true);
    });
  });

  describe('Invalid Status Transitions', () => {
    it('rejects illegal forward transitions (skipping intermediate stages)', () => {
      expect(isValidTransition('pending', 'processing')).toBe(false);
      expect(isValidTransition('pending', 'shipped')).toBe(false);
      expect(isValidTransition('pending', 'delivered')).toBe(false);
      expect(isValidTransition('confirmed', 'delivered')).toBe(false);
    });

    it('rejects backwards status transitions', () => {
      expect(isValidTransition('confirmed', 'pending')).toBe(false);
      expect(isValidTransition('processing', 'confirmed')).toBe(false);
      expect(isValidTransition('processing', 'pending')).toBe(false);
      expect(isValidTransition('shipped', 'processing')).toBe(false);
      expect(isValidTransition('delivered', 'shipped')).toBe(false);
    });

    it('rejects self-transitions (no-op status updates)', () => {
      for (const status of ORDER_STATUSES) {
        expect(isValidTransition(status, status)).toBe(false);
      }
    });

    it('rejects invalid source status', () => {
      expect(isValidTransition('unknown' as OrderStatus, 'pending')).toBe(false);
    });
  });

  describe('Terminal Status Rules', () => {
    it('identifies delivered and cancelled as terminal states', () => {
      expect(isTerminalStatus('delivered')).toBe(true);
      expect(isTerminalStatus('cancelled')).toBe(true);
      expect(isTerminalStatus('pending')).toBe(false);
      expect(isTerminalStatus('confirmed')).toBe(false);
      expect(isTerminalStatus('processing')).toBe(false);
      expect(isTerminalStatus('shipped')).toBe(false);
    });

    it('does not allow ANY transition out of delivered', () => {
      for (const nextStatus of ORDER_STATUSES) {
        expect(isValidTransition('delivered', nextStatus)).toBe(false);
      }
    });

    it('does not allow ANY transition out of cancelled', () => {
      for (const nextStatus of ORDER_STATUSES) {
        expect(isValidTransition('cancelled', nextStatus)).toBe(false);
      }
    });

    it('has empty allowed transitions for terminal statuses in VALID_STATUS_TRANSITIONS map', () => {
      expect(VALID_STATUS_TRANSITIONS.delivered).toEqual([]);
      expect(VALID_STATUS_TRANSITIONS.cancelled).toEqual([]);
    });
  });
});

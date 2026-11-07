import { Router } from 'express';
import { orderController } from './order.controller';
import { createOrderSchema, updateOrderStatusSchema, getOrdersQuerySchema } from './order.schema';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate, validateObjectId } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

// Customer creates an order
router.post(
  '/',
  authenticate,
  validate({ body: createOrderSchema }),
  asyncHandler((req, res) => orderController.createOrder(req, res))
);

// Customer gets own orders
router.get(
  '/my',
  authenticate,
  validate({ query: getOrdersQuerySchema }),
  asyncHandler((req, res) => orderController.getMyOrders(req, res))
);

// Admin lists all orders with status/date filters
router.get(
  '/',
  authenticate,
  authorize('admin'),
  validate({ query: getOrdersQuerySchema }),
  asyncHandler((req, res) => orderController.getAllOrders(req, res))
);

// Admin updates order status (guarded atomic update)
router.patch(
  '/:id/status',
  authenticate,
  authorize('admin'),
  validateObjectId('id'),
  validate({ body: updateOrderStatusSchema }),
  asyncHandler((req, res) => orderController.updateOrderStatus(req, res))
);

// Get single order (Customer: own only -> 404 if not own; Admin: any)
router.get(
  '/:id',
  authenticate,
  validateObjectId('id'),
  asyncHandler((req, res) => orderController.getOrderById(req, res))
);

export const orderRoutes = router;

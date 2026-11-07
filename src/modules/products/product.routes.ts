import { Router } from 'express';
import { productController } from './product.controller';
import {
  createProductSchema,
  updateProductSchema,
  adjustStockSchema,
  customerProductQuerySchema,
  adminProductQuerySchema,
} from './product.schema';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate, validateObjectId } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

// Admin listing route (mounted both as /admin on products router and /api/v1/admin/products in app)
router.get(
  '/admin',
  authenticate,
  authorize('admin'),
  validate({ query: adminProductQuerySchema }),
  asyncHandler((req, res) => productController.getAdminProducts(req, res))
);

// Public product listing
router.get(
  '/',
  validate({ query: customerProductQuerySchema }),
  asyncHandler((req, res) => productController.getProducts(req, res))
);

// Single product
router.get(
  '/:id',
  validateObjectId('id'),
  asyncHandler((req, res) => productController.getProductById(req, res))
);

// Admin-only writes
router.post(
  '/',
  authenticate,
  authorize('admin'),
  validate({ body: createProductSchema }),
  asyncHandler((req, res) => productController.createProduct(req, res))
);

router.patch(
  '/:id/stock',
  authenticate,
  authorize('admin'),
  validateObjectId('id'),
  validate({ body: adjustStockSchema }),
  asyncHandler((req, res) => productController.adjustStock(req, res))
);

router.patch(
  '/:id',
  authenticate,
  authorize('admin'),
  validateObjectId('id'),
  validate({ body: updateProductSchema }),
  asyncHandler((req, res) => productController.updateProduct(req, res))
);

router.delete(
  '/:id',
  authenticate,
  authorize('admin'),
  validateObjectId('id'),
  asyncHandler((req, res) => productController.deleteProduct(req, res))
);

export const productRoutes = router;

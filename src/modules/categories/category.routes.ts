import { Router } from 'express';
import { categoryController } from './category.controller';
import {
  createCategorySchema,
  updateCategorySchema,
  getCategoriesQuerySchema,
} from './category.schema';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate, validateObjectId } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

// Public reads
router.get(
  '/tree',
  asyncHandler((req, res) => categoryController.getCategoryTree(req, res))
);

router.get(
  '/',
  validate({ query: getCategoriesQuerySchema }),
  asyncHandler((req, res) => categoryController.getCategories(req, res))
);

router.get(
  '/:id',
  validateObjectId('id'),
  asyncHandler((req, res) => categoryController.getCategoryById(req, res))
);

// Admin-only writes
router.post(
  '/',
  authenticate,
  authorize('admin'),
  validate({ body: createCategorySchema }),
  asyncHandler((req, res) => categoryController.createCategory(req, res))
);

router.patch(
  '/:id',
  authenticate,
  authorize('admin'),
  validateObjectId('id'),
  validate({ body: updateCategorySchema }),
  asyncHandler((req, res) => categoryController.updateCategory(req, res))
);

router.delete(
  '/:id',
  authenticate,
  authorize('admin'),
  validateObjectId('id'),
  asyncHandler((req, res) => categoryController.deleteCategory(req, res))
);

export const categoryRoutes = router;

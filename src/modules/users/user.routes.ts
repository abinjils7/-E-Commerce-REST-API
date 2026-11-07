import { Router } from 'express';
import { userController } from './user.controller';
import { updateMeSchema, updateUserStatusSchema, getUsersQuerySchema } from './user.schema';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate, validateObjectId } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

// Customer/Admin personal profile
router.get(
  '/me',
  authenticate,
  asyncHandler((req, res) => userController.getMe(req, res))
);

router.patch(
  '/me',
  authenticate,
  validate({ body: updateMeSchema }),
  asyncHandler((req, res) => userController.updateMe(req, res))
);

// Admin-only user management
router.get(
  '/',
  authenticate,
  authorize('admin'),
  validate({ query: getUsersQuerySchema }),
  asyncHandler((req, res) => userController.getUsers(req, res))
);

router.patch(
  '/:id/status',
  authenticate,
  authorize('admin'),
  validateObjectId('id'),
  validate({ body: updateUserStatusSchema }),
  asyncHandler((req, res) => userController.updateUserStatus(req, res))
);

export const userRoutes = router;

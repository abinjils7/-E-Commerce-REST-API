import { Router } from 'express';
import { authController } from './auth.controller';
import { registerSchema, loginSchema } from './auth.schema';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

router.post(
  '/register',
  validate({ body: registerSchema }),
  asyncHandler((req, res) => authController.register(req, res))
);

router.post(
  '/login',
  validate({ body: loginSchema }),
  asyncHandler((req, res) => authController.login(req, res))
);

export const authRoutes = router;

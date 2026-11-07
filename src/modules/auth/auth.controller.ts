import { Request, Response } from 'express';
import { authService } from './auth.service';
import { RegisterInput, LoginInput } from './auth.schema';

export class AuthController {
  async register(req: Request, res: Response): Promise<void> {
    const input = req.body as RegisterInput;
    const result = await authService.register(input);

    res.status(201).json({
      success: true,
      message: 'Account registered successfully',
      data: result,
    });
  }

  async login(req: Request, res: Response): Promise<void> {
    const input = req.body as LoginInput;
    const result = await authService.login(input);

    res.status(200).json({
      success: true,
      message: 'Logged in successfully',
      data: result,
    });
  }
}

export const authController = new AuthController();

import { Request, Response } from 'express';
import { userService } from './user.service';
import { UpdateMeInput, UpdateUserStatusInput, GetUsersQueryInput } from './user.schema';
import { AppError } from '../../utils/AppError';

export class UserController {
  async getMe(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      throw AppError.unauthorized('Authentication required');
    }
    const result = await userService.getMe(req.user._id.toString());
    res.status(200).json({
      success: true,
      message: 'User profile retrieved successfully',
      data: result,
    });
  }

  async updateMe(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      throw AppError.unauthorized('Authentication required');
    }
    const input = req.body as UpdateMeInput;
    const result = await userService.updateMe(req.user._id.toString(), input);
    res.status(200).json({
      success: true,
      message: 'User profile updated successfully',
      data: result,
    });
  }

  async getUsers(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as GetUsersQueryInput;
    const { users, meta } = await userService.getUsers(query);
    res.status(200).json({
      success: true,
      message: 'Users retrieved successfully',
      data: users,
      meta,
    });
  }

  async updateUserStatus(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      throw AppError.unauthorized('Authentication required');
    }
    const targetUserId = req.params.id as string;
    const input = req.body as UpdateUserStatusInput;
    const result = await userService.updateUserStatus(targetUserId, req.user._id.toString(), input);

    res.status(200).json({
      success: true,
      message: `User account ${input.isActive ? 'activated' : 'deactivated'} successfully`,
      data: result,
    });
  }
}

export const userController = new UserController();

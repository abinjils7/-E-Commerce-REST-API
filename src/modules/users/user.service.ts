import bcrypt from 'bcrypt';
import { FilterQuery } from 'mongoose';
import { User, IUserDocument } from '../../models/user.model';
import { AppError } from '../../utils/AppError';
import { env } from '../../config/env';
import { UpdateMeInput, UpdateUserStatusInput, GetUsersQueryInput } from './user.schema';
import { getPagination, buildPaginationMeta, PaginationMeta } from '../../utils/pagination';

export interface UserResponse {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const mapUserResponse = (user: IUserDocument): UserResponse => ({
  id: user._id.toString(),
  name: user.name,
  email: user.email,
  role: user.role,
  isActive: user.isActive,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

export class UserService {
  async getMe(userId: string): Promise<UserResponse> {
    const user = await User.findById(userId);
    if (!user) {
      throw AppError.notFound('User not found');
    }
    return mapUserResponse(user);
  }

  async updateMe(userId: string, input: UpdateMeInput): Promise<UserResponse> {
    const user = await User.findById(userId).select('+passwordHash');
    if (!user) {
      throw AppError.notFound('User not found');
    }

    if (input.name) {
      user.name = input.name.trim();
    }

    if (input.newPassword) {
      if (!input.currentPassword) {
        throw AppError.badRequest('Current password is required to set a new password');
      }
      const isMatch = await bcrypt.compare(input.currentPassword, user.passwordHash);
      if (!isMatch) {
        throw AppError.badRequest('Current password is incorrect');
      }
      user.passwordHash = await bcrypt.hash(input.newPassword, env.BCRYPT_SALT_ROUNDS);
    }

    await user.save();
    return mapUserResponse(user);
  }

  async getUsers(
    query: GetUsersQueryInput
  ): Promise<{ users: UserResponse[]; meta: PaginationMeta }> {
    const { page, limit, skip } = getPagination({
      page: query.page,
      limit: query.limit,
      defaultLimit: 10,
      maxLimit: 50,
    });

    const filter: FilterQuery<IUserDocument> = {};
    if (query.role) {
      filter.role = query.role;
    }
    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    }
    if (query.search) {
      const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);

    return {
      users: users.map(mapUserResponse),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async updateUserStatus(
    targetUserId: string,
    requestingAdminId: string,
    input: UpdateUserStatusInput
  ): Promise<UserResponse> {
    if (targetUserId === requestingAdminId) {
      throw AppError.badRequest('An admin cannot deactivate themselves');
    }

    const user = await User.findById(targetUserId);
    if (!user) {
      throw AppError.notFound('User not found');
    }

    user.isActive = input.isActive;
    await user.save();

    return mapUserResponse(user);
  }
}

export const userService = new UserService();

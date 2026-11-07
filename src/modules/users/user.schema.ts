import { z } from 'zod';

export const updateMeSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100).optional(),
    currentPassword: z
      .string()
      .min(1, 'Current password is required to change password')
      .optional(),
    newPassword: z
      .string()
      .min(8, 'New password must be at least 8 characters')
      .max(100)
      .optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.newPassword && !data.currentPassword) {
        return false;
      }
      return true;
    },
    {
      message: 'currentPassword is required when setting a newPassword',
      path: ['currentPassword'],
    }
  );

export const updateUserStatusSchema = z
  .object({
    isActive: z.boolean({ required_error: 'isActive boolean is required' }),
  })
  .strict();

export const getUsersQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(50).optional(),
    role: z.enum(['admin', 'customer']).optional(),
    isActive: z
      .preprocess((val) => {
        if (val === 'true') return true;
        if (val === 'false') return false;
        return val;
      }, z.boolean().optional())
      .optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict();

export type UpdateMeInput = z.infer<typeof updateMeSchema>;
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;
export type GetUsersQueryInput = z.infer<typeof getUsersQuerySchema>;

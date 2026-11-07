import { z } from 'zod';

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const createCategorySchema = z
  .object({
    name: z.string().trim().min(1, 'Category name is required').max(100),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(slugRegex, 'Slug must be lowercase alphanumeric with hyphens (kebab-case)')
      .optional(),
    description: z.string().trim().max(500).optional(),
    parent: z
      .string()
      .regex(objectIdRegex, 'Parent must be a valid ObjectId')
      .nullable()
      .optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(slugRegex, 'Slug must be lowercase alphanumeric with hyphens (kebab-case)')
      .optional(),
    description: z.string().trim().max(500).optional(),
    parent: z
      .string()
      .regex(objectIdRegex, 'Parent must be a valid ObjectId')
      .nullable()
      .optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const getCategoriesQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(50).optional(),
    parent: z.union([z.string().regex(objectIdRegex), z.literal('null'), z.null()]).optional(),
    isActive: z
      .preprocess((val) => {
        if (val === 'true') return true;
        if (val === 'false') return false;
        return val;
      }, z.boolean().optional())
      .optional(),
  })
  .strict();

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type GetCategoriesQueryInput = z.infer<typeof getCategoriesQuerySchema>;

import { z } from 'zod';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const createProductSchema = z
  .object({
    name: z.string().trim().min(1, 'Product name is required').max(200),
    sku: z.string().trim().min(1, 'SKU is required').max(50),
    description: z.string().trim().min(1, 'Product description is required').max(2000),
    price: z.coerce
      .number({ required_error: 'Price is required' })
      .int('Price must be an integer (paise)')
      .min(0, 'Price must be non-negative'),
    salePrice: z.coerce
      .number()
      .int('Sale price must be an integer (paise)')
      .min(0, 'Sale price must be non-negative')
      .nullable()
      .optional(),
    stock: z.coerce
      .number({ required_error: 'Stock is required' })
      .int('Stock must be an integer')
      .min(0, 'Stock cannot be negative'),
    category: z.string().regex(objectIdRegex, 'Category must be a valid ObjectId'),
    status: z.enum(['active', 'inactive']).default('active').optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.salePrice !== undefined && data.salePrice !== null) {
        return data.salePrice <= data.price;
      }
      return true;
    },
    {
      message: 'salePrice cannot be greater than original price',
      path: ['salePrice'],
    }
  );

export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    sku: z.string().trim().min(1).max(50).optional(),
    description: z.string().trim().min(1).max(2000).optional(),
    price: z.coerce
      .number()
      .int('Price must be an integer (paise)')
      .min(0, 'Price must be non-negative')
      .optional(),
    salePrice: z.coerce
      .number()
      .int('Sale price must be an integer (paise)')
      .min(0, 'Sale price must be non-negative')
      .nullable()
      .optional(),
    category: z.string().regex(objectIdRegex, 'Category must be a valid ObjectId').optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.price !== undefined && data.salePrice !== undefined && data.salePrice !== null) {
        return data.salePrice <= data.price;
      }
      return true;
    },
    {
      message: 'salePrice cannot be greater than original price',
      path: ['salePrice'],
    }
  );

export const adjustStockSchema = z
  .object({
    adjustBy: z.coerce
      .number({ required_error: 'adjustBy is required' })
      .int('adjustBy must be an integer')
      .refine((n) => n !== 0, 'adjustBy cannot be zero'),
  })
  .strict();

export const customerProductQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(50).optional(),
    search: z.string().trim().optional(),
    category: z.string().regex(objectIdRegex, 'Invalid category ObjectId').optional(),
    minPrice: z.coerce.number().int().min(0).optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    sort: z.enum(['price_asc', 'price_desc', 'newest', 'name_asc']).optional(),
    inStock: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((val) => (typeof val === 'boolean' ? val : val === 'true'))
      .optional(),
  })
  .strict();

export const adminProductQuerySchema = customerProductQuerySchema
  .extend({
    status: z.enum(['active', 'inactive']).optional(),
  })
  .strict();

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
export type CustomerProductQueryInput = z.infer<typeof customerProductQuerySchema>;
export type AdminProductQueryInput = z.infer<typeof adminProductQuerySchema>;

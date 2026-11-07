import { z } from 'zod';
import { ORDER_STATUSES, OrderStatus } from './order.status';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const orderItemInputSchema = z
  .object({
    productId: z.string().regex(objectIdRegex, 'productId must be a valid ObjectId'),
    quantity: z.coerce
      .number()
      .int('Quantity must be an integer')
      .min(1, 'Quantity must be at least 1')
      .max(100, 'Quantity cannot exceed 100 per item'),
    price: z.number().optional(),
    unitPrice: z.number().optional(),
  })
  .strict();

export const shippingAddressSchema = z
  .object({
    fullName: z.string().trim().min(1, 'Full name is required').max(100),
    phone: z.string().trim().min(1, 'Phone number is required').max(30),
    line1: z.string().trim().min(1, 'Address line 1 is required').max(200),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1, 'City is required').max(100),
    state: z.string().trim().min(1, 'State is required').max(100),
    postalCode: z.string().trim().min(1, 'Postal code is required').max(20),
    country: z.string().trim().min(1, 'Country is required').max(100),
  })
  .strict();

export const createOrderSchema = z
  .object({
    items: z
      .array(orderItemInputSchema)
      .min(1, 'Order must contain at least one item')
      .max(50, 'Order cannot contain more than 50 items')
      .refine(
        (items) => {
          const ids = items.map((i) => i.productId);
          return new Set(ids).size === ids.length;
        },
        {
          message: 'Duplicate productIds are not allowed in order items',
          path: ['items'],
        }
      ),
    shippingAddress: shippingAddressSchema,
  })
  .strict();

export const updateOrderStatusSchema = z
  .object({
    status: z.enum(ORDER_STATUSES as [OrderStatus, ...OrderStatus[]]),
    currentStatus: z.enum(ORDER_STATUSES as [OrderStatus, ...OrderStatus[]]).optional(),
  })
  .strict();

export const getOrdersQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional().default(1),
    limit: z.coerce.number().int().positive().max(50).optional().default(10),
    status: z.enum(ORDER_STATUSES as [OrderStatus, ...OrderStatus[]]).optional(),
    startDate: z
      .string()
      .datetime({ offset: true })
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .optional(),
    endDate: z
      .string()
      .datetime({ offset: true })
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .optional(),
  })
  .strict();

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export type GetOrdersQueryInput = z.infer<typeof getOrdersQuerySchema>;

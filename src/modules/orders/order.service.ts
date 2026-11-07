import mongoose, { Types } from 'mongoose';
import { Order, IOrderDocument, IOrderItemSnapshot } from '../../models/order.model';
import { Product, IProductDocument } from '../../models/product.model';
import { AppError } from '../../utils/AppError';
import { calculateLineTotal } from '../../utils/money';
import { getUseTransactions } from '../../config/env';
import { logger } from '../../config/logger';
import { CreateOrderInput, UpdateOrderStatusInput, GetOrdersQueryInput } from './order.schema';
import { isValidTransition } from './order.status';
import { getPagination, buildPaginationMeta, PaginationMeta } from '../../utils/pagination';

export const generateOrderNumber = (): string => {
  const objectId = new Types.ObjectId().toString();
  const timestamp = Date.now();
  const suffix = objectId.slice(-6).toUpperCase();
  return `ORD-${timestamp}-${suffix}`;
};

export interface OrderCreationResult {
  order: IOrderDocument;
  isReplay: boolean;
}

const isDuplicateKeyError = (
  err: unknown
): err is {
  code: number;
  keyPattern?: Record<string, unknown>;
  keyValue?: Record<string, unknown>;
  message?: string;
} => {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: number }).code === 11000
  );
};

const isOrderNumberDuplicateError = (err: unknown): boolean => {
  if (!isDuplicateKeyError(err)) return false;
  if (err.keyPattern && 'orderNumber' in err.keyPattern) return true;
  if (err.keyValue && 'orderNumber' in err.keyValue) return true;
  if (typeof err.message === 'string' && err.message.includes('orderNumber')) return true;
  return false;
};

const isIdempotencyKeyDuplicateError = (err: unknown): boolean => {
  if (!isDuplicateKeyError(err)) return false;
  if (err.keyPattern && 'idempotencyKey' in err.keyPattern) return true;
  if (err.keyValue && 'idempotencyKey' in err.keyValue) return true;
  if (typeof err.message === 'string' && err.message.includes('idempotencyKey')) return true;
  return false;
};

const areOrderInputsEqual = (order: IOrderDocument, input: CreateOrderInput): boolean => {
  if (order.items.length !== input.items.length) {
    return false;
  }
  const orderItemMap = new Map<string, number>();
  for (const item of order.items) {
    orderItemMap.set(item.product.toString(), item.quantity);
  }
  for (const item of input.items) {
    const qty = orderItemMap.get(item.productId);
    if (qty !== item.quantity) {
      return false;
    }
  }

  const addr = order.shippingAddress;
  const inputAddr = input.shippingAddress;
  return (
    addr.fullName === inputAddr.fullName &&
    addr.phone === inputAddr.phone &&
    addr.line1 === inputAddr.line1 &&
    (addr.line2 || undefined) === (inputAddr.line2 || undefined) &&
    addr.city === inputAddr.city &&
    addr.state === inputAddr.state &&
    addr.postalCode === inputAddr.postalCode &&
    addr.country === inputAddr.country
  );
};

export const parseEndDate = (dateStr: string): Date => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(`${dateStr}T23:59:59.999Z`);
  }
  return new Date(dateStr);
};

export class OrderService {
  async createOrder(
    userId: string,
    input: CreateOrderInput,
    idempotencyKey?: string,
    forceTransactionMode?: boolean
  ): Promise<OrderCreationResult> {
    const userObjectId = new Types.ObjectId(userId);

    // 1. Idempotency Check BEFORE reserving stock
    if (idempotencyKey) {
      const existingOrder = await Order.findOne({
        user: userObjectId,
        idempotencyKey,
      });
      if (existingOrder) {
        if (!areOrderInputsEqual(existingOrder, input)) {
          throw AppError.conflict(
            'Idempotency key already exists with a different request payload'
          );
        }
        return { order: existingOrder, isReplay: true };
      }
    }

    const useTransaction =
      forceTransactionMode !== undefined ? forceTransactionMode : getUseTransactions();

    // Sort items by productId before reserving to reduce write conflicts and contention
    const sortedItems = [...input.items].sort((a, b) => a.productId.localeCompare(b.productId));

    // --- TRANSACTION PATH (withTransaction) ---
    if (useTransaction) {
      const session = await mongoose.startSession();
      try {
        let createdOrder: IOrderDocument | null = null;
        let isReplay = false;

        await session.withTransaction(async () => {
          // Reset local state at the start of each attempt to ensure callback idempotency on automatic retries
          createdOrder = null;
          isReplay = false;
          const snapshots: IOrderItemSnapshot[] = [];

          // withTransaction automatically retries this callback on TransientTransactionError
          // (such as write conflicts or network blips during commit). All local state is reset
          // at the top of the function and all DB operations pass { session }, making retries idempotent.

          // Re-verify idempotency within transaction to guard against parallel requests
          if (idempotencyKey) {
            const existingOrder = await Order.findOne(
              { user: userObjectId, idempotencyKey },
              null,
              { session }
            );
            if (existingOrder) {
              if (!areOrderInputsEqual(existingOrder, input)) {
                throw AppError.conflict(
                  'Idempotency key already exists with a different request payload'
                );
              }
              createdOrder = existingOrder;
              isReplay = true;
              return;
            }
          }

          // 2. Load all products in ONE query
          const productIds = sortedItems.map((i) => new Types.ObjectId(i.productId));
          const products: IProductDocument[] = await Product.find(
            { _id: { $in: productIds } },
            null,
            { session }
          );

          const productMap = new Map<string, IProductDocument>();
          for (const prod of products) {
            productMap.set(prod._id.toString(), prod);
          }

          // Check existence and active status
          for (const item of sortedItems) {
            const prod = productMap.get(item.productId);
            if (!prod) {
              throw AppError.unprocessableEntity(
                `Product with id '${item.productId}' does not exist`
              );
            }
            if (prod.status !== 'active') {
              throw AppError.unprocessableEntity(
                `Product '${prod.name}' is inactive and cannot be ordered`
              );
            }
          }

          // 3. Reserve stock per item atomically and build snapshot directly from returned doc
          for (const item of sortedItems) {
            const pId = new Types.ObjectId(item.productId);
            const updatedProduct = await Product.findOneAndUpdate(
              {
                _id: pId,
                status: 'active',
                stock: { $gte: item.quantity },
              },
              {
                $inc: { stock: -item.quantity },
              },
              {
                new: true,
                session,
              }
            );

            if (!updatedProduct) {
              const failedProduct = productMap.get(item.productId);
              const productName = failedProduct ? failedProduct.name : item.productId;
              throw AppError.conflict(
                `Insufficient stock for item: '${productName}' (requested: ${item.quantity})`
              );
            }

            // Build snapshot line from the document returned by the atomic findOneAndUpdate
            const unitPrice = updatedProduct.effectivePrice;
            const lineTotal = calculateLineTotal(unitPrice, item.quantity);

            snapshots.push({
              product: updatedProduct._id as Types.ObjectId,
              name: updatedProduct.name,
              sku: updatedProduct.sku,
              unitPrice,
              quantity: item.quantity,
              lineTotal,
            });
          }

          const totalAmount = snapshots.reduce((acc, curr) => acc + curr.lineTotal, 0);

          // Retry loop for orderNumber collisions
          let created: IOrderDocument | null = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const orderNumber = generateOrderNumber();
              const orderData: Record<string, unknown> = {
                orderNumber,
                user: userObjectId,
                items: snapshots,
                totalAmount,
                status: 'pending',
                statusHistory: [
                  {
                    from: 'pending',
                    to: 'pending',
                    by: userObjectId,
                    at: new Date(),
                  },
                ],
                shippingAddress: input.shippingAddress,
              };
              if (idempotencyKey) {
                orderData.idempotencyKey = idempotencyKey;
              }

              const orderDocs = await Order.create([orderData], { session });
              created = orderDocs[0] || null;
              break;
            } catch (createErr: unknown) {
              if (isOrderNumberDuplicateError(createErr) && attempt < 2) {
                continue;
              }
              throw createErr;
            }
          }

          if (!created) {
            throw AppError.internal('Failed to create order document');
          }

          createdOrder = created;
        });

        if (!createdOrder) {
          throw AppError.internal('Order creation transaction failed');
        }

        return { order: createdOrder, isReplay };
      } catch (err: unknown) {
        // Parallel idempotency race handling (distinguish idempotencyKey duplicate from orderNumber duplicate)
        if (idempotencyKey && isIdempotencyKeyDuplicateError(err)) {
          const existing = await Order.findOne({ user: userObjectId, idempotencyKey });
          if (existing) {
            if (!areOrderInputsEqual(existing, input)) {
              throw AppError.conflict(
                'Idempotency key already exists with a different request payload'
              );
            }
            return { order: existing, isReplay: true };
          }
        }
        throw err;
      } finally {
        await session.endSession();
      }
    }

    // --- NON-TRANSACTION PATH (Manual Compensation) ---
    const reservedItems: Array<{ productId: Types.ObjectId; quantity: number }> = [];

    try {
      // 2. Load all products in ONE query
      const productIds = sortedItems.map((i) => new Types.ObjectId(i.productId));
      const products: IProductDocument[] = await Product.find({ _id: { $in: productIds } });

      const productMap = new Map<string, IProductDocument>();
      for (const prod of products) {
        productMap.set(prod._id.toString(), prod);
      }

      // Check existence and active status
      for (const item of sortedItems) {
        const prod = productMap.get(item.productId);
        if (!prod) {
          throw AppError.unprocessableEntity(`Product with id '${item.productId}' does not exist`);
        }
        if (prod.status !== 'active') {
          throw AppError.unprocessableEntity(
            `Product '${prod.name}' is inactive and cannot be ordered`
          );
        }
      }

      // 3. Reserve stock per item atomically and build snapshot directly from returned doc
      const snapshots: IOrderItemSnapshot[] = [];

      for (const item of sortedItems) {
        const pId = new Types.ObjectId(item.productId);
        const updatedProduct = await Product.findOneAndUpdate(
          {
            _id: pId,
            status: 'active',
            stock: { $gte: item.quantity },
          },
          {
            $inc: { stock: -item.quantity },
          },
          {
            new: true,
          }
        );

        if (!updatedProduct) {
          const failedProduct = productMap.get(item.productId);
          const productName = failedProduct ? failedProduct.name : item.productId;

          // Compensate previously reserved items and clear list so catch block does not double-compensate
          for (const res of reservedItems) {
            try {
              await Product.updateOne({ _id: res.productId }, { $inc: { stock: res.quantity } });
            } catch (restoreErr: unknown) {
              logger.error(
                {
                  err: restoreErr,
                  productId: res.productId,
                  quantity: res.quantity,
                },
                'Failed to restore stock during item reservation compensation (non-transaction path)'
              );
            }
          }
          reservedItems.length = 0;

          throw AppError.conflict(
            `Insufficient stock for item: '${productName}' (requested: ${item.quantity})`
          );
        }

        reservedItems.push({ productId: pId, quantity: item.quantity });

        // Build snapshot line from the document returned by the atomic findOneAndUpdate
        const unitPrice = updatedProduct.effectivePrice;
        const lineTotal = calculateLineTotal(unitPrice, item.quantity);

        snapshots.push({
          product: updatedProduct._id as Types.ObjectId,
          name: updatedProduct.name,
          sku: updatedProduct.sku,
          unitPrice,
          quantity: item.quantity,
          lineTotal,
        });
      }

      const totalAmount = snapshots.reduce((acc, curr) => acc + curr.lineTotal, 0);

      // 4. Create Order document with retry on orderNumber collision
      let createdOrder: IOrderDocument | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const orderNumber = generateOrderNumber();
          const orderData: Record<string, unknown> = {
            orderNumber,
            user: userObjectId,
            items: snapshots,
            totalAmount,
            status: 'pending',
            statusHistory: [
              {
                from: 'pending',
                to: 'pending',
                by: userObjectId,
                at: new Date(),
              },
            ],
            shippingAddress: input.shippingAddress,
          };
          if (idempotencyKey) {
            orderData.idempotencyKey = idempotencyKey;
          }

          const orderDocs = await Order.create([orderData]);
          createdOrder = orderDocs[0] || null;
          break;
        } catch (createErr: unknown) {
          if (isOrderNumberDuplicateError(createErr) && attempt < 2) {
            continue;
          }
          throw createErr;
        }
      }

      if (!createdOrder) {
        throw AppError.internal('Failed to create order document');
      }

      return { order: createdOrder, isReplay: false };
    } catch (error: unknown) {
      // Compensate all reserved stock: each item is restored independently so a single
      // restore failure does not prevent the remaining items from being restored.
      if (reservedItems.length > 0) {
        for (const res of reservedItems) {
          try {
            await Product.updateOne({ _id: res.productId }, { $inc: { stock: res.quantity } });
          } catch (restoreErr: unknown) {
            logger.error(
              {
                err: restoreErr,
                productId: res.productId,
                quantity: res.quantity,
              },
              'Failed to restore stock during order compensation (non-transaction path)'
            );
          }
        }
        reservedItems.length = 0;
      }

      // Handle duplicate idempotency key race gracefully (distinguish idempotencyKey duplicate from orderNumber duplicate)
      if (idempotencyKey && isIdempotencyKeyDuplicateError(error)) {
        const existing = await Order.findOne({ user: userObjectId, idempotencyKey });
        if (existing) {
          if (!areOrderInputsEqual(existing, input)) {
            throw AppError.conflict(
              'Idempotency key already exists with a different request payload'
            );
          }
          return { order: existing, isReplay: true };
        }
      }

      // Rethrow the original error
      throw error;
    }
  }

  async updateOrderStatus(
    orderId: string,
    adminId: string,
    input: UpdateOrderStatusInput,
    forceTransactionMode?: boolean
  ): Promise<IOrderDocument> {
    const adminObjectId = new Types.ObjectId(adminId);
    const orderObjectId = new Types.ObjectId(orderId);

    // Fetch order to determine current status
    const currentOrder = await Order.findById(orderObjectId);
    if (!currentOrder) {
      throw AppError.notFound('Order not found');
    }

    const currentStatus = input.currentStatus || currentOrder.status;
    const nextStatus = input.status;

    // Validate transition
    if (!isValidTransition(currentStatus, nextStatus)) {
      throw AppError.badRequest(
        `Invalid status transition: cannot transition order from '${currentStatus}' to '${nextStatus}'`
      );
    }

    const useTransaction =
      forceTransactionMode !== undefined ? forceTransactionMode : getUseTransactions();

    // When USE_TRANSACTIONS=true, execute the status transition and stock restore in ONE transaction
    if (useTransaction) {
      const session = await mongoose.startSession();
      try {
        let updatedOrder: IOrderDocument | null = null;
        await session.withTransaction(async () => {
          updatedOrder = await Order.findOneAndUpdate(
            {
              _id: orderObjectId,
              status: currentStatus,
            },
            {
              status: nextStatus,
              $push: {
                statusHistory: {
                  from: currentStatus,
                  to: nextStatus,
                  by: adminObjectId,
                  at: new Date(),
                },
              },
            },
            { new: true, session }
          );

          if (!updatedOrder) {
            throw AppError.conflict(
              'Order status conflict: the order status has already changed (stale update)'
            );
          }

          if (nextStatus === 'cancelled') {
            for (const item of updatedOrder.items) {
              await Product.updateOne(
                { _id: item.product },
                { $inc: { stock: item.quantity } },
                { session }
              );
            }
          }
        });

        if (!updatedOrder) {
          throw AppError.conflict(
            'Order status conflict: the order status has already changed (stale update)'
          );
        }

        return updatedOrder;
      } finally {
        await session.endSession();
      }
    }

    // In compensation mode (USE_TRANSACTIONS=false)
    // Guarded atomic update: findOneAndUpdate({ _id, status: current }, { status: next, $push: statusHistory })
    const updatedOrder = await Order.findOneAndUpdate(
      {
        _id: orderObjectId,
        status: currentStatus,
      },
      {
        status: nextStatus,
        $push: {
          statusHistory: {
            from: currentStatus,
            to: nextStatus,
            by: adminObjectId,
            at: new Date(),
          },
        },
      },
      { new: true }
    );

    if (!updatedOrder) {
      // Null -> stale update or concurrent transition won
      throw AppError.conflict(
        'Order status conflict: the order status has already changed (stale update)'
      );
    }

    // In compensation mode, restore stock for all items even if one restore fails (log failures, do not stop at the first)
    if (nextStatus === 'cancelled') {
      for (const item of updatedOrder.items) {
        try {
          await Product.updateOne({ _id: item.product }, { $inc: { stock: item.quantity } });
        } catch (restoreErr) {
          logger.error(
            {
              err: restoreErr,
              productId: item.product,
              quantity: item.quantity,
              orderId: updatedOrder._id,
            },
            'Failed to restore stock for item on order cancellation'
          );
        }
      }
    }

    return updatedOrder;
  }

  async getMyOrders(
    userId: string,
    query: GetOrdersQueryInput
  ): Promise<{ orders: IOrderDocument[]; meta: PaginationMeta }> {
    const { page, limit, skip } = getPagination({
      page: query.page,
      limit: query.limit,
      defaultLimit: 10,
      maxLimit: 50,
    });

    const filter: Record<string, unknown> = {
      user: new Types.ObjectId(userId),
    };

    if (query.status) {
      filter.status = query.status;
    }

    if (query.startDate || query.endDate) {
      const dateFilter: Record<string, Date> = {};
      if (query.startDate) {
        dateFilter.$gte = new Date(query.startDate);
      }
      if (query.endDate) {
        dateFilter.$lte = parseEndDate(query.endDate);
      }
      filter.createdAt = dateFilter;
    }

    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Order.countDocuments(filter),
    ]);

    return {
      orders,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async getOrderById(
    orderId: string,
    requestingUserId: string,
    isAdmin = false
  ): Promise<IOrderDocument> {
    const filter = isAdmin
      ? { _id: new Types.ObjectId(orderId) }
      : { _id: new Types.ObjectId(orderId), user: new Types.ObjectId(requestingUserId) };

    const order = await Order.findOne(filter);
    if (!order) {
      throw AppError.notFound('Order not found');
    }

    return order;
  }

  async getAllOrders(
    query: GetOrdersQueryInput
  ): Promise<{ orders: IOrderDocument[]; meta: PaginationMeta }> {
    const { page, limit, skip } = getPagination({
      page: query.page,
      limit: query.limit,
      defaultLimit: 15,
      maxLimit: 50,
    });

    const filter: Record<string, unknown> = {};

    if (query.status) {
      filter.status = query.status;
    }

    if (query.startDate || query.endDate) {
      const dateFilter: Record<string, Date> = {};
      if (query.startDate) {
        dateFilter.$gte = new Date(query.startDate);
      }
      if (query.endDate) {
        dateFilter.$lte = parseEndDate(query.endDate);
      }
      filter.createdAt = dateFilter;
    }

    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Order.countDocuments(filter),
    ]);

    return {
      orders,
      meta: buildPaginationMeta(total, page, limit),
    };
  }
}

export const orderService = new OrderService();

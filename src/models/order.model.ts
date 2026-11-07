import mongoose, { Document, Model, Schema, Types } from 'mongoose';
import { OrderStatus, ORDER_STATUSES } from '../modules/orders/order.status';

export interface IOrderItemSnapshot {
  product: Types.ObjectId;
  name: string;
  sku: string;
  unitPrice: number; // in paise
  quantity: number;
  lineTotal: number; // in paise
}

export interface IOrderStatusHistory {
  from: OrderStatus;
  to: OrderStatus;
  by: Types.ObjectId;
  at: Date;
}

export interface IShippingAddress {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface IOrder {
  orderNumber: string;
  user: Types.ObjectId;
  items: IOrderItemSnapshot[];
  totalAmount: number; // in paise
  status: OrderStatus;
  statusHistory: IOrderStatusHistory[];
  shippingAddress: IShippingAddress;
  idempotencyKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IOrderDocument extends IOrder, Document {}

const orderItemSchema = new Schema<IOrderItemSnapshot>(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    sku: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'unitPrice must be an integer (paise)',
      },
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: 'quantity must be an integer >= 1',
      },
    },
    lineTotal: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'lineTotal must be an integer (paise)',
      },
    },
  },
  { _id: false }
);

const statusHistorySchema = new Schema<IOrderStatusHistory>(
  {
    from: {
      type: String,
      enum: ORDER_STATUSES,
      required: true,
    },
    to: {
      type: String,
      enum: ORDER_STATUSES,
      required: true,
    },
    by: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    at: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const shippingAddressSchema = new Schema<IShippingAddress>(
  {
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    line1: { type: String, required: true, trim: true },
    line2: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    postalCode: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const orderSchema = new Schema<IOrderDocument>(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    items: {
      type: [orderItemSchema],
      required: true,
      validate: {
        validator: (items: IOrderItemSnapshot[]) => items && items.length > 0,
        message: 'Order must contain at least one item',
      },
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'totalAmount must be an integer (paise)',
      },
    },
    status: {
      type: String,
      enum: ORDER_STATUSES,
      default: 'pending',
    },
    statusHistory: {
      type: [statusHistorySchema],
      default: [],
    },
    shippingAddress: {
      type: shippingAddressSchema,
      required: true,
    },
    idempotencyKey: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes per spec:
// 1. { user: 1, createdAt: -1 }
orderSchema.index({ user: 1, createdAt: -1 });
// 2. { status: 1, createdAt: -1 }
orderSchema.index({ status: 1, createdAt: -1 });
// 3. { createdAt: -1 } for global/admin order queries
orderSchema.index({ createdAt: -1 });
// 4. { user: 1, idempotencyKey: 1 } unique sparse
// When indexing compound fields, sparse only indexes documents where at least one indexed field is present (and user is always present).
// Use partialFilterExpression to guarantee uniqueness ONLY when idempotencyKey is an actual string.
orderSchema.index(
  { user: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  }
);

export const Order: Model<IOrderDocument> = mongoose.model<IOrderDocument>('Order', orderSchema);

import mongoose, { Document, Model, Schema, Types } from 'mongoose';

export type ProductStatus = 'active' | 'inactive';

export interface IProduct {
  name: string;
  sku: string;
  description: string;
  price: number; // in paise
  salePrice?: number; // in paise
  effectivePrice: number; // in paise (stored = salePrice ?? price)
  stock: number;
  category: Types.ObjectId;
  status: ProductStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface IProductDocument extends IProduct, Document {}

const productSchema = new Schema<IProductDocument>(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      maxlength: [200, 'Product name cannot exceed 200 characters'],
    },
    sku: {
      type: String,
      required: [true, 'SKU is required'],
      unique: true,
      uppercase: true,
      trim: true,
    },
    description: {
      type: String,
      required: [true, 'Product description is required'],
      trim: true,
      maxlength: [2000, 'Product description cannot exceed 2000 characters'],
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price must be non-negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Price must be an integer in minor units (paise)',
      },
    },
    salePrice: {
      type: Number,
      min: [0, 'Sale price must be non-negative'],
      validate: {
        validator: function (this: IProductDocument | unknown, value: number | undefined) {
          if (value === undefined || value === null) return true;
          if (!Number.isInteger(value)) return false;
          // When creating/saving on doc instance
          if (this && typeof (this as IProductDocument).price === 'number') {
            return value <= (this as IProductDocument).price;
          }
          return true;
        },
        message: 'Sale price must be an integer less than or equal to original price',
      },
    },
    effectivePrice: {
      type: Number,
      required: true,
    },
    stock: {
      type: Number,
      required: [true, 'Stock count is required'],
      min: [0, 'Stock cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Stock must be an integer',
      },
      default: 0,
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Category reference is required'],
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes per spec:
// 1. sku unique (defined on field)
// 2. { category: 1, status: 1, effectivePrice: 1 }
productSchema.index({ category: 1, status: 1, effectivePrice: 1 });
// 3. text(name, description)
productSchema.index({ name: 'text', description: 'text' });
// 4. { createdAt: -1 }
productSchema.index({ createdAt: -1 });
// 5. { status: 1, effectivePrice: 1, _id: 1 } – supports price-sorted active-product listing
productSchema.index({ status: 1, effectivePrice: 1, _id: 1 });
// 6. { status: 1, createdAt: -1, _id: 1 } – supports newest-first active-product listing
productSchema.index({ status: 1, createdAt: -1, _id: 1 });

// Helper to calculate effective price
export const calculateEffectivePrice = (price: number, salePrice?: number | null): number => {
  if (salePrice !== undefined && salePrice !== null) {
    return salePrice;
  }
  return price;
};

// Document pre-validate hook for create / save
productSchema.pre('validate', function (next) {
  if (this.sku) {
    this.sku = this.sku.toUpperCase().trim();
  }
  if (this.salePrice !== undefined && this.salePrice !== null) {
    if (this.salePrice > this.price) {
      return next(new Error('salePrice cannot be greater than price'));
    }
    this.effectivePrice = this.salePrice;
  } else {
    this.effectivePrice = this.price;
  }
  next();
});

export const Product: Model<IProductDocument> = mongoose.model<IProductDocument>(
  'Product',
  productSchema
);

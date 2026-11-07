import mongoose, { Document, Model, Schema, Types } from 'mongoose';

export interface ICategory {
  name: string;
  slug: string;
  description?: string;
  parent: Types.ObjectId | null;
  ancestors: Types.ObjectId[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICategoryDocument extends ICategory, Document {}

const categorySchema = new Schema<ICategoryDocument>(
  {
    name: {
      type: String,
      required: [true, 'Category name is required'],
      trim: true,
      maxlength: [100, 'Category name cannot exceed 100 characters'],
    },
    slug: {
      type: String,
      required: [true, 'Slug is required'],
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },
    parent: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
    },
    ancestors: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Category',
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes:
// 1. { ancestors: 1 }
categorySchema.index({ ancestors: 1 });
// 2. { parent: 1, name: 1 } unique
categorySchema.index({ parent: 1, name: 1 }, { unique: true });
// 3. { parent: 1, slug: 1 } unique
categorySchema.index({ parent: 1, slug: 1 }, { unique: true });
// 4. { name: 1 } supporting default category list sort
categorySchema.index({ name: 1 });

export const Category: Model<ICategoryDocument> = mongoose.model<ICategoryDocument>(
  'Category',
  categorySchema
);

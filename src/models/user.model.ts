import mongoose, { Document, Model, Schema } from 'mongoose';

export type UserRole = 'admin' | 'customer';

export interface IUser {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserDocument extends IUser, Document {}

const userSchema = new Schema<IUserDocument>(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
      select: false,
    },
    role: {
      type: String,
      enum: ['admin', 'customer'],
      default: 'customer',
      required: true,
    },
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
userSchema.index({ createdAt: -1 });

// Never leak passwordHash in toJSON/toObject
userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    const plainRet = ret as unknown as Record<string, unknown>;
    delete plainRet.passwordHash;
    return plainRet;
  },
});

export const User: Model<IUserDocument> = mongoose.model<IUserDocument>('User', userSchema);

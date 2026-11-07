import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { User, IUserDocument } from '../../models/user.model';
import { AppError } from '../../utils/AppError';
import { RegisterInput, LoginInput } from './auth.schema';

export interface AuthTokens {
  token: string;
}

export interface AuthResponse {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    isActive: boolean;
    createdAt: Date;
  };
  token: string;
}

// Precomputed dummy bcrypt hash (cost 10) to prevent email enumeration timing attacks
const DUMMY_HASH = '$2b$10$by5R8kg2ZjcusuvjLTDltuD7kr4mxKymYX5RvxvpHXGALpJjcQLli';

export class AuthService {
  async register(input: RegisterInput): Promise<AuthResponse> {
    const existingUser = await User.findOne({ email: input.email.toLowerCase() });
    if (existingUser) {
      throw AppError.conflict('An account with this email address already exists');
    }

    const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_SALT_ROUNDS);

    // Register always creates a customer (never accepts role)
    const newUser = await User.create({
      name: input.name.trim(),
      email: input.email.toLowerCase().trim(),
      passwordHash,
      role: 'customer',
      isActive: true,
    });

    const token = this.generateToken(newUser);

    return {
      user: {
        id: newUser._id.toString(),
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        isActive: newUser.isActive,
        createdAt: newUser.createdAt,
      },
      token,
    };
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const user = await User.findOne({ email: input.email.toLowerCase().trim() }).select(
      '+passwordHash'
    );
    if (!user) {
      // Run comparison against dummy hash to mitigate user enumeration timing attacks
      await bcrypt.compare(input.password, DUMMY_HASH);
      throw AppError.unauthorized('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(input.password, user.passwordHash);
    if (!isPasswordValid) {
      throw AppError.unauthorized('Invalid credentials');
    }

    if (!user.isActive) {
      throw AppError.forbidden('User account is deactivated');
    }

    const token = this.generateToken(user);

    return {
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
      },
      token,
    };
  }

  private generateToken(user: IUserDocument): string {
    return jwt.sign(
      {
        id: user._id.toString(),
        role: user.role,
      },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'], algorithm: 'HS256' }
    );
  }
}

export const authService = new AuthService();

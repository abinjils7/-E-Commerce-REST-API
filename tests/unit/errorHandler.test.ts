import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { errorHandler } from '../../src/middlewares/errorHandler';
import { AppError } from '../../src/utils/AppError';

describe('Centralized Error Handler', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    mockReq = {
      method: 'GET',
      originalUrl: '/test-error',
    };
    mockRes = {
      status: statusMock,
    };
    mockNext = jest.fn();
  });

  it('maps ZodError to 422 with structured field errors', () => {
    const schema = z.object({
      email: z.string().email(),
      age: z.number().min(18),
    });

    try {
      schema.parse({ email: 'invalid-email', age: 10 });
    } catch (err) {
      errorHandler(err as ZodError, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(422);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Validation failed',
          errors: expect.arrayContaining([
            expect.objectContaining({ field: 'email' }),
            expect.objectContaining({ field: 'age' }),
          ]),
        })
      );
    }
  });

  it('maps AppError to its specified statusCode', () => {
    const error = AppError.notFound('Product not found');
    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({
      success: false,
      message: 'Product not found',
    });
  });

  it('maps AppError with custom errors payload', () => {
    const error = AppError.conflict('Out of stock', { item: 'SKU123' });
    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    expect(statusMock).toHaveBeenCalledWith(409);
    expect(jsonMock).toHaveBeenCalledWith({
      success: false,
      message: 'Out of stock',
      errors: { item: 'SKU123' },
    });
  });

  it('maps Mongoose CastError to 400', () => {
    const castError = new mongoose.Error.CastError('ObjectId', 'invalid-id', '_id');
    errorHandler(castError, mockReq as Request, mockRes as Response, mockNext);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining("Invalid _id: 'invalid-id' is not a valid format"),
      })
    );
  });

  it('maps MongoDB duplicate key (E11000) to 409', () => {
    const mongoDuplicateError = {
      code: 11000,
      keyValue: { email: 'duplicate@example.com' },
    };
    errorHandler(mongoDuplicateError, mockReq as Request, mockRes as Response, mockNext);

    expect(statusMock).toHaveBeenCalledWith(409);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('Duplicate key error'),
        errors: { email: 'duplicate@example.com' },
      })
    );
  });

  it('maps Mongoose ValidationError to 422', () => {
    const validationError = new mongoose.Error.ValidationError();
    validationError.addError(
      'name',
      new mongoose.Error.ValidatorError({ message: 'Name is required', path: 'name' })
    );

    errorHandler(validationError, mockReq as Request, mockRes as Response, mockNext);

    expect(statusMock).toHaveBeenCalledWith(422);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'Validation error',
        errors: expect.arrayContaining([
          expect.objectContaining({ field: 'name', message: 'Name is required' }),
        ]),
      })
    );
  });

  it('maps JWT JsonWebTokenError to 401', () => {
    const jwtError = new jwt.JsonWebTokenError('invalid signature');
    errorHandler(jwtError, mockReq as Request, mockRes as Response, mockNext);

    expect(statusMock).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith({
      success: false,
      message: 'Invalid token',
    });
  });

  it('maps JWT TokenExpiredError to 401', () => {
    const expiredError = new jwt.TokenExpiredError('jwt expired', new Date());
    errorHandler(expiredError, mockReq as Request, mockRes as Response, mockNext);

    expect(statusMock).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith({
      success: false,
      message: 'Token expired',
    });
  });

  it('maps unhandled generic Error to 500 without leaking stack traces in test/prod', () => {
    const genericError = new Error('Unexpected database failure');
    errorHandler(genericError, mockReq as Request, mockRes as Response, mockNext);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      success: false,
      message: 'Internal server error',
    });
    expect(jsonMock).not.toHaveProperty('stack');
  });

  describe('body-parser errors', () => {
    it('maps entity.parse.failed to 400 "Malformed JSON body"', () => {
      const bpError = {
        type: 'entity.parse.failed',
        status: 400,
        body: '{ "invalid": json }',
      };
      errorHandler(bpError, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Malformed JSON body',
        })
      );
      expect(jsonMock).not.toHaveProperty('stack');
    });

    it('maps entity.too.large (status 413) to 413 "Request body too large"', () => {
      const bpError = {
        type: 'entity.too.large',
        status: 413,
        limit: 1048576,
      };
      errorHandler(bpError, mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(413);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Request body too large',
        })
      );
      expect(jsonMock).not.toHaveProperty('stack');
    });
  });
});

import { Request, Response } from 'express';
import { orderService } from './order.service';
import { CreateOrderInput, UpdateOrderStatusInput, GetOrdersQueryInput } from './order.schema';
import { AppError } from '../../utils/AppError';

export class OrderController {
  async createOrder(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      throw AppError.unauthorized('Authentication required');
    }

    const input = req.body as CreateOrderInput;
    const idempotencyKey = (req.headers['idempotency-key'] || req.headers['Idempotency-Key']) as
      string | undefined;

    const result = await orderService.createOrder(req.user._id.toString(), input, idempotencyKey);

    const statusCode = result.isReplay ? 200 : 201;
    res.status(statusCode).json({
      success: true,
      message: result.isReplay ? 'Order replayed successfully' : 'Order placed successfully',
      data: result.order,
    });
  }

  async updateOrderStatus(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      throw AppError.unauthorized('Authentication required');
    }

    const { id } = req.params;
    const input = req.body as UpdateOrderStatusInput;

    const order = await orderService.updateOrderStatus(
      id as string,
      req.user._id.toString(),
      input
    );

    res.status(200).json({
      success: true,
      message: `Order status updated to '${order.status}'`,
      data: order,
    });
  }

  async getMyOrders(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      throw AppError.unauthorized('Authentication required');
    }

    const query = req.query as unknown as GetOrdersQueryInput;
    const { orders, meta } = await orderService.getMyOrders(req.user._id.toString(), query);

    res.status(200).json({
      success: true,
      message: 'Orders retrieved successfully',
      data: orders,
      meta,
    });
  }

  async getOrderById(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      throw AppError.unauthorized('Authentication required');
    }

    const { id } = req.params;
    const isAdmin = req.user.role === 'admin';

    const order = await orderService.getOrderById(id as string, req.user._id.toString(), isAdmin);

    res.status(200).json({
      success: true,
      message: 'Order retrieved successfully',
      data: order,
    });
  }

  async getAllOrders(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as GetOrdersQueryInput;
    const { orders, meta } = await orderService.getAllOrders(query);

    res.status(200).json({
      success: true,
      message: 'Admin orders retrieved successfully',
      data: orders,
      meta,
    });
  }
}

export const orderController = new OrderController();

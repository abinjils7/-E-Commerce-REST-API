import { Request, Response } from 'express';
import { productService } from './product.service';
import {
  CreateProductInput,
  UpdateProductInput,
  AdjustStockInput,
  CustomerProductQueryInput,
  AdminProductQueryInput,
} from './product.schema';

export class ProductController {
  async createProduct(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateProductInput;
    const product = await productService.createProduct(input);

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: product,
    });
  }

  async updateProduct(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const input = req.body as UpdateProductInput;
    const product = await productService.updateProduct(id as string, input);

    res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      data: product,
    });
  }

  async adjustStock(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const input = req.body as AdjustStockInput;
    const product = await productService.adjustStock(id as string, input);

    res.status(200).json({
      success: true,
      message: 'Product stock adjusted successfully',
      data: product,
    });
  }

  async deleteProduct(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const product = await productService.deleteProduct(id as string);

    res.status(200).json({
      success: true,
      message: 'Product soft-deleted successfully (status: inactive)',
      data: product,
    });
  }

  async getProducts(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as CustomerProductQueryInput;
    const { data, meta } = await productService.getProductsForCustomers(query);

    res.status(200).json({
      success: true,
      message: 'Products retrieved successfully',
      data,
      meta,
    });
  }

  async getAdminProducts(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as AdminProductQueryInput;
    const { data, meta } = await productService.getProductsForAdmin(query);

    res.status(200).json({
      success: true,
      message: 'Admin products retrieved successfully',
      data,
      meta,
    });
  }

  async getProductById(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const product = await productService.getProductById(id as string);

    res.status(200).json({
      success: true,
      message: 'Product retrieved successfully',
      data: product,
    });
  }
}

export const productController = new ProductController();

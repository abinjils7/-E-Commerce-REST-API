import { Request, Response } from 'express';
import { categoryService } from './category.service';
import {
  CreateCategoryInput,
  UpdateCategoryInput,
  GetCategoriesQueryInput,
} from './category.schema';

export class CategoryController {
  async createCategory(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateCategoryInput;
    const category = await categoryService.createCategory(input);

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: category,
    });
  }

  async updateCategory(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const input = req.body as UpdateCategoryInput;
    const category = await categoryService.updateCategory(id as string, input);

    res.status(200).json({
      success: true,
      message: 'Category updated successfully',
      data: category,
    });
  }

  async deleteCategory(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    await categoryService.deleteCategory(id as string);

    res.status(204).send();
  }

  async getCategories(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as GetCategoriesQueryInput;
    const { categories, meta } = await categoryService.getCategories(query);

    res.status(200).json({
      success: true,
      message: 'Categories retrieved successfully',
      data: categories,
      meta,
    });
  }

  async getCategoryTree(_req: Request, res: Response): Promise<void> {
    const tree = await categoryService.getCategoryTree();

    res.status(200).json({
      success: true,
      message: 'Category tree retrieved successfully',
      data: tree,
    });
  }

  async getCategoryById(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const category = await categoryService.getCategoryById(id as string);

    res.status(200).json({
      success: true,
      message: 'Category retrieved successfully',
      data: category,
    });
  }
}

export const categoryController = new CategoryController();

import mongoose, { Types } from 'mongoose';
import { Category, ICategoryDocument } from '../../models/category.model';
import { Product } from '../../models/product.model';
import { AppError } from '../../utils/AppError';
import { getUseTransactions } from '../../config/env';
import {
  CreateCategoryInput,
  UpdateCategoryInput,
  GetCategoriesQueryInput,
} from './category.schema';
import { detectCycle, buildTree, CategoryTreeNode } from './category.tree';
import { getPagination, buildPaginationMeta, PaginationMeta } from '../../utils/pagination';

export const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
};

export class CategoryService {
  async createCategory(input: CreateCategoryInput): Promise<ICategoryDocument> {
    const slug = input.slug || slugify(input.name);

    let parentId: Types.ObjectId | null = null;
    let ancestors: Types.ObjectId[] = [];

    if (input.parent) {
      parentId = new Types.ObjectId(input.parent);
      const parent = await Category.findById(parentId);
      if (!parent) {
        throw AppError.badRequest('Parent category does not exist');
      }
      if (!parent.isActive) {
        throw AppError.badRequest('Parent category is inactive');
      }
      ancestors = [...parent.ancestors, parent._id as Types.ObjectId];
    }

    try {
      const category = await Category.create({
        name: input.name.trim(),
        slug,
        description: input.description?.trim(),
        parent: parentId,
        ancestors,
        isActive: input.isActive ?? true,
      });

      return category;
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: number }).code === 11000
      ) {
        throw AppError.conflict(
          'Category with this slug or name under the same parent already exists'
        );
      }
      throw error;
    }
  }

  async updateCategory(id: string, input: UpdateCategoryInput): Promise<ICategoryDocument> {
    const category = await Category.findById(id);
    if (!category) {
      throw AppError.notFound('Category not found');
    }

    let isRelocating = false;
    let newAncestors: Types.ObjectId[] = [];
    let newPrefix: Types.ObjectId[] = [];
    let oldPrefix: Types.ObjectId[] = [];
    let newParentId: Types.ObjectId | null = null;

    // Parent relocation handling
    if (input.parent !== undefined) {
      const newParentIdStr = input.parent;
      const currentParentIdStr = category.parent ? category.parent.toString() : null;

      if (newParentIdStr !== currentParentIdStr) {
        isRelocating = true;
        oldPrefix = [...category.ancestors, category._id as Types.ObjectId];

        if (newParentIdStr !== null) {
          newParentId = new Types.ObjectId(newParentIdStr);
          const newParentDoc = await Category.findById(newParentId);
          if (!newParentDoc) {
            throw AppError.badRequest('New parent category does not exist');
          }
          if (!newParentDoc.isActive) {
            throw AppError.badRequest('New parent category is inactive');
          }

          // Cycle check
          const hasCycle = detectCycle(
            category._id as Types.ObjectId,
            newParentId,
            newParentDoc.ancestors
          );
          if (hasCycle) {
            throw AppError.badRequest(
              'Cannot move category: cycle detected or self-parenting is invalid'
            );
          }

          newAncestors = [...newParentDoc.ancestors, newParentDoc._id as Types.ObjectId];
          newPrefix = [...newAncestors, category._id as Types.ObjectId];
        } else {
          // Moving to root
          newAncestors = [];
          newPrefix = [category._id as Types.ObjectId];
        }

        category.parent = newParentId;
        category.ancestors = newAncestors;
      }
    }

    if (input.name) {
      category.name = input.name.trim();
    }
    if (input.slug) {
      category.slug = input.slug.trim();
    }
    if (input.description !== undefined) {
      category.description = input.description.trim();
    }
    if (input.isActive !== undefined) {
      category.isActive = input.isActive;
    }

    // Pre-check for sibling collisions under target parent (excluding this category itself)
    const targetParent = category.parent;
    const siblingCollision = await Category.findOne({
      _id: { $ne: category._id },
      parent: targetParent,
      $or: [{ name: category.name }, { slug: category.slug }],
    });
    if (siblingCollision) {
      throw AppError.conflict(
        'Category with this slug or name under the target parent already exists'
      );
    }

    const useTx = getUseTransactions();

    if (isRelocating) {
      const descendantsPipeline = [
        {
          $set: {
            ancestors: {
              $concatArrays: [
                newPrefix,
                {
                  $slice: ['$ancestors', oldPrefix.length, { $size: '$ancestors' }],
                },
              ],
            },
          },
        },
      ];

      const reverseDescendantsPipeline = [
        {
          $set: {
            ancestors: {
              $concatArrays: [
                oldPrefix,
                {
                  $slice: ['$ancestors', newPrefix.length, { $size: '$ancestors' }],
                },
              ],
            },
          },
        },
      ];

      if (useTx) {
        const session = await mongoose.startSession();
        try {
          await session.withTransaction(async () => {
            await Category.updateMany({ ancestors: category._id }, descendantsPipeline, {
              session,
            });
            await category.save({ session });
          });
          return category;
        } catch (error: unknown) {
          if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            (error as { code: number }).code === 11000
          ) {
            throw AppError.conflict(
              'Category with this slug or name under the same parent already exists'
            );
          }
          throw error;
        } finally {
          await session.endSession();
        }
      } else {
        await Category.updateMany({ ancestors: category._id }, descendantsPipeline);
        try {
          await category.save();
          return category;
        } catch (error: unknown) {
          // Revert descendants' ancestors if saving the node fails in non-transaction mode
          try {
            await Category.updateMany({ ancestors: category._id }, reverseDescendantsPipeline);
          } catch {
            // Log or ignore revert failure to rethrow original error
          }
          if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            (error as { code: number }).code === 11000
          ) {
            throw AppError.conflict(
              'Category with this slug or name under the same parent already exists'
            );
          }
          throw error;
        }
      }
    } else {
      try {
        await category.save();
        return category;
      } catch (error: unknown) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code: number }).code === 11000
        ) {
          throw AppError.conflict(
            'Category with this slug or name under the same parent already exists'
          );
        }
        throw error;
      }
    }
  }

  async deleteCategory(id: string): Promise<void> {
    const category = await Category.findById(id);
    if (!category) {
      throw AppError.notFound('Category not found');
    }

    // 1. Guard against child categories (blocks on ANY children, active or inactive)
    const childCategory = await Category.findOne({ parent: category._id });
    if (childCategory) {
      throw AppError.conflict('Cannot delete category: child categories exist');
    }

    // 2. Guard against associated products (pending full product lifecycle testing in Phase 4)
    const associatedProduct = await Product.findOne({ category: category._id });
    if (associatedProduct) {
      throw AppError.conflict('Cannot delete category: products are assigned to this category');
    }

    await Category.findByIdAndDelete(category._id);
  }

  async getCategories(
    query: GetCategoriesQueryInput
  ): Promise<{ categories: ICategoryDocument[]; meta: PaginationMeta }> {
    const { page, limit, skip } = getPagination({
      page: query.page,
      limit: query.limit,
      defaultLimit: 20,
      maxLimit: 50,
    });

    const filter: Record<string, unknown> = {};
    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    }
    if (query.parent !== undefined) {
      filter.parent =
        query.parent === 'null' || query.parent === null ? null : new Types.ObjectId(query.parent);
    }

    const [categories, total] = await Promise.all([
      Category.find(filter).sort({ name: 1 }).skip(skip).limit(limit),
      Category.countDocuments(filter),
    ]);

    return {
      categories,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async getCategoryTree(): Promise<CategoryTreeNode[]> {
    // Single query for active categories, ordered consistently
    const categories = await Category.find({ isActive: true }).sort({ name: 1 }).lean();
    return buildTree(categories);
  }

  async getCategoryById(id: string): Promise<ICategoryDocument> {
    const category = await Category.findById(id);
    if (!category) {
      throw AppError.notFound('Category not found');
    }
    return category;
  }
}

export const categoryService = new CategoryService();

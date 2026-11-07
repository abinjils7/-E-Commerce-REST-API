import { Types } from 'mongoose';
import {
  buildTree,
  detectCycle,
  CategoryInputDoc,
} from '../../src/modules/categories/category.tree';

describe('Category Tree & Cycle Pure Helpers', () => {
  describe('detectCycle()', () => {
    const idA = new Types.ObjectId().toString();
    const idB = new Types.ObjectId().toString();
    const idC = new Types.ObjectId().toString();

    it('returns false when newParent is null (moving to root)', () => {
      expect(detectCycle(idA, null, [])).toBe(false);
    });

    it('returns true when a category is set as its own parent (self-parenting)', () => {
      expect(detectCycle(idA, idA, [])).toBe(true);
    });

    it('returns true when newParent is a descendant of the category (cycle)', () => {
      // B is a descendant of A, so B's ancestors = [A]
      expect(detectCycle(idA, idB, [idA])).toBe(true);

      // C is a deep descendant of A, ancestors = [A, B]
      expect(detectCycle(idA, idC, [idA, idB])).toBe(true);
    });

    it('returns false for a valid relocation to an unrelated node', () => {
      const idD = new Types.ObjectId().toString();
      // Moving A under D, where D's ancestors are empty or unrelated
      expect(detectCycle(idA, idD, [])).toBe(false);
      expect(detectCycle(idA, idD, [new Types.ObjectId().toString()])).toBe(false);
    });
  });

  describe('buildTree()', () => {
    it('returns empty array when given an empty category list', () => {
      expect(buildTree([])).toEqual([]);
    });

    it('builds flat root nodes when all categories have parent = null', () => {
      const id1 = new Types.ObjectId();
      const id2 = new Types.ObjectId();
      const categories: CategoryInputDoc[] = [
        {
          _id: id1,
          name: 'Electronics',
          slug: 'electronics',
          parent: null,
          ancestors: [],
          isActive: true,
        },
        {
          _id: id2,
          name: 'Clothing',
          slug: 'clothing',
          parent: null,
          ancestors: [],
          isActive: true,
        },
      ];

      const tree = buildTree(categories);
      expect(tree).toHaveLength(2);
      expect(tree[0]?.id).toBe(id1.toString());
      expect(tree[0]?.children).toEqual([]);
      expect(tree[1]?.id).toBe(id2.toString());
      expect(tree[1]?.children).toEqual([]);
    });

    it('correctly nests multi-level hierarchies regardless of input order', () => {
      const id1 = new Types.ObjectId(); // Level 1: Electronics
      const id2 = new Types.ObjectId(); // Level 2: Computers
      const id3 = new Types.ObjectId(); // Level 3: Laptops
      const id4 = new Types.ObjectId(); // Level 4: Gaming Laptops

      // Provided out of order to ensure robust tree construction
      const categories: CategoryInputDoc[] = [
        {
          _id: id3,
          name: 'Laptops',
          slug: 'laptops',
          parent: id2,
          ancestors: [id1, id2],
          isActive: true,
        },
        {
          _id: id1,
          name: 'Electronics',
          slug: 'electronics',
          parent: null,
          ancestors: [],
          isActive: true,
        },
        {
          _id: id4,
          name: 'Gaming Laptops',
          slug: 'gaming-laptops',
          parent: id3,
          ancestors: [id1, id2, id3],
          isActive: true,
        },
        {
          _id: id2,
          name: 'Computers',
          slug: 'computers',
          parent: id1,
          ancestors: [id1],
          isActive: true,
        },
      ];

      const tree = buildTree(categories);

      // Only Level 1 should be at the root
      expect(tree).toHaveLength(1);
      const root = tree[0]!;
      expect(root.name).toBe('Electronics');
      expect(root.children).toHaveLength(1);

      // Level 2
      const level2 = root.children[0]!;
      expect(level2.name).toBe('Computers');
      expect(level2.children).toHaveLength(1);

      // Level 3
      const level3 = level2.children[0]!;
      expect(level3.name).toBe('Laptops');
      expect(level3.children).toHaveLength(1);

      // Level 4
      const level4 = level3.children[0]!;
      expect(level4.name).toBe('Gaming Laptops');
      expect(level4.children).toHaveLength(0);
    });

    it('treats orphan nodes whose parent is missing from input as root nodes', () => {
      const missingParentId = new Types.ObjectId();
      const orphanId = new Types.ObjectId();

      const categories: CategoryInputDoc[] = [
        {
          _id: orphanId,
          name: 'Orphan Category',
          slug: 'orphan',
          parent: missingParentId,
          ancestors: [missingParentId],
          isActive: true,
        },
      ];

      const tree = buildTree(categories);
      expect(tree).toHaveLength(1);
      expect(tree[0]?.id).toBe(orphanId.toString());
    });
  });
});

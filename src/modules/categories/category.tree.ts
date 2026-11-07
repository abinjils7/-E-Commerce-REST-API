import { Types } from 'mongoose';

export interface CategoryInputDoc {
  _id: Types.ObjectId | string;
  name: string;
  slug: string;
  description?: string;
  parent: Types.ObjectId | string | null;
  ancestors: (Types.ObjectId | string)[];
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CategoryTreeNode {
  id: string;
  name: string;
  slug: string;
  description?: string;
  parent: string | null;
  ancestors: string[];
  isActive: boolean;
  children: CategoryTreeNode[];
}

/**
 * Pure function to check if moving a category under a new parent would cause a cycle.
 * Returns true if cycle detected, false otherwise.
 *
 * Rules:
 * 1. A category cannot be its own parent (self-parenting).
 * 2. A category cannot have one of its descendants as its new parent.
 */
export const detectCycle = (
  categoryId: Types.ObjectId | string,
  newParentId: Types.ObjectId | string | null,
  newParentAncestors: (Types.ObjectId | string)[] = []
): boolean => {
  if (!newParentId) {
    return false;
  }

  const categoryIdStr = categoryId.toString();
  const newParentIdStr = newParentId.toString();

  // Rule 1: Cannot be parent to itself
  if (categoryIdStr === newParentIdStr) {
    return true;
  }

  // Rule 2: Cannot have a descendant as parent (cycle)
  return newParentAncestors.some((anc) => anc.toString() === categoryIdStr);
};

/**
 * Pure function to build a hierarchical tree from a flat list of categories in memory.
 * Runs in O(N) time and O(N) space using a single map lookup pass.
 */
export const buildTree = (categories: CategoryInputDoc[]): CategoryTreeNode[] => {
  const nodeMap = new Map<string, CategoryTreeNode>();
  const roots: CategoryTreeNode[] = [];

  // Step 1: Initialize all tree nodes
  for (const cat of categories) {
    const id = cat._id.toString();
    nodeMap.set(id, {
      id,
      name: cat.name,
      slug: cat.slug,
      description: cat.description,
      parent: cat.parent ? cat.parent.toString() : null,
      ancestors: (cat.ancestors || []).map((a) => a.toString()),
      isActive: cat.isActive,
      children: [],
    });
  }

  // Step 2: Assemble parent-child hierarchy in a single pass
  for (const cat of categories) {
    const id = cat._id.toString();
    const currentNode = nodeMap.get(id);
    if (!currentNode) continue;

    if (!cat.parent) {
      roots.push(currentNode);
    } else {
      const parentIdStr = cat.parent.toString();
      const parentNode = nodeMap.get(parentIdStr);
      if (parentNode) {
        parentNode.children.push(currentNode);
      } else {
        // If parent is not in the list (e.g. inactive or filtered out), treat node as root
        roots.push(currentNode);
      }
    }
  }

  return roots;
};

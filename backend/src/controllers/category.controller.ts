import { Request, Response } from 'express';
import { asyncHandler } from '../utils/errorHandler';
import prisma from '../config/database';

/**
 * Get all categories
 * GET /api/categories
 */
export const getCategories = asyncHandler(async (req: Request, res: Response) => {
  const { search } = req.query;

  const where: any = {};

  if (search) {
    where.name = {
      contains: search as string,
      mode: 'insensitive',
    };
  }

  const categories = await prisma.category.findMany({
    where,
    orderBy: { name: 'asc' },
    include: {
      _count: {
        select: {
          products: {
            where: { isActive: true },
          },
        },
      },
    },
  });

  res.json({
    success: true,
    data: categories,
  });
});

/**
 * Get single category
 * GET /api/categories/:id
 */
export const getCategory = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const category = await prisma.category.findUnique({
    where: { id },
    include: {
      products: true,
      _count: {
        select: { products: true },
      },
    },
  });

  if (!category) {
    res.status(404).json({
      success: false,
      error: 'Category not found',
    });
    return;
  }

  res.json({
    success: true,
    data: category,
  });
});

/**
 * Create category
 * POST /api/categories
 */
export const createCategory = asyncHandler(async (req: Request, res: Response) => {
  const { name, description, color, icon, parentId } = req.body;

  if (!name) {
    res.status(400).json({
      success: false,
      error: 'Category name is required',
    });
    return;
  }

  // Check if category with same name exists
  const existing = await prisma.category.findFirst({
    where: {
      name: {
        equals: name,
        mode: 'insensitive',
      },
    },
  });

  if (existing) {
    res.status(400).json({
      success: false,
      error: 'Category with this name already exists',
    });
    return;
  }

  const category = await prisma.category.create({
    data: {
      name,
      description,
      color,
      icon,
      parentId,
    },
  });

  res.status(201).json({
    success: true,
    data: category,
  });
});

/**
 * Update category
 * PUT /api/categories/:id
 */
export const updateCategory = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, description, color, icon, parentId } = req.body;

  const category = await prisma.category.findUnique({
    where: { id },
  });

  if (!category) {
    res.status(404).json({
      success: false,
      error: 'Category not found',
    });
    return;
  }

  // Check if new name conflicts with existing category
  if (name && name !== category.name) {
    const existing = await prisma.category.findFirst({
      where: {
        name: {
          equals: name,
          mode: 'insensitive',
        },
        id: { not: id },
      },
    });

    if (existing) {
      res.status(400).json({
        success: false,
        error: 'Category with this name already exists',
      });
      return;
    }
  }

  const updated = await prisma.category.update({
    where: { id },
    data: {
      name,
      description,
      color,
      icon,
      parentId,
    },
  });

  res.json({
    success: true,
    data: updated,
  });
});

/**
 * Delete category
 * DELETE /api/categories/:id
 */
export const deleteCategory = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const category = await prisma.category.findUnique({
    where: { id },
    include: {
      _count: {
        select: { products: true },
      },
    },
  });

  if (!category) {
    res.status(404).json({
      success: false,
      error: 'Category not found',
    });
    return;
  }

  // Check if category has products
  if (category._count.products > 0) {
    res.status(400).json({
      success: false,
      error: `Cannot delete category with ${category._count.products} products. Please reassign or delete the products first.`,
    });
    return;
  }

  await prisma.category.delete({
    where: { id },
  });

  res.json({
    success: true,
    message: 'Category deleted successfully',
  });
});
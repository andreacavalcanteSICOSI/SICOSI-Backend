// pages/api/categories/[categoryKey].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import alternativesData from '../../../data/alternatives.json';

// Tipo inferido do JSON real
type CategoryData = (typeof alternativesData.categories)[keyof typeof alternativesData.categories];

interface CategorySuccessResponse {
  success: true;
  category: string;
  data: CategoryData;
}

interface CategoryErrorResponse {
  success: false;
  error: string;
}

type CategoryResponse = CategorySuccessResponse | CategoryErrorResponse;

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<CategoryResponse>
): void {
  try {
    const { categoryKey } = req.query;

    // Validação do parâmetro
    if (typeof categoryKey !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid category key'
      });
    }

    const categoryData = alternativesData.categories[categoryKey as keyof typeof alternativesData.categories];

    if (!categoryData) {
      return res.status(404).json({
        success: false,
        error: `Category not found: ${categoryKey}`
      });
    }

    res.status(200).json({
      success: true,
      category: categoryKey,
      data: categoryData
    });
  } catch (error) {
    console.error('❌ Category error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// pages/api/categories/index.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import alternativesData from '../../../data/alternatives.json';

// Tipos baseados na estrutura REAL do alternatives.json
interface AlternativesMetadata {
  total_categories: number;
  new_categories_added: string[];
  coverage: string;
  standards_referenced: string[];
  special_focus: {
    [key: string]: string;
  };
}

interface CategoriesSuccessResponse {
  success: true;
  categories: typeof alternativesData.categories; // Usar tipo inferido do JSON
  metadata: AlternativesMetadata;
  totalCategories: number;
}

interface CategoriesErrorResponse {
  success: false;
  error: string;
}

type CategoriesResponse = CategoriesSuccessResponse | CategoriesErrorResponse;

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<CategoriesResponse>
): void {
  try {
    res.status(200).json({
      success: true,
      categories: alternativesData.categories,
      metadata: alternativesData.metadata as AlternativesMetadata,
      totalCategories: Object.keys(alternativesData.categories).length
    });
  } catch (error) {
    console.error('❌ Categories error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
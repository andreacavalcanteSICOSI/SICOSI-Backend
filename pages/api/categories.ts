import type { NextApiRequest, NextApiResponse } from 'next';
import alternativesData from '../../data/alternatives.json';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const categories: Record<string, any> = {};

    for (const [key, data] of Object.entries(alternativesData.categories)) {
      categories[key] = {
        name: (data as any).name,
        keywords: (data as any).keywords || [],
        product_types: (data as any).product_types || [],
        exclusion_keywords: (data as any).exclusion_keywords || [],
      };
    }

    res.status(200).json({ categories });
  } catch (error) {
    console.error('Error loading categories:', error);
    res.status(500).json({ error: 'Failed to load categories' });
  }
}

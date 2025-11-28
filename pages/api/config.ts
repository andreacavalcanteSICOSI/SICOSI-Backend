import type { NextApiRequest, NextApiResponse } from 'next';
import alternativesData from '../../data/alternatives.json';
import config from '../../config';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const alternativesConfig = alternativesData as any;

  return res.status(200).json({
    minSustainabilityScore: config.sustainability.minScore,
    version: '1.0.0',
    categories: Object.keys(alternativesConfig.categories),
    totalCategories: Object.keys(alternativesConfig.categories).length,
  });
}

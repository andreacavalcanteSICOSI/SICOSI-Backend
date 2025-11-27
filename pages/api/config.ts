import { NextApiRequest, NextApiResponse } from 'next';
import alternativesData from '../../data/alternatives.json';
import config from '../../config';
import { AlternativesConfig } from '../../types';

const alternativesConfig = alternativesData as AlternativesConfig;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  return res.status(200).json({
    minSustainabilityScore: config.sustainability.minScore,
    version: '1.0.0',
    categories: Object.keys(alternativesConfig.categories),
  });
}

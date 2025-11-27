import alternativesData from '../data/alternatives.json';
import { AlternativesConfig } from '../types';

export interface ProductFacts {
  durability?: { score: number; evidence: string[] };
  repairability?: { score: number; evidence: string[] };
  recyclability?: { score: number; evidence: string[] };
  energy_efficiency?: { score: number; evidence: string[] };
  materials?: { score: number; evidence: string[] };
  certifications?: string[];
  origin?: string;
  [key: string]: any;
}

interface CategoryCriteria {
  [criterionName: string]: {
    weight: number;
    guidelines: string[];
  };
}

const alternativesConfig = alternativesData as AlternativesConfig;

/**
 * Calcula o score de sustentabilidade usando os pesos do alternatives.json
 */
export function calculateSustainabilityScore(
  facts: ProductFacts,
  category: string
): {
  finalScore: number;
  breakdown: Record<string, { score: number; weight: number; weighted: number }>;
  classification: string;
} {
  const categoryData = alternativesConfig.categories[category];

  if (!categoryData) {
    throw new Error(`Category ${category} not found`);
  }

  const criteria: CategoryCriteria = categoryData.sustainability_criteria;
  const breakdown: Record<string, { score: number; weight: number; weighted: number }> = {};
  let totalWeightedScore = 0;
  let totalWeight = 0;

  for (const [criterionName, criterionConfig] of Object.entries(criteria)) {
    const weight = criterionConfig.weight;
    const factScore = facts?.[criterionName]?.score ?? 0;
    const weightedScore = factScore * weight;

    breakdown[criterionName] = {
      score: factScore,
      weight,
      weighted: weightedScore
    };

    totalWeightedScore += weightedScore;
    totalWeight += weight;
  }

  const finalScore = totalWeight > 0 ? totalWeightedScore : 0;

  let classification = 'poor';
  if (finalScore >= 90) classification = 'excellent';
  else if (finalScore >= 70) classification = 'good';
  else if (finalScore >= 50) classification = 'acceptable';

  return {
    finalScore: Math.round(finalScore),
    breakdown,
    classification
  };
}

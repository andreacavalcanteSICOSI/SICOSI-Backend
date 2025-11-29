import { AlternativesConfig, CategoryConfig } from '../types';

interface CriterionEvaluation {
  score: number;
  evidence: string[];
}

export interface ProductFacts {
  [criterionName: string]: CriterionEvaluation | string[] | string | undefined;
  certifications?: string[];
  origin?: string;
}

interface ScoreBreakdown {
  [criterionName: string]: {
    score: number;
    weight: number;
    weighted: number;
  };
}

export interface SustainabilityScore {
  finalScore: number;
  breakdown: ScoreBreakdown;
  classification: 'excellent' | 'good' | 'acceptable' | 'poor';
}

const DEFAULT_WEIGHTS: Record<string, number> = {
  durability: 0.2,
  repairability: 0.2,
  recyclability: 0.2,
  energy_efficiency: 0.2,
  materials: 0.2,
};

/**
 * Calcula o score de sustentabilidade de forma DETERMINÍSTICA
 * usando os pesos definidos no alternatives.json
 */
export function calculateSustainabilityScore(
  facts: ProductFacts,
  category: string,
  categories: AlternativesConfig['categories'] | Record<string, CategoryConfig>,
): SustainabilityScore {
  const categoryData = category ? categories[category] : undefined;

  if (!categoryData?.sustainability_criteria) {
    console.warn(`[SICOSI] Category "${category}" not found, using default weights`);
  }

  const criteria = categoryData?.sustainability_criteria || {};

  const weights: Record<string, number> = {};

  for (const [criterionName, criterionConfig] of Object.entries(criteria) as [string, any][]) {
    weights[criterionName] = criterionConfig.weight || 0;
  }

  if (Object.keys(weights).length === 0) {
    console.warn(`[SICOSI] No criteria found for category "${category}", using defaults`);
    Object.assign(weights, DEFAULT_WEIGHTS);
  }

  console.log(`📊 [SCORING] Using weights for category "${category}":`, weights);

  const breakdown: ScoreBreakdown = {};

  let totalWeightedScore = 0;
  let totalWeight = 0;

  // Para cada critério de sustentabilidade
  for (const [criterionName, weight] of Object.entries(weights)) {
    const criterionData = facts[criterionName];
    const score =
      typeof criterionData === 'object' && criterionData !== null && 'score' in criterionData
        ? (criterionData as CriterionEvaluation).score || 0
        : 0;

    const weightedScore = score * weight;

    breakdown[criterionName] = {
      score: score,
      weight: weight,
      weighted: weightedScore,
    };

    totalWeightedScore += weightedScore;
    totalWeight += weight;
  }

  // Score final (0-100)
  const finalScore = totalWeight > 0 ? Math.round(totalWeightedScore / totalWeight) : 0;

  // Classificação baseada no evaluation_methodology
  let classification: 'excellent' | 'good' | 'acceptable' | 'poor' = 'poor';
  if (finalScore >= 85) {
    classification = 'excellent';
  } else if (finalScore >= 70) {
    classification = 'good';
  } else if (finalScore >= 50) {
    classification = 'acceptable';
  }

  return {
    finalScore: Math.round(finalScore),
    breakdown,
    classification,
  };
}

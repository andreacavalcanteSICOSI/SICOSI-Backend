import alternativesData from '../data/alternatives.json';
import { AlternativesConfig, CategoryConfig } from '../types';

interface CriterionEvaluation {
  score: number;
  evidence: string[];
}

export interface ProductFacts {
  [criterionName: string]: CriterionEvaluation;
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

const DEFAULT_WEIGHTS = {
  durability: 0.25,
  repairability: 0.25,
  recyclability: 0.2,
  energy_efficiency: 0.15,
  materials: 0.15,
};

/**
 * Calcula o score de sustentabilidade de forma DETERMINÍSTICA
 * usando os pesos definidos no alternatives.json
 */
export function calculateSustainabilityScore(
  facts: ProductFacts,
  category: string,
  alternatives: AlternativesConfig | Record<string, CategoryConfig> = alternativesData as any,
): SustainabilityScore {
  const categories = 'categories' in alternatives ? (alternatives as AlternativesConfig).categories : alternatives;
  const categoryData = category ? categories[category] : undefined;

  let weights = { ...DEFAULT_WEIGHTS };

  if (categoryData?.sustainability_criteria) {
    const criteria = categoryData.sustainability_criteria;
    weights = {
      durability: criteria.durability?.weight ?? DEFAULT_WEIGHTS.durability,
      repairability: criteria.repairability?.weight ?? DEFAULT_WEIGHTS.repairability,
      recyclability: criteria.recyclability?.weight ?? DEFAULT_WEIGHTS.recyclability,
      energy_efficiency: criteria.energy_efficiency?.weight ?? DEFAULT_WEIGHTS.energy_efficiency,
      materials: criteria.materials?.weight ?? DEFAULT_WEIGHTS.materials,
    };
  } else {
    console.warn(`[SICOSI] Category "${category}" not found, using default weights`);
  }

  const breakdown: ScoreBreakdown = {};

  let totalWeightedScore = 0;
  let totalWeight = 0;

  // Para cada critério de sustentabilidade
  for (const [criterionName, weight] of Object.entries(weights)) {
    const criterionData = facts[criterionName];
    const score = criterionData?.score || 0;

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
  if (finalScore >= 90) {
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

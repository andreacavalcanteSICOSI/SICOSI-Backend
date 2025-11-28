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
  let resolvedCategory = category;

  if (!resolvedCategory || !categories[resolvedCategory]) {
    console.warn(`[SICOSI] Invalid category "${resolvedCategory}", using "other"`);
    resolvedCategory = 'other';
  }

  const categoryData = categories[resolvedCategory];

  if (!categoryData?.sustainability_criteria) {
    throw new Error(`Weights not found for category "${resolvedCategory}"`);
  }

  const criteria = categoryData.sustainability_criteria;
  const breakdown: ScoreBreakdown = {};

  let totalWeightedScore = 0;
  let totalWeight = 0;

  // Para cada critério da categoria (durability, repairability, etc.)
  for (const [criterionName, criterionConfig] of Object.entries(criteria) as [string, any][]) {
    const weight = criterionConfig.weight;

    // Pegar o score do critério extraído pelo LLM (0-100)
    const criterionData = facts[criterionName];
    const score = criterionData?.score || 0;

    // Calcular score ponderado
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
  const finalScore = totalWeight > 0 ? totalWeightedScore : 0;

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

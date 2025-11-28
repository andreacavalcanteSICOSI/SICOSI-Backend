import alternativesData from '../data/alternatives.json';

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
  category: string
): SustainabilityScore {
  const alternativesConfig = alternativesData as any;
  const categoryData = alternativesConfig.categories[category];

  if (!categoryData) {
    throw new Error(`Category ${category} not found in alternatives.json`);
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

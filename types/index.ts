// types/index.ts - Type Definitions

export interface SearchOptions {
  maxResults?: number;
  searchDepth?: 'basic' | 'advanced';
  includeImages?: boolean;
  includeAnswer?: boolean;
  includeDomains?: string[];
  excludeDomains?: string[];
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  score?: number;
}

export interface SearchResponse {
  success: boolean;
  query?: string;
  answer?: string | null;
  results: SearchResult[];
  images?: string[];
  error?: string;
  timestamp?: string;
}

export interface AnalysisOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ProductAnalysis {
  score: number;
  rating: 'excellent' | 'good' | 'acceptable' | 'poor';
  strengths: string[];
  weaknesses: string[];
  certifications_found: string[];
  recommendations: string[];
  summary: string;
}

export interface AnalysisResponse {
  success: boolean;
  analysis?: ProductAnalysis;
  model?: string;
  error?: string;
  timestamp?: string;
}

export interface Alternative {
  name: string;
  score: number;
  why_better: string;
  certifications: string[];
  url: string;
  price_range: string;
  key_features: string[];
}

export interface AlternativesAnalysis {
  alternatives: Alternative[];
}

export interface ProductInfo {
  productName?: string;
  selectedText?: string;
  description?: string;
  pageUrl?: string;
  searchResults?: SearchResult[];
}

// ===== TIPOS CORRIGIDOS PARA alternatives.json =====

export interface EvaluationThreshold {
  /** Target threshold and description for each performance level. */
  threshold: number;
  description: string;
}

export interface EvaluationCriteria {
  excellent: EvaluationThreshold;
  good: EvaluationThreshold;
  acceptable: EvaluationThreshold;
  poor: EvaluationThreshold;
}

export interface Indicator {
  /** Unique identifier for the indicator. */
  id: string;
  /** Human-readable name of the indicator. */
  name: string;
  /** Detailed description of what the indicator measures. */
  description: string;
  /** Optional measurement guidance for the indicator. */
  measurement?: string;
  /** Optional target or threshold description. */
  target?: string;
  /** Sources that can be used to validate the indicator. */
  data_sources?: string[];
  /** Structured evaluation criteria when available. */
  evaluation_criteria?: EvaluationCriteria;
  [key: string]: unknown;
}

export interface CriterionConfig {
  weight: number;
  indicators: Indicator[];
}

export interface CategoryConfig {
  name: string;
  keywords: string[];
  sustainability_criteria: Record<string, CriterionConfig>;
  certifications?: string[];
  references?: string[];
  brazilian_brands?: string[];
  keyword_synonyms?: Record<string, string[]>;
  exclusion_keywords?: string[];
  product_types?: string[];
  [key: string]: unknown;
}

export type CategoryData = CategoryConfig;

export interface ScoringConfig {
  source_weights: Record<string, number>;
  validation_thresholds: {
    minimum_score: number;
    confidence_ratio: number;
    exclusion_penalty: number;
  };
}

export interface EvaluationMethodology {
  description?: string;
  scoring?: Record<string, string>;
  steps?: string[];
  llm_prompt_template?: string;
  [key: string]: unknown;
}

export interface AlternativesConfig {
  version: string;
  description?: string;
  lastUpdated?: string;
  source?: string;
  categories: Record<string, CategoryConfig>;
  scoring_config?: ScoringConfig;
  evaluation_methodology?: EvaluationMethodology;
  metadata?: Record<string, unknown>;
  general_sustainability_principles?: Record<string, string[]>;
  brazilian_certifications?: Record<string, string>;
  common_translations?: Record<string, string>;
  incompatible_types?: Record<string, string[]>;
  text_processing?: Record<string, unknown>;
  'Web Search_config'?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CriterionEvaluation {
  score: number;
  evidence: string[];
}

export interface ProductFacts {
  [criterionName: string]: CriterionEvaluation | string[] | string | undefined;
  certifications?: string[];
  origin?: string;
}

export interface ScoreBreakdown {
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

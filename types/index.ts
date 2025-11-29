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

// Critério de sustentabilidade individual
export interface SustainabilityCriterion {
  weight: number;
  guidelines: string[];
}

// Objeto com múltiplos critérios
export interface SustainabilityCriteria {
  [key: string]: SustainabilityCriterion;
}

// Estrutura de uma categoria no alternatives.json
export interface CategoryData {
  name: string;
  keywords: string[];
  sustainability_criteria: SustainabilityCriteria;
  certifications: string[];
  references: string[];
  brazilian_brands?: string[];
  [key: string]: any; // Permite campos adicionais dinâmicos
}

// Metadata do alternatives.json
export interface AlternativesMetadata {
  total_categories: number;
  new_categories_added: string[];
  coverage: string;
  standards_referenced: string[];
  special_focus: {
    [key: string]: string;
  };
}

// Estrutura completa do alternatives.json
export interface AlternativesData {
  version: string;
  description: string;
  lastUpdated: string;
  source: string;
  metadata: AlternativesMetadata;
  categories: {
    [key: string]: CategoryData;
  };
}
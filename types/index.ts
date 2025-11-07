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

export interface SustainabilityCriteria {
  [key: string]: string | string[];
}

export interface CategoryData {
  name: string;
  description: string;
  sustainability_criteria: SustainabilityCriteria;
  certifications: string[];
  references?: string[];
}

export interface AlternativesData {
  metadata: {
    version: string;
    last_updated: string;
    description: string;
  };
  categories: {
    [key: string]: CategoryData;
  };
}

// ✅ REMOVIDO: export interface ApiResponse<T = any>
// Não é usado em nenhum lugar do código
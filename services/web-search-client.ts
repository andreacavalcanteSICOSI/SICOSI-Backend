// services/web-search-client.ts
import axios, { AxiosError } from 'axios';
import config from '@/config';
import type { SearchOptions, SearchResponse } from '@/types';

// ✅ Interface para tipar a resposta da API Tavily
interface TavilyResponse {
  answer?: string;
  results?: Array<{
    title: string;
    url: string;
    snippet: string;
    score?: number;
  }>;
  images?: string[];
}

class WebSearchClient {
  private apiKey: string | undefined;
  private baseUrl: string;

  constructor() {
    this.apiKey = config.tavily.apiKey;
    this.baseUrl = config.tavily.baseUrl;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const {
      maxResults = 5,
      searchDepth = 'basic',
      includeImages = false,
      includeAnswer = true,
      includeDomains = [],
      excludeDomains = []
    } = options;

    console.log('🔍 Tavily search:', query);

    if (!this.apiKey) {
      console.error('❌ Tavily API key not configured');
      return {
        success: false,
        error: 'Tavily API key not configured',
        results: []
      };
    }

    try {
      // ✅ Tipar a resposta do axios
      const response = await axios.post<TavilyResponse>(
        this.baseUrl,
        {
          api_key: this.apiKey,
          query,
          max_results: maxResults,
          search_depth: searchDepth,
          include_images: includeImages,
          include_answer: includeAnswer,
          include_domains: includeDomains,
          exclude_domains: excludeDomains
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        }
      );

      console.log('✅ Tavily search successful:', response.data.results?.length || 0, 'results');

      return {
        success: true,
        query,
        answer: response.data.answer || null,
        results: response.data.results || [],
        images: response.data.images || [],
        timestamp: new Date().toISOString()
      };

    } catch (error: unknown) {
      // ✅ CORREÇÃO 1: Type guard para AxiosError
      let errorMessage = 'Unknown error occurred';
      
      if (error instanceof AxiosError) {
        // Agora TypeScript sabe que error é AxiosError
        errorMessage = error.message;
        
        // Você pode acessar propriedades específicas:
        if (error.response) {
          console.error('Response error:', error.response.status, error.response.data);
        } else if (error.request) {
          console.error('Request error:', error.request);
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      console.error('❌ Tavily search error:', errorMessage);
      return {
        success: false,
        error: errorMessage,
        query,
        results: []
      };
    }
  }

  async searchProductSustainability(productName: string, category: string): Promise<SearchResponse> {
    const query = `${productName} ${category} sustainability environmental impact certifications eco-friendly`;
    return this.search(query, {
      maxResults: 5,
      searchDepth: 'basic',
      includeAnswer: true
    });
  }

  async searchSustainableAlternatives(
    productName: string, 
    category: string, 
    certifications: string[] = []
  ): Promise<SearchResponse> {
    const certsQuery = certifications.length > 0 
      ? certifications.join(' ') 
      : 'eco-friendly sustainable';
    
    const query = `sustainable eco-friendly ${category} alternatives to ${productName} ${certsQuery} certified`;
    
    return this.search(query, {
      maxResults: 10,
      searchDepth: 'advanced',
      includeAnswer: false
    });
  }

  async verifyProductClaims(productName: string, claims: string[]): Promise<SearchResponse> {
    const claimsQuery = claims.join(' ');
    const query = `${productName} ${claimsQuery} verification greenwashing fact check`;
    
    return this.search(query, {
      maxResults: 5,
      searchDepth: 'advanced',
      includeAnswer: true
    });
  }
}

// ✅ CORREÇÃO 2: Exportar com variável nomeada (ESLint)
const webSearchClient = new WebSearchClient();
export default webSearchClient;
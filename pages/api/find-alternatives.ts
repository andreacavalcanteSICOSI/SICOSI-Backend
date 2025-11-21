// pages/api/find-alternatives.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import webSearchClient from '@/services/web-search-client';
import groqClient from '@/services/groq-client';
import alternativesData from '@/data/alternatives.json';
import type { 
  ProductInfo, 
  ProductAnalysis, 
  Alternative, 
  SearchResult,
  AlternativesAnalysis
} from '@/types';

interface FindAlternativesResponse {
  success: boolean;
  alternatives?: Alternative[];
  searchResults?: SearchResult[];
  message?: string;
  timestamp?: string;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<FindAlternativesResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { productInfo, category, originalAnalysis } = req.body as {
      productInfo: ProductInfo;
      category: string;
      originalAnalysis: ProductAnalysis;
    };

    if (!productInfo || !category || !originalAnalysis) {
      return res.status(400).json({
        success: false,
        error: 'productInfo, category, and originalAnalysis are required'
      });
    }

    // ✅ CORRETO: Acessar category com index signature
    const categories = alternativesData.categories as Record<string, any>;
    const categoryData = categories[category];
    
    if (!categoryData) {
      return res.status(400).json({
        success: false,
        error: `Category not found: ${category}`
      });
    }

    console.log('🔍 Finding alternatives for:', productInfo.productName || productInfo.selectedText);

    // Step 1: Search
    const searchResults = await webSearchClient.searchSustainableAlternatives(
      productInfo.productName || productInfo.selectedText || '',
      categoryData.name,
      categoryData.certifications
    );

    if (!searchResults.success || searchResults.results.length === 0) {
      return res.status(200).json({
        success: true,
        alternatives: [],
        message: 'No alternatives found',
        timestamp: new Date().toISOString()
      });
    }

    // Step 2: Analyze with LLM
    const alternativesAnalysis = await groqClient.analyzeAlternatives(
      searchResults.results,
      categoryData,
      originalAnalysis
    );

    if (!alternativesAnalysis.success) {
      return res.status(500).json({
        success: false,
        error: alternativesAnalysis.error
      });
    }

    const analysisData = alternativesAnalysis.analysis as unknown as AlternativesAnalysis;

    res.status(200).json({
      success: true,
      alternatives: analysisData?.alternatives || [],
      searchResults: searchResults.results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const errorMessage = error instanceof Error 
      ? error.message 
      : 'Unknown error occurred';
    
    console.error('❌ Find alternatives error:', errorMessage);
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
}
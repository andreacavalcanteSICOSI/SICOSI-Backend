// pages/api/analyze-product.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import webSearchClient from '@/services/web-search-client';
import groqClient from '@/services/groq-client';
import alternativesData from '@/data/alternatives.json';
import type { ProductInfo, ProductAnalysis, SearchResult, AlternativesData } from '@/types';

interface AnalyzeProductResponse {
  success: boolean;
  productInfo?: ProductInfo;
  category?: string;
  categoryName?: string;
  searchResults?: SearchResult[];
  analysis?: ProductAnalysis;
  timestamp?: string;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AnalyzeProductResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { productInfo, category } = req.body as { 
      productInfo: ProductInfo; 
      category: string;
    };

    if (!productInfo || !category) {
      return res.status(400).json({
        success: false,
        error: 'productInfo and category are required'
      });
    }

    const data = alternativesData as AlternativesData;
    const categoryData = data.categories[category];
    
    if (!categoryData) {
      return res.status(400).json({
        success: false,
        error: `Category not found: ${category}`
      });
    }

    console.log('📊 Analyzing product:', productInfo.productName || productInfo.selectedText);

    // Step 1: Web search
    const searchResults = await webSearchClient.searchProductSustainability(
      productInfo.productName || productInfo.selectedText || '',
      categoryData.name
    );

    // Step 2: LLM analysis
    const context: ProductInfo = {
      ...productInfo,
      searchResults: searchResults.results
    };

    const analysis = await groqClient.analyzeProduct(context, categoryData);

    if (!analysis.success) {
      return res.status(500).json({
        success: false,
        error: analysis.error
      });
    }

    res.status(200).json({
      success: true,
      productInfo,
      category,
      categoryName: categoryData.name,
      searchResults: searchResults.results,
      analysis: analysis.analysis,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const errorMessage = error instanceof Error 
      ? error.message 
      : 'Unknown error occurred';
    
    console.error('❌ Analyze product error:', errorMessage);
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
}
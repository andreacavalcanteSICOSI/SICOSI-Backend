// pages/api/verify-claims.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import webSearchClient from '@/services/web-search-client';
import type { SearchResponse } from '@/types';

interface ErrorResponse {
  success: false;
  error: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SearchResponse | ErrorResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { productName, claims } = req.body as {
      productName?: string;
      claims?: string[];
    };

    if (!productName || !claims || !Array.isArray(claims)) {
      return res.status(400).json({
        success: false,
        error: 'productName and claims (array) are required'
      });
    }

    const results = await webSearchClient.verifyProductClaims(productName, claims);

    res.status(200).json(results);

  } catch (error) {
    const errorMessage = error instanceof Error 
      ? error.message 
      : 'Unknown error occurred';
    
    console.error('❌ Verify claims error:', errorMessage);
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
}
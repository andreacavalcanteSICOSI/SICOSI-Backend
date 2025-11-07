// pages/api/search.ts
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
    const { query, maxResults, searchDepth } = req.body as {
      query?: string;
      maxResults?: number;
      searchDepth?: 'basic' | 'advanced';
    };

    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query parameter is required'
      });
    }

    const results = await webSearchClient.search(query, {
      maxResults: maxResults || 5,
      searchDepth: searchDepth || 'basic'
    });

    res.status(200).json(results);

  } catch (error) {
    const errorMessage = error instanceof Error 
      ? error.message 
      : 'Unknown error occurred';
    
    console.error('❌ Search endpoint error:', errorMessage);
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
}
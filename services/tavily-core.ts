import axios from 'axios';
import config from '@/config';

interface TavilyClientOptions {
  apiKey?: string;
}

interface TavilySearchOptions {
  maxResults?: number;
  includeAnswer?: boolean;
  searchDepth?: 'basic' | 'advanced';
}

export default function tavily(options: TavilyClientOptions = {}) {
  const apiKey = options.apiKey || config.tavily.apiKey;
  const baseUrl = config.tavily.baseUrl;

  return {
    async search(query: string, searchOptions: TavilySearchOptions = {}) {
      const { maxResults = 10, includeAnswer = false, searchDepth = 'basic' } = searchOptions;

      const response = await axios.post(
        baseUrl,
        {
          api_key: apiKey,
          query,
          max_results: maxResults,
          search_depth: searchDepth,
          include_answer: includeAnswer,
        },
        { headers: { 'Content-Type': 'application/json' } },
      );

      return response.data;
    },
  };
}

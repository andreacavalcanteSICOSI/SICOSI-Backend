// config/index.ts - Configuration

interface Config {
  tavily: {
    apiKey: string | undefined;
    baseUrl: string;
  };
  groq: {
    apiKey: string | undefined;
    defaultModel: string;
    temperature: number;
    maxTokens: number;
  };
  sustainability: {
    minScore: number;
    keywords: string[];
  };
  search: {
    maxResults: number;
    depth: 'basic' | 'advanced';
    productUrlPatterns: string[];
    excludePatterns: string[];
  };
}

const config: Config = {
  tavily: {
    apiKey: process.env.TAVILY_API_KEY,
    baseUrl: 'https://api.tavily.com/search'
  },
  
  groq: {
    apiKey: process.env.GROQ_API_KEY,
    defaultModel: 'llama-3.3-70b-versatile',
    temperature: 0.3,
    maxTokens: 4000
  },

  sustainability: {
    minScore: 70,
    keywords: [
      'sustainable', 'eco', 'organic', 'fair trade', 'biodegradable',
      'recycled', 'natural', 'green', 'ethical', 'renewable',
      'sustentável', 'ecológico', 'orgânico', 'reciclado'
    ]
  },

  search: {
    maxResults: 30,
    depth: 'advanced',
    productUrlPatterns: [
      '/product/', '/p/', '/item/', '/dp/', '/listing/', 
      '/products/', '-p-', '/buy/', '/shop/'
    ],
    excludePatterns: [
      '/blog/', '/article/', '/news/', '/guide/', '/how-to/', 
      '/features/', '/best-', '/top-', '/review', '/compare',
      'wikipedia.', 'youtube.', '/forum/', '/category/'
    ]
  }
};

export default config;
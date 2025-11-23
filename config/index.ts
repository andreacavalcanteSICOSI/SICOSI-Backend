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
    operations: {
      translation: {
        temperature: number;
        maxTokens: number;
      };
      typeDetection: {
        temperature: number;
        maxTokens: number;
      };
      analysis: {
        temperature: number;
        maxTokens: number;
      };
    };
  };
  sustainability: {
    minScore: number;
    minAlternativeScore: number;
    leaderScoreRange: [number, number];
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
    defaultModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    temperature: 0.3,
    maxTokens: 4000,
    operations: {
      translation: {
        temperature: 0.1,
        maxTokens: 20
      },
      typeDetection: {
        temperature: 0.3,
        maxTokens: 50
      },
      analysis: {
        temperature: 0.2,
        maxTokens: 4000
      }
    }
  },

  sustainability: {
    minScore: parseInt(process.env.MIN_SUSTAINABILITY_SCORE || '70', 10),
    minAlternativeScore: 70,
    leaderScoreRange: [70, 90],
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
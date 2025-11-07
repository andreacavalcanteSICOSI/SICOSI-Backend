// config/index.ts - Configuration

interface Config {
  tavily: {
    apiKey: string | undefined;
    baseUrl: string;
  };
  groq: {
    apiKey: string | undefined;
    defaultModel: string;
  };
}

const config: Config = {
  tavily: {
    apiKey: process.env.TAVILY_API_KEY,
    baseUrl: 'https://api.tavily.com/search'
  },
  
  groq: {
    apiKey: process.env.GROQ_API_KEY,
    defaultModel: 'llama-3.1-70b-versatile'
  }
};

export default config;
// services/groq-client.ts
import Groq from 'groq-sdk';
import config from '@/config';
import type { 
  AnalysisOptions, 
  AnalysisResponse, 
  ProductInfo, 
  CategoryData,
  SearchResult,
  ProductAnalysis
} from '@/types';

class GroqClient {
  private apiKey: string | undefined;
  private client: Groq;
  private defaultModel: string;

  constructor() {
    this.apiKey = config.groq.apiKey;
    this.client = new Groq({ apiKey: this.apiKey });
    this.defaultModel = config.groq.defaultModel;
  }

  async analyze(prompt: string, options: AnalysisOptions = {}): Promise<AnalysisResponse> {
    const {
      model = this.defaultModel,
      temperature = 0.3,
      maxTokens = 2000
    } = options;

    console.log('🤖 Groq analysis starting...');

    if (!this.apiKey) {
      console.error('❌ Groq API key not configured');
      return {
        success: false,
        error: 'Groq API key not configured'
      };
    }

    try {
      const completion = await this.client.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: 'You are a sustainability expert analyzing products for environmental and social impact. Always respond with valid JSON in Portuguese (PT-BR) for user-facing text.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        model,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' }
      });

      const content = completion.choices[0]?.message?.content;
      
      if (!content) {
        throw new Error('Empty response from Groq');
      }

      console.log('✅ Groq analysis complete');

      const analysis = JSON.parse(content) as ProductAnalysis;

      return {
        success: true,
        analysis,
        model,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Unknown error occurred';
      
      console.error('❌ Groq analysis error:', errorMessage);
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  async analyzeProduct(context: ProductInfo, categoryData: CategoryData): Promise<AnalysisResponse> {
    const prompt = this.buildProductAnalysisPrompt(context, categoryData);
    return this.analyze(prompt);
  }

  async analyzeAlternatives(
    searchResults: SearchResult[], 
    categoryData: CategoryData, 
    originalAnalysis: ProductAnalysis
  ): Promise<AnalysisResponse> {
    const prompt = this.buildAlternativesPrompt(searchResults, categoryData, originalAnalysis);
    return this.analyze(prompt);
  }

  private buildProductAnalysisPrompt(context: ProductInfo, categoryData: CategoryData): string {
    const productName = context.productName || context.selectedText || 'Unknown product';
    const searchContext = context.searchResults
      ?.map(r => `${r.title}: ${r.snippet}`)
      .join('\n') || 'No additional context';

    return `
You are a sustainability expert analyzing products for environmental and social impact.

PRODUCT TO ANALYZE:
Name: ${productName}
Category: ${categoryData.name}
Description: ${context.description || 'Not available'}
URL: ${context.pageUrl || 'Not available'}

WEB SEARCH CONTEXT:
${searchContext}

SUSTAINABILITY CRITERIA FOR THIS CATEGORY:
${JSON.stringify(categoryData.sustainability_criteria, null, 2)}

RELEVANT CERTIFICATIONS:
${categoryData.certifications.join(', ')}

REFERENCES:
${categoryData.references?.join(', ') || 'N/A'}

TASK:
1. Analyze this product's sustainability based on the criteria above
2. Assign a sustainability score (0-100)
3. Identify strengths and weaknesses
4. Check for mentioned certifications
5. Provide specific recommendations

RESPONSE FORMAT (JSON):
{
  "score": <number 0-100>,
  "rating": "<excellent|good|acceptable|poor>",
  "strengths": ["<strength 1 in PT-BR>", "<strength 2 in PT-BR>", ...],
  "weaknesses": ["<weakness 1 in PT-BR>", "<weakness 2 in PT-BR>", ...],
  "certifications_found": ["<cert 1>", "<cert 2>", ...],
  "recommendations": ["<recommendation 1 in PT-BR>", "<recommendation 2 in PT-BR>", ...],
  "summary": "<brief summary in Portuguese (PT-BR)>"
}

IMPORTANT: 
- Respond in Portuguese (PT-BR) for summary, strengths, weaknesses, and recommendations
- Keep certification names in their original form
- Be specific and actionable in recommendations
- Respond ONLY with valid JSON
`;
  }

  private buildAlternativesPrompt(
    searchResults: SearchResult[], 
    categoryData: CategoryData, 
    originalAnalysis: ProductAnalysis
  ): string {
    return `
You are a sustainability expert. Based on these search results, identify the TOP 3 most sustainable alternatives.

SEARCH RESULTS:
${searchResults.map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   URL: ${r.url}`).join('\n\n')}

SUSTAINABILITY CRITERIA:
${JSON.stringify(categoryData.sustainability_criteria, null, 2)}

ORIGINAL PRODUCT SCORE: ${originalAnalysis.score}/100
ORIGINAL PRODUCT RATING: ${originalAnalysis.rating}

TASK:
Select the 3 BEST sustainable alternatives that:
1. Score higher than the original product (> ${originalAnalysis.score})
2. Meet the sustainability criteria with verifiable evidence
3. Have recognized certifications or credentials
4. Are actually available for purchase
5. Provide clear value proposition over the original

RESPONSE FORMAT (JSON):
{
  "alternatives": [
    {
      "name": "<product name>",
      "score": <number 0-100>,
      "why_better": "<detailed explanation in Portuguese (PT-BR)>",
      "certifications": ["<cert 1>", "<cert 2>", ...],
      "url": "<product url from search results>",
      "price_range": "<estimated price range or 'desconhecido'>",
      "key_features": ["<feature 1 in PT-BR>", "<feature 2 in PT-BR>", ...]
    }
  ]
}

IMPORTANT: 
- Respond in Portuguese (PT-BR) for why_better and key_features
- Keep certification names in original form
- Only include alternatives with score > ${originalAnalysis.score}
- If you cannot find 3 good alternatives, return fewer (minimum 1)
- Be honest about limitations or unknowns
- Respond ONLY with valid JSON
`;
  }
}

export default new GroqClient();
import Groq from 'groq-sdk';
import alternativesData from '../data/alternatives.json';
import { AlternativesConfig } from '../types';
import { ProductFacts } from './scoring-engine';

const alternativesConfig = alternativesData as AlternativesConfig;

/**
 * Usa o LLM APENAS para extrair fatos estruturados do produto
 * NÃO calcula score - apenas avalia cada critério de 0-100
 */
export async function extractProductFacts(
  productName: string,
  category: string,
  searchContext: string,
  groqClient: Groq
): Promise<ProductFacts> {
  const categoryData = alternativesConfig.categories[category];
  if (!categoryData) {
    throw new Error(`Category ${category} not found`);
  }
  const criteria = categoryData.sustainability_criteria;

  const prompt = `You are a sustainability analyst. Analyze this product and evaluate each criterion from 0-100.

PRODUCT: ${productName}
CATEGORY: ${category}

CONTEXT FROM WEB SEARCH:
${searchContext}

CRITERIA TO EVALUATE:
${Object.entries(criteria)
    .map(
      ([name, config]) => `
${name.toUpperCase()}:
Guidelines:
${config.guidelines.map((g) => `- ${g}`).join('\n')}
`
    )
    .join('\n')}

For each criterion, provide:
1. A score from 0-100 (how well the product meets the guidelines)
2. Evidence from the context that supports your score

Return ONLY a JSON object with this structure:
{
  "durability": {
    "score": 75,
    "evidence": ["Product has 5-year warranty", "Aluminum construction"]
  },
  "repairability": {
    "score": 60,
    "evidence": ["Some parts replaceable", "No official repair manual"]
  },
  // ... other criteria
  "certifications": ["Energy Star", "RoHS"],
  "origin": "China"
}

IMPORTANT: 
- Be objective and base scores on evidence
- If no information is available for a criterion, use score: 0
- Do NOT calculate a final score - just evaluate each criterion`;

  const completion = await groqClient.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.3-70b-versatile',
    temperature: 0.1,
    response_format: { type: 'json_object' }
  });

  const facts = JSON.parse(completion.choices[0].message.content || '{}');
  return facts as ProductFacts;
}

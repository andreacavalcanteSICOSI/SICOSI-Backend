import Groq from 'groq-sdk';
import alternativesData from '../data/alternatives.json';
import { Indicator } from '../types';
import { ProductFacts } from './scoring-engine';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY!,
});

/**
 * Usa o LLM APENAS para extrair fatos estruturados do produto.
 * NÃO calcula score final - apenas avalia cada critério de 0-100.
 */
export async function extractProductFacts(
  productName: string,
  category: string,
  searchContext: string
): Promise<ProductFacts> {
  const alternativesConfig = alternativesData as any;
  const categoryData = alternativesConfig.categories[category];
  const criteria = categoryData.sustainability_criteria;

  if (!criteria || typeof criteria !== 'object') {
    console.error('[FACT-EXTRACTOR] Missing sustainability_criteria for category:', category);
  }

  // Construir lista de critérios com indicators
  const criteriaList = Object.entries(criteria || {})
    .map(([name, config]: [string, any]) => {
      const indicators = Array.isArray(config?.indicators) ? (config.indicators as Indicator[]) : [];

      if (indicators.length === 0) {
        console.warn(
          `[FACT-EXTRACTOR] No indicators found for criterion "${name}". Config received:`,
          config,
        );
      }

      const indicatorsText = indicators
        .map((indicator: Indicator, index) => {
          const title = indicator.name || indicator.id || `Indicator ${index + 1}`;
          const description = indicator.description || 'No description provided.';
          const evalCriteria = indicator.evaluation_criteria;

          const evaluationText = evalCriteria
            ? `\nEvaluation criteria:\n- Excellent (${evalCriteria.excellent?.threshold ?? 'n/a'}): ${evalCriteria.excellent?.description ?? 'Not provided'}\n- Good (${evalCriteria.good?.threshold ?? 'n/a'}): ${evalCriteria.good?.description ?? 'Not provided'}\n- Acceptable (${evalCriteria.acceptable?.threshold ?? 'n/a'}): ${evalCriteria.acceptable?.description ?? 'Not provided'}\n- Poor (${evalCriteria.poor?.threshold ?? 'n/a'}): ${evalCriteria.poor?.description ?? 'Not provided'}`
            : '';

          return `- ${title}: ${description}${evaluationText}`;
        })
        .join('\n');

      return `
### ${name.toUpperCase()}
Indicators to evaluate:
${indicatorsText || '- No indicators configured'}`;
    })
    .join('\n');

  const prompt = `You are a sustainability analyst. Analyze this product and evaluate EACH criterion from 0 to 100.

PRODUCT: ${productName}
CATEGORY: ${category}

CONTEXT FROM WEB SEARCH:
${searchContext}

CRITERIA TO EVALUATE:
${criteriaList}

INSTRUCTIONS:
1. For EACH criterion above, assign a score from 0-100 based on how well the product meets the indicators
2. Provide evidence from the context that supports your score
3. If no information is available for a criterion, use score: 0
4. Be objective and base scores ONLY on evidence found in the context
5. Also extract any certifications and origin information if available

Return ONLY a valid JSON object with this EXACT structure:
{
  "durability": {
    "score": 75,
    "evidence": ["Product has 5-year warranty", "Aluminum construction"]
  },
  "repairability": {
    "score": 60,
    "evidence": ["Some parts replaceable", "No official repair manual found"]
  },
  "recyclability": {
    "score": 80,
    "evidence": ["95% recyclable materials", "Take-back program available"]
  },
  "energy_efficiency": {
    "score": 85,
    "evidence": ["Energy Star certified", "Low standby power"]
  },
  "materials": {
    "score": 70,
    "evidence": ["30% recycled content", "RoHS compliant"]
  },
  "certifications": ["Energy Star", "RoHS", "TCO Certified"],
  "origin": "China"
}

IMPORTANT: 
- Return ONLY the JSON object, no other text
- Use the EXACT criterion names from the list above
- Scores must be integers from 0 to 100
- Do NOT calculate a final score - just evaluate each criterion`;

  console.log('🤖 [GROQ] Extracting product facts...');

  const completion = await groq.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.3-70b-versatile',
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });

  const content = completion.choices[0].message.content || '{}';
  const rawFacts = JSON.parse(content);

  const normalizeKeysToLower = (value: any): any => {
    if (Array.isArray(value)) {
      return value.map(normalizeKeysToLower);
    }

    if (value && typeof value === 'object') {
      return Object.entries(value).reduce((acc: Record<string, any>, [key, val]) => {
        acc[key.toLowerCase()] = normalizeKeysToLower(val);
        return acc;
      }, {});
    }

    return value;
  };

  const facts = normalizeKeysToLower(rawFacts) as ProductFacts;

  console.log('✅ [GROQ] Facts extracted:', Object.keys(rawFacts));
  console.log('[FACT-EXTRACTOR] Facts normalizados:', Object.keys(facts));

  return facts as ProductFacts;
}

/**
 * Gera textos descritivos (resumo, pontos fortes/fracos, recomendações)
 * baseado no score calculado e nos fatos extraídos.
 */
export async function generateDescriptiveTexts(
  productName: string,
  category: string,
  finalScore: number,
  breakdown: any,
  facts: ProductFacts,
  userLanguage: string = 'en-US',
  userCountry: string = 'US'
): Promise<{
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
}> {
  const prompt = `You are a sustainability analyst. Generate a report for this product.

IMPORTANT: Respond in ${userLanguage}. User is from ${userCountry}.

PRODUCT: ${productName}
CATEGORY: ${category}
SUSTAINABILITY SCORE: ${finalScore}/100

SCORE BREAKDOWN:
${Object.entries(breakdown)
  .map(([criterion, data]: [string, any]) => `- ${criterion}: ${data.score}/100 (weight: ${data.weight})`)
  .join('\n')}

EVIDENCE:
${Object.entries(facts)
  .filter(([key]) => key !== 'certifications' && key !== 'origin')
  .map(([criterion, data]: [string, any]) => `
${criterion}:
${data.evidence?.map((e: string) => `  - ${e}`).join('\n') || '  - No evidence found'}
`)
  .join('\n')}

Generate a JSON response with:
1. summary: A 2-3 sentence overview of the product's sustainability
2. strengths: Array of 2-4 positive sustainability aspects
3. weaknesses: Array of 2-4 areas for improvement
4. recommendations: Array of 2-3 actionable recommendations for the consumer

Return ONLY valid JSON:
{
  "summary": "...",
  "strengths": ["...", "..."],
  "weaknesses": ["...", "..."],
  "recommendations": ["...", "..."]
}`;

  console.log('🤖 [GROQ] Generating descriptive texts...');

  const completion = await groq.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.3-70b-versatile',
    temperature: 0.3,
    response_format: { type: 'json_object' },
  });

  const content = completion.choices[0].message.content || '{}';
  const texts = JSON.parse(content);

  console.log('✅ [GROQ] Descriptive texts generated');

  return texts;
}
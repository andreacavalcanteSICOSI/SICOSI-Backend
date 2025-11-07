// pages/api/analyze-product.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import Groq from 'groq-sdk';
import alternativesData from '../../data/alternatives.json';

// ===== TIPOS =====
interface ProductInfo {
  productName: string;
  description?: string;
  pageUrl?: string;
  selectedText?: string;
  price?: string;
  images?: string[];
}

interface AnalysisRequest {
  productInfo: ProductInfo;
}

interface SustainabilityCriterion {
  weight: number;
  guidelines: string[];
}

interface CategoryData {
  name: string;
  keywords: string[];
  sustainability_criteria: Record<string, SustainabilityCriterion>;
  certifications: string[];
  references: string[];
  special_notes?: Record<string, string[]>;
}

interface AlternativesData {
  categories: Record<string, CategoryData>;
}

interface OriginalProduct {
  name: string;
  category: string;
  sustainability_score: number;
  summary: string;
  environmental_impact: {
    carbon_footprint: string;
    water_usage: string;
    recyclability: string;
    toxicity: string;
  };
  strengths: string[];
  weaknesses: string[];
  certifications_found: string[];
  recommendations: string[];
}

interface Alternative {
  name: string;
  description: string;
  benefits: string;
  sustainability_score: number;
  where_to_buy: string;
  certifications: string[];
}

interface GroqAnalysisResult {
  originalProduct: OriginalProduct;
  alternatives: Alternative[];
}

interface AnalysisResponse {
  success: boolean;
  originalProduct?: OriginalProduct;
  alternatives?: Alternative[];
  error?: string;
}

// ===== HANDLER =====
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AnalysisResponse>
) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed' 
    });
  }

  try {
    const { productInfo } = req.body as AnalysisRequest;

    // Validação
    if (!productInfo || !productInfo.productName) {
      return res.status(400).json({
        success: false,
        error: 'productName is required'
      });
    }

    console.log('📦 Analyzing product:', productInfo.productName);

    // Identificar categoria baseada nas keywords
    const category = identifyCategory(productInfo);
    console.log('📂 Category identified:', category);

    // Obter dados da categoria
    const typedAlternatives = alternativesData as AlternativesData;
    const categoryData = typedAlternatives.categories[category];

    if (!categoryData) {
      return res.status(400).json({
        success: false,
        error: `Category "${category}" not found in alternatives.json`
      });
    }

    // Chamar Groq para análise
    const analysis = await analyzeWithGroq(productInfo, category, categoryData);

    return res.status(200).json({
      success: true,
      originalProduct: analysis.originalProduct,
      alternatives: analysis.alternatives
    });

  } catch (error) {
    console.error('❌ Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
}

// ===== IDENTIFICAR CATEGORIA =====
function identifyCategory(productInfo: ProductInfo): string {
  const text = `
    ${productInfo.productName || ''} 
    ${productInfo.description || ''} 
    ${productInfo.selectedText || ''}
  `.toLowerCase();

  const typedAlternatives = alternativesData as AlternativesData;
  let bestMatch = { category: 'electronics', score: 0 };

  // Iterar sobre todas as categorias
  for (const [categoryKey, categoryData] of Object.entries(typedAlternatives.categories)) {
    const keywords = categoryData.keywords || [];
    let score = 0;

    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        score++;
      }
    }

    if (score > bestMatch.score) {
      bestMatch = { category: categoryKey, score };
    }
  }

  console.log('🔍 Category match:', bestMatch);
  return bestMatch.category;
}

// ===== ANÁLISE COM GROQ =====
async function analyzeWithGroq(
  productInfo: ProductInfo, 
  category: string, 
  categoryData: CategoryData
): Promise<GroqAnalysisResult> {
  const groqApiKey = process.env.GROQ_API_KEY;
  
  if (!groqApiKey) {
    throw new Error('GROQ_API_KEY not configured in environment variables');
  }

  const groq = new Groq({ apiKey: groqApiKey });

  // Preparar critérios para o prompt
  const criteriaText = Object.entries(categoryData.sustainability_criteria)
    .map(([key, value]) => {
      return `${key} (peso: ${value.weight}): ${value.guidelines.join(', ')}`;
    })
    .join('\n');

  const certificationsText = categoryData.certifications.join(', ');

  // Prompt otimizado para Groq
  const prompt = `
Você é um especialista em sustentabilidade e análise de produtos.

PRODUTO A ANALISAR:
Nome: ${productInfo.productName}
Descrição: ${productInfo.description || 'Não fornecida'}
URL: ${productInfo.pageUrl || 'Não fornecida'}
Categoria identificada: ${category} (${categoryData.name})

CRITÉRIOS DE SUSTENTABILIDADE PARA ESTA CATEGORIA:
${criteriaText}

CERTIFICAÇÕES RELEVANTES:
${certificationsText}

TAREFA:
1. Analise o produto considerando os critérios acima
2. Atribua um score de sustentabilidade (0-100)
3. Identifique pontos fortes e fracos
4. Liste impactos ambientais
5. Forneça recomendações práticas
6. Sugira 3 alternativas mais sustentáveis (produtos reais que existem no mercado)

IMPORTANTE: 
- Use seu conhecimento para avaliar o produto de forma realista
- Se possível, mencione certificações que o produto possui
- Para as alternativas, sugira produtos reais e disponíveis no mercado
- Seja específico e prático nas recomendações

Retorne APENAS um JSON válido no seguinte formato:
{
  "originalProduct": {
    "name": "nome do produto",
    "category": "${category}",
    "sustainability_score": 75,
    "summary": "resumo da análise em 2-3 frases",
    "environmental_impact": {
      "carbon_footprint": "descrição do impacto de carbono",
      "water_usage": "descrição do uso de água",
      "recyclability": "descrição da reciclabilidade",
      "toxicity": "descrição de toxicidade/químicos"
    },
    "strengths": ["ponto forte 1", "ponto forte 2"],
    "weaknesses": ["ponto fraco 1", "ponto fraco 2"],
    "certifications_found": ["certificação 1", "certificação 2"],
    "recommendations": ["recomendação 1", "recomendação 2", "recomendação 3"]
  },
  "alternatives": [
    {
      "name": "nome da alternativa 1",
      "description": "descrição do produto alternativo",
      "benefits": "benefícios ambientais específicos",
      "sustainability_score": 85,
      "where_to_buy": "sugestão de onde comprar (loja, site)",
      "certifications": ["certificação 1", "certificação 2"]
    },
    {
      "name": "nome da alternativa 2",
      "description": "descrição",
      "benefits": "benefícios",
      "sustainability_score": 80,
      "where_to_buy": "onde comprar",
      "certifications": ["certificações"]
    },
    {
      "name": "nome da alternativa 3",
      "description": "descrição",
      "benefits": "benefícios",
      "sustainability_score": 78,
      "where_to_buy": "onde comprar",
      "certifications": ["certificações"]
    }
  ]
}
`;

  try {
    console.log('🤖 Calling Groq API...');
    
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'Você é um especialista em sustentabilidade. Sempre retorne respostas em JSON válido.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      max_tokens: 3000,
      response_format: { type: 'json_object' }
    });

    const content = completion.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No response from Groq');
    }

    console.log('✅ Groq response received');

    // Parse JSON
    const result = JSON.parse(content) as GroqAnalysisResult;
    
    return result;

  } catch (error) {
    console.error('❌ Groq API error:', error);
    
    if (error instanceof Error) {
      throw new Error(`Groq API error: ${error.message}`);
    }
    
    throw new Error('Unknown Groq API error');
  }
}
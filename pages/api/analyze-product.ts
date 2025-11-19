// pages/api/analyze-product.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import Groq from 'groq-sdk';
import alternativesData from '../../data/alternatives.json';
import webSearchClient from '../../services/web-search-client';

// ===== TIPOS =====
interface ProductInfo {
  productName?: string;
  product_name?: string;
  description?: string;
  pageUrl?: string;
  product_url?: string;
  selectedText?: string;
  price?: string;
  images?: string[];
  userCountry?: string; // ISO country code (e.g., "BR", "US", "UK")
}

interface AnalysisRequest {
  productInfo?: ProductInfo;
  product_name?: string;
  productName?: string;
  product_url?: string;
  pageUrl?: string;
  userCountry?: string; // ISO country code
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
  product_url?: string; // URL real do produto encontrado
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
    const body = req.body as AnalysisRequest;

    // Suportar múltiplos formatos de entrada
    let productInfo: ProductInfo;

    if (body.productInfo) {
      // Formato antigo: { productInfo: { productName: "..." } }
      productInfo = body.productInfo;
    } else {
      // Formato novo: { product_name: "...", product_url: "..." }
      productInfo = {
        productName: body.product_name || body.productName,
        pageUrl: body.product_url || body.pageUrl
      };
    }

    const finalProductName = productInfo.productName || productInfo.product_name;

    // Validação
    if (!finalProductName) {
      return res.status(400).json({
        success: false,
        error: 'productName is required'
      });
    }

    console.log('📦 Analyzing product:', finalProductName);

    // Identificar categoria baseada nas keywords (agora com tradução automática)
    const category = await identifyCategory(productInfo);
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

    // ============================================================================
    // NOVO: Buscar produtos reais com Tavily ANTES de chamar a IA
    // ============================================================================
    console.log('🔍 Searching for real sustainable alternatives with Tavily...');
    
    let realProducts: Array<{title: string, url: string, snippet: string}> = [];
    
    try {
      // Traduzir o nome do produto para inglês para melhor busca
      const translatedProductName = await translateProductName(finalProductName);
      const certifications = categoryData.certifications.slice(0, 2).join(' OR ');
      
      // Detectar país do usuário (priorizar Brasil)
      const userCountry = productInfo.userCountry || req.body.userCountry || 'BR';
      const countryNames: Record<string, string> = {
        'BR': 'Brazil',
        'US': 'United States',
        'UK': 'United Kingdom',
        'CA': 'Canada',
        'AU': 'Australia',
        'DE': 'Germany',
        'FR': 'France',
        'ES': 'Spain',
        'IT': 'Italy',
        'PT': 'Portugal',
        'MX': 'Mexico',
        'AR': 'Argentina',
        'CL': 'Chile',
        'CO': 'Colombia'
      };
      const countryName = countryNames[userCountry] || 'Brazil';
      
      // Query melhorada: NOME TRADUZIDO + PAÍS + sustentável + onde comprar
      const searchQuery = `buy sustainable eco-friendly ${translatedProductName} alternatives ${countryName} ${certifications} online shop`;
      
      console.log('🔎 Tavily search query:', searchQuery);
      console.log('🌍 User country:', userCountry, `(${countryName})`);
      
      // Busca ABERTA - sem restrição de domínios
      // Tavily vai buscar em QUALQUER e-commerce/site que venda produtos sustentáveis
      const tavilyResults = await webSearchClient.search(searchQuery, {
        maxResults: 15, // Aumentar para ter mais opções de filtrar
        searchDepth: 'advanced',
        includeAnswer: false
        // SEM includeDomains - busca aberta em toda a web
      });
      
      if (tavilyResults.success && tavilyResults.results) {
        // Filtrar apenas resultados que parecem ser de e-commerce/produtos
        const filteredResults = tavilyResults.results.filter(r => {
          const text = `${r.title} ${r.snippet} ${r.url}`.toLowerCase();
          
          // Palavras que indicam que é um produto à venda
          const productIndicators = ['buy', 'price', 'shop', 'store', 'cart', 'comprar', 'loja', 'preço'];
          const hasProductIndicator = productIndicators.some(word => text.includes(word));
          
          // Palavras que indicam que NÃO é um produto (artigos, guias, etc)
          const excludeWords = ['wikipedia', 'article', 'guide', 'blog', 'news', 'notícia', 'artigo'];
          const hasExcludeWord = excludeWords.some(word => text.includes(word));
          
          // Verificar se o domínio parece ser e-commerce
          const ecommercePatterns = ['.com', '.br', '.shop', 'store', 'loja', 'market'];
          const looksLikeEcommerce = ecommercePatterns.some(pattern => r.url.includes(pattern));
          
          return hasProductIndicator && !hasExcludeWord && looksLikeEcommerce;
        });
        
        realProducts = filteredResults.slice(0, 10).map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet
        }));
        
        console.log('✅ Tavily found', tavilyResults.results.length, 'results, filtered to', realProducts.length, 'product pages');
        console.log('📋 Real products:', realProducts.map(p => p.title));
      } else {
        console.warn('⚠️ Tavily search failed, will use AI suggestions only');
      }
    } catch (tavilyError) {
      console.error('❌ Tavily error:', tavilyError);
      console.warn('⚠️ Continuing without Tavily results');
    }

    // Chamar Groq para análise COM os produtos reais encontrados
    const analysis = await analyzeWithGroq(
      productInfo, 
      category, 
      categoryData,
      realProducts // PASSAR produtos reais para a IA
    );

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

// ===== TRADUZIR PRODUTO PARA INGLÊS (SE NECESSÁRIO) =====
async function translateProductName(productName: string): Promise<string> {
  // Se já está em inglês (maioria das palavras), retorna direto
  const englishPattern = /^[a-zA-Z0-9\s\-_]+$/;
  if (englishPattern.test(productName)) {
    console.log('📝 Product name already in English:', productName);
    return productName;
  }

  const groqApiKey = process.env.GROQ_API_KEY;
  
  if (!groqApiKey) {
    console.warn('⚠️ GROQ_API_KEY not available for translation, using original name');
    return productName;
  }

  try {
    const groq = new Groq({ apiKey: groqApiKey });

    console.log('🌐 Translating product name to English:', productName);

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'You are a translator. Translate product names to English. Return ONLY the translated name, nothing else.'
        },
        {
          role: 'user',
          content: `Translate this product name to English: "${productName}"`
        }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.3,
      max_tokens: 50
    });

    const translated = completion.choices[0]?.message?.content?.trim() || productName;
    console.log('✅ Translated to:', translated);
    
    return translated;

  } catch (error) {
    console.error('❌ Translation error:', error);
    return productName; // Fallback to original
  }
}

// ===== IDENTIFICAR CATEGORIA =====
async function identifyCategory(productInfo: ProductInfo): Promise<string> {
  const productName = productInfo.productName || productInfo.product_name || '';
  const description = productInfo.description || '';
  const selectedText = productInfo.selectedText || '';
  
  // Traduzir nome do produto para inglês (se necessário)
  const translatedName = await translateProductName(productName);
  
  const text = `${translatedName} ${description} ${selectedText}`.toLowerCase();

  const typedAlternatives = alternativesData as AlternativesData;
  let bestMatch = { category: '', score: 0 };

  // Iterar sobre todas as categorias e calcular score
  for (const [categoryKey, categoryData] of Object.entries(typedAlternatives.categories)) {
    const keywords = categoryData.keywords || [];
    let score = 0;

    for (const keyword of keywords) {
      const keywordLower = keyword.toLowerCase();
      
      // Contar quantas vezes a keyword aparece (palavras podem aparecer múltiplas vezes)
      const matches = text.match(new RegExp(keywordLower, 'g'));
      if (matches) {
        score += matches.length;
      }
      
      // Bonus se a keyword aparece no nome do produto traduzido (mais relevante)
      if (translatedName.toLowerCase().includes(keywordLower)) {
        score += 2;
      }
    }

    if (score > bestMatch.score) {
      bestMatch = { category: categoryKey, score };
    }
  }

  // Se não encontrou match bom, tentar fallback inteligente
  if (bestMatch.score === 0) {
    console.warn('⚠️ No category match found, trying fallback...');
    
    // Fallbacks comuns
    if (text.includes('talher') || text.includes('garfo') || text.includes('colher') || text.includes('prato') || text.includes('copo') || 
        text.includes('cutlery') || text.includes('fork') || text.includes('spoon') || text.includes('plate') || text.includes('cup')) {
      bestMatch = { category: 'reusable_zero_waste', score: 1 };
    } else if (text.includes('plástico') || text.includes('descartável') || text.includes('plastic') || text.includes('disposable')) {
      bestMatch = { category: 'reusable_zero_waste', score: 1 };
    } else {
      // Default genérico
      bestMatch = { category: 'general', score: 0 };
    }
    
    console.log('📦 Fallback category selected:', bestMatch.category);
  }

  console.log('🔍 Category match:', bestMatch);
  return bestMatch.category;
}

// ===== ANÁLISE COM GROQ (MODIFICADO PARA USAR PRODUTOS REAIS) =====
async function analyzeWithGroq(
  productInfo: ProductInfo, 
  category: string, 
  categoryData: CategoryData,
  realProducts: Array<{title: string, url: string, snippet: string}> = []
): Promise<GroqAnalysisResult> {
  const groqApiKey = process.env.GROQ_API_KEY;
  
  if (!groqApiKey) {
    throw new Error('GROQ_API_KEY not configured in environment variables');
  }

  const groq = new Groq({ apiKey: groqApiKey });

  const productName = productInfo.productName || productInfo.product_name || '';
  const pageUrl = productInfo.pageUrl || productInfo.product_url || '';

  // Preparar critérios para o prompt
  const criteriaText = Object.entries(categoryData.sustainability_criteria)
    .map(([key, value]) => {
      return `${key} (peso: ${value.weight}): ${value.guidelines.join(', ')}`;
    })
    .join('\n');

  const certificationsText = categoryData.certifications.join(', ');

  // ============================================================================
  // NOVO: Preparar lista de produtos reais encontrados
  // ============================================================================
  const realProductsText = realProducts.length > 0
    ? `\n\nPRODUTOS SUSTENTÁVEIS REAIS ENCONTRADOS (use estes como base para suas sugestões):\n${
        realProducts.map((p, i) => 
          `${i + 1}. ${p.title}\n   URL: ${p.url}\n   Descrição: ${p.snippet}\n`
        ).join('\n')
      }`
    : '';

  // Prompt otimizado para Groq COM produtos reais
  const prompt = `
Você é um especialista em sustentabilidade e análise de produtos.

PRODUTO A ANALISAR:
Nome: ${productName}
Descrição: ${productInfo.description || 'Não fornecida'}
URL: ${pageUrl}
Categoria identificada: ${category} (${categoryData.name})

CRITÉRIOS DE SUSTENTABILIDADE PARA ESTA CATEGORIA:
${criteriaText}

CERTIFICAÇÕES RELEVANTES:
${certificationsText}
${realProductsText}

TAREFA:
1. Analise o produto considerando os critérios acima
2. Atribua um score de sustentabilidade (0-100)
3. Identifique pontos fortes e fracos
4. Liste impactos ambientais
5. Forneça recomendações práticas
6. Sugira 3 alternativas mais sustentáveis

IMPORTANTE SOBRE AS ALTERNATIVAS:
${realProducts.length > 0 ? `
- Você recebeu ${realProducts.length} produtos REAIS encontrados na web
- ANALISE cada produto e USE APENAS os que são RELEVANTES para "${productName}"
- IGNORE completamente produtos que não são da mesma categoria (ex: se pediu talheres, ignore carros, eletrônicos, etc)
- Para cada alternativa que você escolher:
  * Use o título EXATO do produto encontrado
  * Use a URL EXATA fornecida
  * O produto DEVE ser da mesma categoria que "${category}"
  * Verifique se faz sentido como alternativa sustentável
- Se NENHUM dos produtos encontrados for relevante, sugira produtos genéricos mas realistas
- NUNCA sugira produtos de categorias diferentes (ex: carros quando pediu utensílios)
` : `
- Não foram encontrados produtos reais na busca
- Sugira produtos GENÉRICOS mas REALISTAS que existem no mercado
- Use nomes de produtos que realmente existem
- Seja específico sobre onde comprar (ex: "Amazon Brasil", "Mercado Livre")
- Os produtos devem ser da categoria "${category}"
`}
- Seja específico e prático nas recomendações
- Os scores das alternativas devem ser baseados nos critérios de sustentabilidade
- Alternativas devem ter score MAIOR que o produto original
- VALIDE que cada alternativa faz sentido para substituir "${productName}"

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
      "name": "nome EXATO do produto real",
      "description": "descrição do produto alternativo",
      "benefits": "benefícios ambientais específicos",
      "sustainability_score": 85,
      "where_to_buy": "loja específica (ex: Amazon Brasil, Mercado Livre)",
      "certifications": ["certificação 1", "certificação 2"],
      "product_url": "URL real do produto (se disponível)"
    },
    {
      "name": "nome da alternativa 2",
      "description": "descrição",
      "benefits": "benefícios",
      "sustainability_score": 80,
      "where_to_buy": "onde comprar",
      "certifications": ["certificações"],
      "product_url": "URL se disponível"
    },
    {
      "name": "nome da alternativa 3",
      "description": "descrição",
      "benefits": "benefícios",
      "sustainability_score": 78,
      "where_to_buy": "onde comprar",
      "certifications": ["certificações"],
      "product_url": "URL se disponível"
    }
  ]
}
`;

  try {
    console.log('🤖 Calling Groq API with real products context...');
    
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'Você é um especialista em sustentabilidade. Sempre retorne respostas em JSON válido. Quando produtos reais são fornecidos, use-os como base para suas recomendações.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.5, // Reduzido para ser mais preciso com produtos reais
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
    
    // Log das alternativas sugeridas
    console.log('🌿 Alternatives suggested:', result.alternatives.map(a => ({
      name: a.name,
      score: a.sustainability_score,
      url: a.product_url || 'N/A'
    })));
    
    return result;

  } catch (error) {
    console.error('❌ Groq API error:', error);
    
    if (error instanceof Error) {
      throw new Error(`Groq API error: ${error.message}`);
    }
    
    throw new Error('Unknown Groq API error');
  }
}
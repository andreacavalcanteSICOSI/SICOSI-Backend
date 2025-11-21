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
  userCountry?: string;
}

interface AnalysisRequest {
  productInfo?: ProductInfo;
  product_name?: string;
  productName?: string;
  product_url?: string;
  pageUrl?: string;
  userCountry?: string;
}

interface SustainabilityCriterion {
  weight: number;
  guidelines: string[];
}

// ✅ FIX: Tipo simples que corresponde ao JSON real
interface CategoryData {
  name: string;
  keywords: string[];
  sustainability_criteria: Record<string, SustainabilityCriterion>;
  certifications: string[];
  references: string[];
  brazilian_brands?: string[];
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
  product_url?: string;
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

// ===== FUNÇÃO: EXTRAIR TIPO DE PRODUTO =====
function extractProductType(productName: string): string {
  const lowerName = productName.toLowerCase();
  
  const patterns: Record<string, string[]> = {
    'body wash': ['body wash', 'shower gel', 'sabonete líquido'],
    'shampoo': ['shampoo', 'xampu'],
    'conditioner': ['conditioner', 'condicionador'],
    'gift set': ['gift set', 'kit', 'conjunto'],
    'deodorant': ['deodorant', 'desodorante'],
    'soap': ['soap', 'sabonete', 'sabão'],
    'toothpaste': ['toothpaste', 'pasta de dente'],
    'lotion': ['lotion', 'loção', 'creme'],
    'perfume': ['perfume', 'fragrance', 'cologne'],
    'phone': ['phone', 'smartphone', 'celular', 'iphone', 'samsung'],
    'laptop': ['laptop', 'notebook', 'computer'],
    'headphones': ['headphones', 'earbuds', 'fone'],
    'shoes': ['shoes', 'sneakers', 'sapatos', 'tênis'],
    'jacket': ['jacket', 'coat', 'jaqueta', 'casaco'],
    'backpack': ['backpack', 'mochila', 'bag'],
  };
  
  for (const [type, keywords] of Object.entries(patterns)) {
    if (keywords.some(kw => lowerName.includes(kw))) {
      return type;
    }
  }
  
  const words = productName.split(' ').filter(w => w.length > 2);
  return words.slice(-2).join(' ');
}

// ===== HANDLER =====
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AnalysisResponse>
) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

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

    let productInfo: ProductInfo;

    if (body.productInfo) {
      productInfo = body.productInfo;
    } else {
      productInfo = {
        productName: body.product_name || body.productName,
        pageUrl: body.product_url || body.pageUrl
      };
    }

    const finalProductName = productInfo.productName || productInfo.product_name;

    if (!finalProductName) {
      return res.status(400).json({
        success: false,
        error: 'productName is required'
      });
    }

    console.log('📦 Analyzing product:', finalProductName);

    const category = await identifyCategory(productInfo);
    console.log('📂 Category identified:', category);

    // ✅ FIX: Acessar categories com index signature
    const categories = alternativesData.categories as Record<string, CategoryData>;
    const categoryData = categories[category];

    if (!categoryData) {
      return res.status(400).json({
        success: false,
        error: `Category "${category}" not found in alternatives.json`
      });
    }

    console.log('🔍 Searching for REAL sustainable product alternatives...');
    
    let realProducts: Array<{title: string, url: string, snippet: string}> = [];
    
    try {
      const translatedProductName = await translateProductName(finalProductName);
      const productType = extractProductType(translatedProductName);
      
      const userCountry = productInfo.userCountry || req.body.userCountry || 'BR';
      const countryNames: Record<string, string> = {
        'BR': 'Brazil', 'US': 'United States', 'UK': 'United Kingdom',
        'CA': 'Canada', 'AU': 'Australia', 'DE': 'Germany',
        'FR': 'France', 'ES': 'Spain', 'IT': 'Italy'
      };
      const countryName = countryNames[userCountry] || 'Brazil';
      
      const amazonDomain = userCountry === 'BR' ? 'com.br' : userCountry === 'UK' ? 'co.uk' : 'com';
      
      const searchQueries = [
        `site:amazon.${amazonDomain} sustainable eco-friendly organic ${productType}`,
        `site:etsy.com eco-friendly natural ${productType}`,
        `"sustainable ${productType}" ${countryName} buy online product -article -blog -guide`,
      ];
      
      console.log('🔎 Product type:', productType);
      console.log('🌍 User country:', userCountry, `(${countryName})`);
      console.log('🔎 Search queries:', searchQueries);
      
      for (const query of searchQueries) {
        try {
          const tavilyResults = await webSearchClient.search(query, {
            maxResults: 20,
            searchDepth: 'advanced',
            includeAnswer: false
          });
          
          if (tavilyResults.success && tavilyResults.results) {
            console.log(`📊 Query returned ${tavilyResults.results.length} results`);
            
            const filteredResults = tavilyResults.results.filter(r => {
              const url = r.url.toLowerCase();
              const text = `${r.title} ${r.snippet}`.toLowerCase();
              
              const productURLPatterns = [
                '/dp/', '/product/', '/p/', '/item/', '/listing/', '/products/', '-p-'
              ];
              const hasProductURL = productURLPatterns.some(pattern => url.includes(pattern));
              
              const excludePatterns = [
                '/blog/', '/article/', '/news/', '/guide/', '/how-to/', '/features/',
                '/best-', '/top-', '/review', 'wikipedia.org', 'youtube.com'
              ];
              const isExcluded = excludePatterns.some(pattern => url.includes(pattern));
              
              const sustainableKeywords = [
                'sustainable', 'eco', 'organic', 'fair trade', 'biodegradable',
                'recycled', 'natural', 'green', 'sustentável', 'ecológico'
              ];
              const hasSustainableKeyword = sustainableKeywords.some(kw => text.includes(kw));
              
              const ecommerceDomains = [
                'amazon', 'etsy', 'ebay', 'walmart', 'target', 'mercado',
                'shopee', 'aliexpress', 'magalu', 'americanas'
              ];
              const isEcommerce = ecommerceDomains.some(domain => url.includes(domain));
              
              const isValid = hasProductURL && !isExcluded && hasSustainableKeyword && isEcommerce;
              
              if (isValid) {
                console.log(`✅ Valid product: ${r.title.substring(0, 50)}`);
              }
              
              return isValid;
            });
            
            if (filteredResults.length > 0) {
              realProducts.push(...filteredResults.map(r => ({
                title: r.title,
                url: r.url,
                snippet: r.snippet
              })));
              
              console.log(`✅ Found ${filteredResults.length} valid products`);
            }
          }
        } catch (queryError) {
          console.error(`❌ Query error:`, queryError);
          continue;
        }
        
        if (realProducts.length >= 5) break;
      }
      
      const uniqueProducts = Array.from(
        new Map(realProducts.map(p => [p.url, p])).values()
      ).slice(0, 8);
      
      realProducts = uniqueProducts;
      console.log(`✅ Final: ${realProducts.length} unique products found`);
      
    } catch (tavilyError) {
      console.error('❌ Tavily error:', tavilyError);
      console.warn('⚠️ Continuing without Tavily results');
    }

    const analysis = await analyzeWithGroq(
      productInfo, 
      category, 
      categoryData,
      realProducts
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

// ===== TRADUZIR PRODUTO =====
async function translateProductName(productName: string): Promise<string> {
  const englishPattern = /^[a-zA-Z0-9\s\-_]+$/;
  if (englishPattern.test(productName)) {
    console.log('📝 Product already in English:', productName);
    return productName;
  }

  const groqApiKey = process.env.GROQ_API_KEY;
  
  if (!groqApiKey) {
    console.warn('⚠️ No GROQ_API_KEY, using original name');
    return productName;
  }

  try {
    const groq = new Groq({ apiKey: groqApiKey });

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'Translate product names to English. Return ONLY the translated name.'
        },
        {
          role: 'user',
          content: `Translate: "${productName}"`
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
    return productName;
  }
}

// ===== IDENTIFICAR CATEGORIA =====
async function identifyCategory(productInfo: ProductInfo): Promise<string> {
  const productName = productInfo.productName || productInfo.product_name || '';
  const description = productInfo.description || '';
  const selectedText = productInfo.selectedText || '';
  const pageUrl = productInfo.pageUrl || productInfo.product_url || '';
  
  // ✅ NOVO: Incluir breadcrumbs e hints
  const breadcrumbs = (productInfo as any).breadcrumbs || '';
  const categoryHint = (productInfo as any).categoryHint || '';
  
  const translatedName = await translateProductName(productName);
  
  // ✅ MELHORADO: Texto expandido com mais contexto
  const text = `${translatedName} ${description} ${selectedText} ${breadcrumbs} ${categoryHint} ${pageUrl}`.toLowerCase();
  
  console.log('🔍 Texto para análise:', text.substring(0, 200));

  const categories = alternativesData.categories as Record<string, CategoryData>;
  let bestMatch = { category: '', score: 0 };

  for (const [categoryKey, categoryData] of Object.entries(categories)) {
    const keywords = categoryData.keywords || [];
    let score = 0;

    for (const keyword of keywords) {
      const keywordLower = keyword.toLowerCase();
      const matches = text.match(new RegExp(keywordLower, 'g'));
      if (matches) {
        score += matches.length;
        console.log(`✅ Keyword '${keyword}' encontrada ${matches.length}x em ${categoryKey}`);
      }
      if (translatedName.toLowerCase().includes(keywordLower)) {
        score += 2;
      }
    }

    if (score > bestMatch.score) {
      bestMatch = { category: categoryKey, score };
    }
  }
  
  console.log('📊 Melhor match:', bestMatch);

  // ✅ MELHORADO: Se score muito baixo, tentar inferir da URL
  if (bestMatch.score === 0 || bestMatch.score < 2) {
    const urlHints: Record<string, string> = {
      'clothing': 'textiles_clothing',
      'shoes': 'textiles_clothing',
      'fashion': 'textiles_clothing',
      'jewelry': 'textiles_clothing',
      'electronics': 'electronics',
      'phone': 'electronics',
      'computer': 'electronics',
      'kitchen': 'food_beverages',
      'food': 'food_beverages',
      'beauty': 'personal_care',
      'cosmetics': 'personal_care'
    };
    
    for (const [hint, category] of Object.entries(urlHints)) {
      if (text.includes(hint)) {
        console.log(`💡 Categoria inferida da URL: ${category} (hint: ${hint})`);
        return category;
      }
    }
  }

  if (bestMatch.score === 0) {
    console.warn('⚠️ Nenhuma categoria identificada, usando "general"');
    bestMatch = { category: 'general', score: 0 };
  }

  return bestMatch.category;
}

// ===== ANÁLISE COM GROQ =====
async function analyzeWithGroq(
  productInfo: ProductInfo, 
  category: string, 
  categoryData: CategoryData,
  realProducts: Array<{title: string, url: string, snippet: string}> = []
): Promise<GroqAnalysisResult> {
  const groqApiKey = process.env.GROQ_API_KEY;
  
  if (!groqApiKey) {
    throw new Error('GROQ_API_KEY not configured');
  }

  const groq = new Groq({ apiKey: groqApiKey });
  const productName = productInfo.productName || productInfo.product_name || '';

  const criteriaText = Object.entries(categoryData.sustainability_criteria)
    .map(([key, value]) => `${key} (peso: ${value.weight}): ${value.guidelines.join(', ')}`)
    .join('\n');

  const realProductsText = realProducts.length > 0
    ? `\n\nPRODUTOS SUSTENTÁVEIS REAIS ENCONTRADOS:\n${
        realProducts.map((p, i) => 
          `${i + 1}. ${p.title || 'No title'}\n   URL: ${p.url}\n   Info: ${(p.snippet || '').substring(0, 100)}\n`
        ).join('\n')
      }`
    : '';

  const prompt = `
Você é um especialista em sustentabilidade.

PRODUTO: ${productName}
CATEGORIA: ${category}

CRITÉRIOS:
${criteriaText}
${realProductsText}

INSTRUÇÕES PARA ALTERNATIVAS:
${realProducts.length > 0 ? `
- Você recebeu ${realProducts.length} produtos REAIS
- Use APENAS produtos que sejam REALMENTE alternativas a "${productName}"
- Para cada alternativa:
  * Nome EXATO do produto encontrado
  * URL EXATA fornecida
  * Score MAIOR que o original
  * VALIDE que é da mesma categoria
` : `
- Sugira produtos REAIS que existem no mercado
- Seja ESPECÍFICO (marca + modelo)
- Forneça lojas reais onde comprar
- Score MAIOR que o original
`}

RETORNE JSON:
{
  "originalProduct": {
    "name": "${productName}",
    "category": "${category}",
    "sustainability_score": 40,
    "summary": "resumo",
    "environmental_impact": {...},
    "strengths": [],
    "weaknesses": [],
    "certifications_found": [],
    "recommendations": []
  },
  "alternatives": [
    {
      "name": "Nome ESPECÍFICO do produto",
      "description": "...",
      "benefits": "...",
      "sustainability_score": 85,
      "where_to_buy": "Loja específica",
      "certifications": [],
      "product_url": "URL real"
    }
  ]
}
`;

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: 'Retorne JSON válido. Use produtos reais fornecidos.' },
        { role: 'user', content: prompt }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.5,
      max_tokens: 3000,
      response_format: { type: 'json_object' }
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('No response from Groq');

    const result = JSON.parse(content) as GroqAnalysisResult;
    
    console.log('🌿 Alternatives:', result.alternatives.map(a => ({
      name: a.name,
      score: a.sustainability_score,
      url: a.product_url || 'N/A'
    })));
    
    return result;

  } catch (error) {
    console.error('❌ Groq error:', error);
    throw error;
  }
}
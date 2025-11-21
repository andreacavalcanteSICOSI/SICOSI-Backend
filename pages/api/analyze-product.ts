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
  pageTitle?: string;
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

    const categories = alternativesData.categories as Record<string, CategoryData>;
    const categoryData = categories[category];

    if (!categoryData) {
      return res.status(400).json({
        success: false,
        error: `Category "${category}" not found in alternatives.json`
      });
    }

    console.log('🔍 Searching for sustainable alternatives...');
    
    let realProducts: Array<{title: string, url: string, snippet: string}> = [];
    
    try {
      const translatedProductName = await translateProductName(finalProductName);
      
      // ✅ BUSCA GENÉRICA - SEM HARDCODE DE SITES
      const searchQuery = `sustainable eco-friendly ${translatedProductName} buy online`;
      
      console.log('🔎 Generic search query:', searchQuery);
      
      const tavilyResults = await webSearchClient.search(searchQuery, {
        maxResults: 30,
        searchDepth: 'advanced',
        includeAnswer: false
      });
      
      if (tavilyResults.success && tavilyResults.results) {
        console.log(`📊 Search returned ${tavilyResults.results.length} results`);
        
        // ✅ FILTRO GENÉRICO - Identifica produtos automaticamente
        const filteredResults = tavilyResults.results.filter(r => {
          const url = r.url.toLowerCase();
          const text = `${r.title} ${r.snippet}`.toLowerCase();
          
          // Padrões GENÉRICOS de URL de produto (qualquer e-commerce)
          const productURLPatterns = [
            '/product/', '/p/', '/item/', '/dp/', '/listing/', 
            '/products/', '-p-', '/buy/', '/shop/'
          ];
          const hasProductURL = productURLPatterns.some(pattern => url.includes(pattern));
          
          // Excluir páginas que claramente NÃO são produtos
          const excludePatterns = [
            '/blog/', '/article/', '/news/', '/guide/', '/how-to/', 
            '/features/', '/best-', '/top-', '/review', '/compare',
            'wikipedia.', 'youtube.', '/forum/', '/category/'
          ];
          const isExcluded = excludePatterns.some(pattern => url.includes(pattern));
          
          // Deve ter palavras-chave de sustentabilidade
          const sustainableKeywords = [
            'sustainable', 'eco', 'organic', 'fair trade', 'biodegradable',
            'recycled', 'natural', 'green', 'ethical', 'renewable',
            'sustentável', 'ecológico', 'orgânico', 'reciclado'
          ];
          const hasSustainableKeyword = sustainableKeywords.some(kw => text.includes(kw));
          
          // Deve parecer um e-commerce (qualquer um)
          const hasPrice = text.match(/\$|€|£|R\$|price|comprar|buy/i);
          
          const isValid = hasProductURL && !isExcluded && hasSustainableKeyword && hasPrice;
          
          if (isValid) {
            console.log(`✅ Valid product: ${r.title.substring(0, 60)}`);
          }
          
          return isValid;
        });
        
        if (filteredResults.length > 0) {
          realProducts = filteredResults.map(r => ({
            title: r.title,
            url: r.url,
            snippet: r.snippet
          }));
          
          console.log(`✅ Found ${realProducts.length} valid products`);
        }
      }
      
      // Remover duplicatas por URL
      const uniqueProducts = Array.from(
        new Map(realProducts.map(p => [p.url, p])).values()
      ).slice(0, 10);
      
      realProducts = uniqueProducts;
      console.log(`✅ Final: ${realProducts.length} unique products`);
      
    } catch (searchError) {
      console.error('❌ Search error:', searchError);
      console.warn('⚠️ Continuing without search results');
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
  const pageTitle = productInfo.pageTitle || '';
  
  const breadcrumbs = (productInfo as any).breadcrumbs || '';
  const categoryHint = (productInfo as any).categoryHint || '';
  
  const translatedName = await translateProductName(productName);
  
  const text = `${translatedName} ${description} ${selectedText} ${breadcrumbs} ${categoryHint} ${pageUrl} ${pageTitle}`.toLowerCase();
  
  console.log('🔍 Text for analysis:', text.substring(0, 200));

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
        console.log(`✅ Keyword '${keyword}' found ${matches.length}x in ${categoryKey}`);
      }
      if (translatedName.toLowerCase().includes(keywordLower)) {
        score += 2;
      }
    }

    if (score > bestMatch.score) {
      bestMatch = { category: categoryKey, score };
    }
  }
  
  console.log('📊 Best match:', bestMatch);

  if (bestMatch.score === 0) {
    console.warn('⚠️ No category identified, using "general"');
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
    .map(([key, value]) => `${key} (weight: ${value.weight}): ${value.guidelines.join(', ')}`)
    .join('\n');

  const realProductsText = realProducts.length > 0
    ? `\n\nREAL SUSTAINABLE PRODUCTS FOUND:\n${
        realProducts.map((p, i) => 
          `${i + 1}. ${p.title}\n   URL: ${p.url}\n   Info: ${p.snippet.substring(0, 150)}\n`
        ).join('\n')
      }`
    : '';

  const prompt = `
You are a sustainability expert analyzing products.

ORIGINAL PRODUCT: ${productName}
CATEGORY: ${category}

SUSTAINABILITY CRITERIA:
${criteriaText}
${realProductsText}

CRITICAL INSTRUCTIONS FOR ALTERNATIVES:
${realProducts.length > 0 ? `
- You received ${realProducts.length} REAL products from web search
- Use ONLY products from the list above as alternatives
- For each alternative:
  * Use EXACT product name from search results
  * Use EXACT URL provided
  * Sustainability score must be HIGHER than original (minimum 70)
  * Product MUST be same category as original
  * VALIDATE it's truly a sustainable alternative
- If a product from search is NOT suitable (wrong category, not sustainable enough), DO NOT include it
- Better to return fewer high-quality alternatives than many irrelevant ones
` : `
- Suggest REAL products that exist in the market
- Be SPECIFIC (brand + model)
- Provide real stores where to buy
- Sustainability score must be HIGHER than original (minimum 70)
- NEVER invent products or brands
`}

RETURN VALID JSON:
{
  "originalProduct": {
    "name": "${productName}",
    "category": "${category}",
    "sustainability_score": 35,
    "summary": "Brief analysis of environmental impact",
    "environmental_impact": {
      "carbon_footprint": "Assessment",
      "water_usage": "Assessment",
      "recyclability": "Assessment",
      "toxicity": "Assessment"
    },
    "strengths": ["List actual strengths if any"],
    "weaknesses": ["List main environmental issues"],
    "certifications_found": ["List if any, empty if none"],
    "recommendations": ["Specific actions for more sustainable use"]
  },
  "alternatives": [
    {
      "name": "EXACT product name from search results",
      "description": "Clear description of the product",
      "benefits": "Why it's more sustainable than original",
      "sustainability_score": 85,
      "where_to_buy": "Specific store name",
      "certifications": ["Relevant certifications if any"],
      "product_url": "EXACT URL from search results"
    }
  ]
}

IMPORTANT: Only include alternatives that are TRULY more sustainable and from the SAME category!
`;

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { 
          role: 'system', 
          content: 'Return valid JSON. Use only real products provided in search results. Quality over quantity - better 2 great alternatives than 10 mediocre ones.' 
        },
        { role: 'user', content: prompt }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.3,
      max_tokens: 4000,
      response_format: { type: 'json_object' }
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('No response from Groq');

    const result = JSON.parse(content) as GroqAnalysisResult;
    
    // Filtrar alternativas de baixa qualidade
    if (result.alternatives) {
      result.alternatives = result.alternatives.filter(alt => 
        alt.sustainability_score >= 70 && 
        alt.name && 
        alt.name.length > 3 &&
        !alt.name.toLowerCase().includes('guide') &&
        !alt.name.toLowerCase().includes('book') &&
        !alt.name.toLowerCase().includes('article')
      );
    }
    
    console.log('🌿 Quality alternatives:', result.alternatives.length);
    console.log('📋 Alternatives:', result.alternatives.map(a => ({
      name: a.name.substring(0, 50),
      score: a.sustainability_score,
      hasUrl: !!a.product_url
    })));
    
    return result;

  } catch (error) {
    console.error('❌ Groq error:', error);
    throw error;
  }
}
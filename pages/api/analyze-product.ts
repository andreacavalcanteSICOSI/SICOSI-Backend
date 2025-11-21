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

// ===== DETECTAR TIPO DE PRODUTO COM IA =====
async function detectProductType(
  productName: string, 
  pageTitle: string = '',
  categoryName: string = ''
): Promise<string> {
  
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    // Fallback simples se não tiver API key
    const words = productName.split(/\s+/).filter(w => w.length > 2);
    return words.slice(-2).join(' ');
  }

  try {
    const groq = new Groq({ apiKey: groqApiKey });
    
    const prompt = `Extract the specific product type from this information:

Product name: ${productName}
Page title: ${pageTitle || 'N/A'}
Category: ${categoryName}

Return ONLY the product type in 1-3 words (e.g., "heels", "shampoo", "laptop", "gift set").
Be specific: if it's heels, say "heels" not "shoes". If it's shampoo, say "shampoo" not "personal care".

Product type:`;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: 'Extract product type. Return 1-3 words only.' },
        { role: 'user', content: prompt }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      max_tokens: 20
    });

    const type = completion.choices[0]?.message?.content?.trim().toLowerCase() || '';
    
    if (type && type.length > 0 && type.length < 50) {
      console.log(`🏷️ Type (AI): "${type}"`);
      return type;
    }

    throw new Error('Invalid type from AI');

  } catch (error) {
    console.error('⚠️ Type detection error:', error);
    // Fallback: últimas palavras do nome
    const words = productName.split(/\s+/).filter(w => w.length > 2);
    const fallback = words.slice(-2).join(' ');
    console.log(`🏷️ Type (fallback): "${fallback}"`);
    return fallback;
  }
}

// ===== HANDLER PRINCIPAL =====
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
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = req.body as AnalysisRequest;
    
    const productInfo: ProductInfo = body.productInfo || {
      productName: body.product_name || body.productName,
      pageUrl: body.product_url || body.pageUrl
    };

    const productName = productInfo.productName || productInfo.product_name;
    if (!productName) {
      return res.status(400).json({ success: false, error: 'productName is required' });
    }

    console.log('📦 Product:', productName);

    // 1. IDENTIFICAR CATEGORIA
    const category = await identifyCategory(productInfo);
    console.log('📂 Category:', category);

    const categories = alternativesData.categories as Record<string, CategoryData>;
    const categoryData = categories[category];

    if (!categoryData) {
      return res.status(400).json({ success: false, error: `Category not found: ${category}` });
    }

    // 2. BUSCAR PRODUTOS REAIS
    console.log('🔍 Searching sustainable alternatives...');
    
    const translatedName = await translateProductName(productName);
    const productType = await detectProductType(translatedName, productInfo.pageTitle || '', categoryData.name);
    const userCountry = productInfo.userCountry || req.body.userCountry || 'BR';
    
    const realProducts = await searchRealProducts(
      productType,
      categoryData,
      userCountry
    );

    console.log(`✅ Found ${realProducts.length} products`);

    // 3. ANALISAR COM GROQ
    const analysis = await analyzeWithGroq(
      productInfo,
      category,
      categoryData,
      productType,
      realProducts
    );

    return res.status(200).json({
      success: true,
      originalProduct: analysis.originalProduct,
      alternatives: analysis.alternatives
    });

  } catch (error) {
    console.error('❌ Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// ===== BUSCAR PRODUTOS REAIS =====
async function searchRealProducts(
  productType: string,
  categoryData: CategoryData,
  userCountry: string
): Promise<Array<{title: string, url: string, snippet: string}>> {
  
  const countryNames: Record<string, string> = {
    'BR': 'Brazil', 'US': 'United States', 'UK': 'United Kingdom',
    'CA': 'Canada', 'AU': 'Australia', 'DE': 'Germany',
    'FR': 'France', 'ES': 'Spain', 'IT': 'Italy'
  };
  const countryName = countryNames[userCountry] || 'Brazil';
  
  // Usar certificações da categoria para tornar busca mais específica
  const certKeywords = categoryData.certifications.slice(0, 3).join(' OR ');
  
  const query = `sustainable eco-friendly ${productType} ${certKeywords} ${countryName} buy`;
  console.log('🔎 Query:', query);

  try {
    const results = await webSearchClient.search(query, {
      maxResults: 50,
      searchDepth: 'advanced',
      includeAnswer: false
    });

    if (!results.success || !results.results) {
      return [];
    }

    // Filtrar produtos válidos
    const validProducts = results.results.filter(r => {
      const url = r.url.toLowerCase();
      const text = `${r.title} ${r.snippet}`.toLowerCase();
      
      // Deve ter padrão de produto
      const isProduct = ['/dp/', '/product/', '/p/', '/item/', '/listing/', '/products/'].some(p => url.includes(p));
      
      // Não deve ser artigo
      const isArticle = ['/blog/', '/article/', '/news/', '/guide/', '/review', 'youtube.', 'wikipedia.'].some(p => url.includes(p));
      
      // Deve ter keyword sustentável
      const isSustainable = ['sustainable', 'eco', 'organic', 'recycled', 'natural', 'fair trade'].some(kw => text.includes(kw));
      
      // Deve ter o tipo de produto
      const hasType = productType.toLowerCase().split(/\s+/).some(word => text.includes(word));
      
      // Deve parecer e-commerce
      const hasPrice = /\$|€|£|R\$|price|buy|shop/.test(text);
      
      return isProduct && !isArticle && isSustainable && hasType && hasPrice;
    });

    console.log(`✅ Filtered: ${validProducts.length}/${results.results.length}`);

    // Remover duplicatas
    const unique = Array.from(
      new Map(validProducts.map(p => [p.url, p])).values()
    ).slice(0, 15);

    return unique.map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet
    }));

  } catch (error) {
    console.error('❌ Search error:', error);
    return [];
  }
}

// ===== TRADUZIR =====
async function translateProductName(name: string): Promise<string> {
  if (/^[a-zA-Z0-9\s\-_]+$/.test(name)) {
    return name;
  }

  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) return name;

  try {
    const groq = new Groq({ apiKey: groqApiKey });
    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: 'Translate to English. Return ONLY the translation.' },
        { role: 'user', content: name }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.3,
      max_tokens: 50
    });

    return completion.choices[0]?.message?.content?.trim() || name;
  } catch {
    return name;
  }
}

// ===== IDENTIFICAR CATEGORIA =====
async function identifyCategory(productInfo: ProductInfo): Promise<string> {
  const name = productInfo.productName || productInfo.product_name || '';
  const desc = productInfo.description || '';
  const title = productInfo.pageTitle || '';
  const url = productInfo.pageUrl || productInfo.product_url || '';
  
  const translated = await translateProductName(name);
  const text = `${translated} ${desc} ${title} ${url}`.toLowerCase();
  
  console.log('🔍 Text:', text.substring(0, 150));

  const categories = alternativesData.categories as Record<string, CategoryData>;
  let best = { category: '', score: 0 };

  for (const [key, data] of Object.entries(categories)) {
    let score = 0;
    
    for (const keyword of data.keywords) {
      const kw = keyword.toLowerCase();
      const matches = text.match(new RegExp(kw, 'g'));
      if (matches) {
        score += matches.length;
      }
      if (translated.toLowerCase().includes(kw)) {
        score += 2;
      }
    }

    if (score > best.score) {
      best = { category: key, score };
    }
  }

  if (best.score === 0) {
    console.warn('⚠️ No category match, using general');
    return 'general';
  }

  console.log(`📊 Best: ${best.category} (score: ${best.score})`);
  return best.category;
}

// ===== ANALISAR COM GROQ =====
async function analyzeWithGroq(
  productInfo: ProductInfo,
  category: string,
  categoryData: CategoryData,
  productType: string,
  realProducts: Array<{title: string, url: string, snippet: string}>
): Promise<GroqAnalysisResult> {
  
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    throw new Error('GROQ_API_KEY not configured');
  }

  const groq = new Groq({ apiKey: groqApiKey });
  const productName = productInfo.productName || productInfo.product_name || '';

  // Construir critérios da categoria
  const criteria = Object.entries(categoryData.sustainability_criteria)
    .map(([key, val]) => `${key} (weight ${val.weight}): ${val.guidelines.join('; ')}`)
    .join('\n');

  // Construir lista de produtos
  const productsText = realProducts.length > 0
    ? `\n\nREAL PRODUCTS FOUND (${realProducts.length} total):\n${
        realProducts.map((p, i) => 
          `${i + 1}. ${p.title}\n   URL: ${p.url}\n   ${p.snippet.substring(0, 100)}...\n`
        ).join('\n')
      }`
    : '\n\nNO PRODUCTS FOUND - Suggest well-known sustainable brands.';

  const prompt = `You are a sustainability expert.

PRODUCT: ${productName}
TYPE: ${productType}
CATEGORY: ${category}

SUSTAINABILITY CRITERIA:
${criteria}

CERTIFICATIONS: ${categoryData.certifications.join(', ')}
${productsText}

${realProducts.length > 0 ? `
CRITICAL RULES:
1. Use ONLY products from list above
2. Each alternative MUST be same type as "${productType}"
3. Use EXACT names and URLs from list
4. Score must be ≥ 70
5. Return 5-8 alternatives
6. Reject: books, guides, different types

VALIDATION:
- If original is "heels" → alternatives MUST be heels (NOT sneakers/boots)
- If original is "shampoo" → alternatives MUST be shampoo (NOT conditioner)
` : `
Suggest 5-7 real sustainable brands for "${productType}".
Be specific (brand + model).
Provide realistic stores.
`}

RETURN JSON:
{
  "originalProduct": {
    "name": "${productName}",
    "category": "${category}",
    "sustainability_score": 30-50,
    "summary": "Environmental impact analysis",
    "environmental_impact": {
      "carbon_footprint": "assessment",
      "water_usage": "assessment",
      "recyclability": "assessment",
      "toxicity": "assessment"
    },
    "strengths": ["if any"],
    "weaknesses": ["main issues"],
    "certifications_found": [],
    "recommendations": ["specific actions"]
  },
  "alternatives": [
    {
      "name": "EXACT name from list (SAME type as ${productType})",
      "description": "clear description",
      "benefits": "why more sustainable",
      "sustainability_score": 70-95,
      "where_to_buy": "store name",
      "certifications": ["relevant certs"],
      "product_url": "EXACT URL from list"
    }
  ]
}`;

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: 'Return valid JSON only. Use real products. Match product types strictly.' },
        { role: 'user', content: prompt }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.2,
      max_tokens: 4000,
      response_format: { type: 'json_object' }
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('No response');

    const result = JSON.parse(content) as GroqAnalysisResult;

    // VALIDAÇÃO PÓS-IA
    if (result.alternatives) {
      const typeLower = productType.toLowerCase();
      
      result.alternatives = result.alternatives.filter(alt => {
        const altName = alt.name.toLowerCase();
        
        // Rejeitar livros/guias
        if (/book|guide|article|tips|living/.test(altName)) {
          console.log(`❌ Rejected (book): ${alt.name}`);
          return false;
        }
        
        // Rejeitar score baixo
        if (alt.sustainability_score < 70) {
          console.log(`❌ Rejected (score): ${alt.name} (${alt.sustainability_score})`);
          return false;
        }
        
        // Rejeitar tipo diferente
        const wrongTypes: Record<string, string[]> = {
          'heels': ['sneaker', 'boot', 'sandal', 'flat'],
          'sneakers': ['heel', 'boot', 'sandal', 'dress shoe'],
          'boots': ['heel', 'sneaker', 'sandal'],
          'shampoo': ['conditioner', 'soap', 'lotion'],
          'jacket': ['pant', 'shirt', 'shoe']
        };
        
        const rejects = wrongTypes[typeLower] || [];
        if (rejects.some(w => altName.includes(w))) {
          console.log(`❌ Rejected (type): ${alt.name} (want: ${productType})`);
          return false;
        }
        
        console.log(`✅ Valid: ${alt.name} (${alt.sustainability_score})`);
        return true;
      });
    }

    console.log(`🌿 Final alternatives: ${result.alternatives.length}`);
    return result;

  } catch (error) {
    console.error('❌ Groq error:', error);
    throw error;
  }
}
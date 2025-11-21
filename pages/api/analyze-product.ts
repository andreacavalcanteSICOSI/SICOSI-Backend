// pages/api/analyze-product.ts
// ARQUIVO CORRIGIDO - SICOSI Backend
// Data: 21/11/2024
// Correções aplicadas: 1, 2, 3, 4, 5, 6, 7

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
  productInfo?: {
    productName: string;
    pageUrl: string;
    pageTitle?: string;
    selectedText?: string;
  };
  category?: string;
  originalProduct?: OriginalProduct;
  alternatives?: Alternative[];
  timestamp?: string;
  error?: string;
}

// ===== DETECTAR TIPO DE PRODUTO COM IA (CORRIGIDO) =====
async function detectProductType(
  productName: string, 
  pageTitle: string = '',
  categoryName: string = ''
): Promise<string> {
  
  // ✅ CORREÇÃO 3: FALLBACK INTELIGENTE com dicionário de tipos conhecidos
  const knownTypes: Record<string, string[]> = {
    'footwear': ['heel', 'shoe', 'boot', 'sneaker', 'sandal', 'flat', 'slipper', 'pump', 'loafer'],
    'haircare': ['shampoo', 'conditioner', 'hair oil', 'hair mask', 'hair gel', 'hair spray'],
    'skincare': ['cream', 'lotion', 'serum', 'cleanser', 'toner', 'moisturizer'],
    'clothing': ['shirt', 'pant', 'jacket', 'dress', 'skirt', 'coat', 'sweater', 'hoodie'],
    'electronics': ['laptop', 'phone', 'tablet', 'monitor', 'keyboard', 'mouse', 'headphone']
  };
  
  // Buscar tipo conhecido no nome do produto
  const lowerName = productName.toLowerCase();
  const lowerTitle = pageTitle.toLowerCase();
  
  for (const [, types] of Object.entries(knownTypes)) {
    for (const type of types) {
      // Usar regex com word boundaries
      const pattern = new RegExp(`\\b${type}s?\\b`, 'i');
      if (pattern.test(lowerName) || pattern.test(lowerTitle)) {
        console.log(`🏷️ Type detected (keyword): "${type}"`);
        return type;
      }
    }
  }
  
  const groqApiKey = process.env.GROQ_API_KEY;
  
  // Se não achou com keywords e não tem API key, usar fallback básico
  if (!groqApiKey) {
    const words = productName.split(/\s+/).filter(w => w.length > 2);
    const fallback = words.slice(-2).join(' ');
    console.log(`🏷️ Type (basic fallback): "${fallback}"`);
    return fallback;
  }

  try {
    const groq = new Groq({ apiKey: groqApiKey });
    
    const prompt = `Extract the specific product type from this information:

Product name: ${productName}
Page title: ${pageTitle || 'N/A'}
Category: ${categoryName}

Return ONLY the product type in 1-2 words (e.g., "heels", "shampoo", "laptop").
Be specific: if it's heels, say "heels" not "shoes". If it's shampoo, say "shampoo" not "personal care".

Product type:`;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: 'Extract product type. Return 1-2 words only.' },
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
    console.log(`🏷️ Type (error fallback): "${fallback}"`);
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

    // ✅ LOGGING MELHORADO
    console.log('📥 [ANALYZE] Request received:', {
      productName: productName,
      pageUrl: productInfo.pageUrl,
      userCountry: productInfo.userCountry || body.userCountry || 'N/A',
      timestamp: new Date().toISOString()
    });

    // 1. IDENTIFICAR CATEGORIA
    const category = await identifyCategory(productInfo);
    console.log('📂 [CATEGORY] Identified:', category);

    const categories = alternativesData.categories as Record<string, CategoryData>;
    const categoryData = categories[category];

    if (!categoryData) {
      return res.status(400).json({ success: false, error: `Category not found: ${category}` });
    }

    // 2. BUSCAR PRODUTOS REAIS
    console.log('🔍 [SEARCH] Searching sustainable alternatives...');
    
    const translatedName = await translateProductName(productName);
    const productType = await detectProductType(translatedName, productInfo.pageTitle || '', categoryData.name);
    const userCountry = productInfo.userCountry || body.userCountry || 'BR';
    
    console.log('🏷️ [TYPE] Detected:', {
      productType: productType,
      translatedName: translatedName
    });
    
    const realProducts = await searchRealProducts(
      productType,
      categoryData,
      userCountry
    );

    console.log(`✅ [SEARCH] Found ${realProducts.length} products`);

    // 3. ANALISAR COM GROQ
    const analysis = await analyzeWithGroq(
      productInfo,
      category,
      categoryData,
      productType,
      realProducts
    );

    console.log('🤖 [GROQ] Analysis complete:', {
      originalScore: analysis.originalProduct.sustainability_score,
      alternativesCount: analysis.alternatives.length,
      averageScore: analysis.alternatives.length > 0 
        ? Math.round(analysis.alternatives.reduce((sum, a) => sum + a.sustainability_score, 0) / analysis.alternatives.length)
        : 0
    });

    // ✅ CORREÇÃO 1: ESTRUTURA DE RESPOSTA COMPLETA
    const response: AnalysisResponse = {
      success: true,
      productInfo: {
        productName: productName,
        pageUrl: productInfo.pageUrl || '',
        pageTitle: productInfo.pageTitle || '',
        selectedText: productInfo.selectedText || ''
      },
      category: category,
      originalProduct: analysis.originalProduct,
      alternatives: analysis.alternatives,
      timestamp: new Date().toISOString()
    };

    console.log('📤 [ANALYZE] Response sent:', {
      success: true,
      category: category,
      alternativesCount: analysis.alternatives.length,
      timestamp: response.timestamp
    });

    return res.status(200).json(response);

  } catch (error) {
    console.error('❌ [ERROR]:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
}

// ===== BUSCAR PRODUTOS REAIS (CORRIGIDO) =====
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
  
  // ✅ CORREÇÃO 4: QUERY SIMPLIFICADA com fallback
  const topCert = categoryData.certifications[0] || 'eco-friendly';
  
  // Query inicial (específica)
  let query = `sustainable ${productType} ${topCert} buy online`;
  console.log('🔎 [SEARCH] Query (specific):', query);

  try {
    let results = await webSearchClient.search(query, {
      maxResults: 50,
      searchDepth: 'advanced',
      includeAnswer: false
    });

    // ✅ FALLBACK: Se poucos resultados, simplificar query
    if (!results.success || !results.results || results.results.length < 5) {
      console.log('⚠️ [SEARCH] Few results, trying broader query...');
      query = `eco-friendly sustainable ${productType} shop`;
      console.log('🔎 [SEARCH] Query (broad):', query);
      
      results = await webSearchClient.search(query, {
        maxResults: 50,
        searchDepth: 'advanced',
        includeAnswer: false
      });
    }

    if (!results.success || !results.results) {
      return [];
    }

    // ✅ CORREÇÃO 5: FILTROS MAIS FLEXÍVEIS
    const validProducts = results.results.filter(r => {
      const url = r.url.toLowerCase();
      const text = `${r.title} ${r.snippet}`.toLowerCase();
      
      // Padrão de produto (mais flexível)
      const productPatterns = [
        '/dp/', '/product/', '/p/', '/item/', '/listing/', '/products/',
        '-p-', '/buy/', '/shop/'
      ];
      const isProduct = productPatterns.some(p => url.includes(p)) || 
                       /\/[\w-]+-\d+/.test(url); // Padrão "nome-produto-123"
      
      // Não deve ser artigo
      const isArticle = [
        '/blog/', '/article/', '/news/', '/guide/', '/review', 
        'youtube.', 'wikipedia.', '/best-', '/top-'
      ].some(p => url.includes(p));
      
      // Deve ter keyword sustentável (mais flexível)
      const sustainKeywords = [
        'sustain', 'eco', 'organic', 'recycle', 'natural', 
        'fair trade', 'ethical', 'green'
      ];
      const isSustainable = sustainKeywords.some(kw => text.includes(kw)) ||
                           categoryData.certifications.some(cert => 
                             text.includes(cert.toLowerCase())
                           );
      
      // Deve ter o tipo de produto (normalizado para plural/singular)
      const typeWords = productType.toLowerCase().split(/\s+/);
      const hasType = typeWords.some(word => {
        const singular = word.replace(/s$/, '');
        const plural = word + (word.endsWith('s') ? '' : 's');
        return text.includes(word) || text.includes(singular) || text.includes(plural);
      });
      
      // Deve parecer e-commerce
      const hasPrice = /\$|€|£|R\$|price|buy|shop|store|cart/.test(text);
      
      return isProduct && !isArticle && isSustainable && hasType && hasPrice;
    });

    console.log(`✅ [SEARCH] Filtered: ${validProducts.length}/${results.results.length}`);

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
    console.error('❌ [SEARCH] Error:', error);
    return [];
  }
}

// ===== TRADUZIR (CORRIGIDO) =====
async function translateProductName(name: string): Promise<string> {
  // Se já está em inglês, retornar
  if (/^[a-zA-Z0-9\s\-_]+$/.test(name)) {
    return name;
  }

  // ✅ CORREÇÃO 6: DICIONÁRIO BÁSICO DE TRADUÇÃO (fallback)
  const basicTranslations: Record<string, string> = {
    // Calçados
    'sapato': 'shoe', 'sapatos': 'shoes',
    'salto': 'heel', 'saltos': 'heels',
    'tênis': 'sneaker', 'tenis': 'sneaker',
    'bota': 'boot', 'botas': 'boots',
    'sandália': 'sandal', 'sandalia': 'sandal',
    // Cuidados pessoais
    'shampoo': 'shampoo', 'condicionador': 'conditioner',
    'sabonete': 'soap', 'creme': 'cream',
    // Roupas
    'camisa': 'shirt', 'calça': 'pants', 'calca': 'pants',
    'jaqueta': 'jacket', 'casaco': 'coat',
    // Cores
    'preto': 'black', 'branco': 'white',
    'vermelho': 'red', 'azul': 'blue', 'verde': 'green',
    // Outros
    'de': 'of', 'para': 'for', 'com': 'with'
  };
  
  // Tentar tradução básica primeiro
  const words = name.toLowerCase().split(/\s+/);
  const basicTranslation = words
    .map(word => basicTranslations[word] || word)
    .join(' ');
  
  // Se conseguiu traduzir algo, usar
  if (basicTranslation !== name.toLowerCase()) {
    console.log(`🌐 [TRANSLATE] Basic: "${name}" → "${basicTranslation}"`);
    return basicTranslation;
  }

  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    console.log('⚠️ [TRANSLATE] No API key, using basic translation');
    return basicTranslation;
  }

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

    const translation = completion.choices[0]?.message?.content?.trim();
    if (translation && translation.length > 0) {
      console.log(`🌐 [TRANSLATE] AI: "${name}" → "${translation}"`);
      return translation;
    }
    
    console.log('⚠️ [TRANSLATE] AI failed, using basic translation');
    return basicTranslation;
    
  } catch (error) {
    console.error('❌ [TRANSLATE] Error:', error);
    return basicTranslation;
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
  
  console.log('🔍 [CATEGORY] Text sample:', text.substring(0, 150));

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
    console.warn('⚠️ [CATEGORY] No match, using textiles_clothing as fallback');
    return 'textiles_clothing';
  }

  console.log(`📊 [CATEGORY] Best: ${best.category} (score: ${best.score})`);
  return best.category;
}

// ===== ANALISAR COM GROQ (CORRIGIDO) =====
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
    "sustainability_score": 20-45,
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
    if (!content) throw new Error('No response from Groq');

    const result = JSON.parse(content) as GroqAnalysisResult;

    // ✅ CORREÇÃO 2: VALIDAÇÃO PÓS-IA COM REGEX
    if (result.alternatives) {
      const typeLower = productType.toLowerCase();
      
      // ✅ Usar REGEX com word boundaries ao invés de includes()
      const wrongTypes: Record<string, string[]> = {
        'heels': ['\\bsneakers?\\b', '\\bboots?\\b', '\\bsandals?\\b', '\\bflats?\\b', '\\bloafers?\\b'],
        'sneakers': ['\\bheels?\\b', '\\bboots?\\b', '\\bsandals?\\b', '\\bdress\\s+shoes?\\b', '\\bpumps?\\b'],
        'boots': ['\\bheels?\\b', '\\bsneakers?\\b', '\\bsandals?\\b', '\\bflats?\\b'],
        'sandals': ['\\bheels?\\b', '\\bboots?\\b', '\\bsneakers?\\b', '\\bflats?\\b'],
        'flats': ['\\bheels?\\b', '\\bboots?\\b', '\\bsneakers?\\b', '\\bsandals?\\b'],
        'shampoo': ['\\bconditioners?\\b', '\\bsoaps?\\b', '\\blotions?\\b', '\\bgels?\\b'],
        'conditioner': ['\\bshampoos?\\b', '\\bsoaps?\\b', '\\blotions?\\b'],
        'jacket': ['\\bpants?\\b', '\\bshirts?\\b', '\\bshoes?\\b', '\\bskirts?\\b'],
        'laptop': ['\\bphones?\\b', '\\btablets?\\b', '\\bmonitors?\\b', '\\bkeyboards?\\b'],
        'phone': ['\\blaptops?\\b', '\\btablets?\\b', '\\bwatches?\\b', '\\bcomputers?\\b']
      };
      
      result.alternatives = result.alternatives.filter(alt => {
        const altName = alt.name.toLowerCase();
        
        // Rejeitar livros/guias
        if (/\b(book|guide|article|tips|living)\b/.test(altName)) {
          console.log(`❌ [VALIDATION] Rejected (book): ${alt.name}`);
          return false;
        }
        
        // Rejeitar score baixo
        if (alt.sustainability_score < 70) {
          console.log(`❌ [VALIDATION] Rejected (score): ${alt.name} (${alt.sustainability_score})`);
          return false;
        }
        
        // ✅ Rejeitar tipo diferente usando REGEX
        const wrongTypePatterns = wrongTypes[typeLower]?.map(pattern => 
          new RegExp(pattern, 'i')
        ) || [];
        
        if (wrongTypePatterns.some(pattern => pattern.test(altName))) {
          console.log(`❌ [VALIDATION] Rejected (wrong type): ${alt.name} (expected: ${productType})`);
          return false;
        }
        
        console.log(`✅ [VALIDATION] Valid: ${alt.name} (${alt.sustainability_score})`);
        return true;
      });
    }

    console.log(`🌿 [VALIDATION] Final alternatives: ${result.alternatives.length}`);
    return result;

  } catch (error) {
    console.error('❌ [GROQ] Error:', error);
    throw error;
  }
}
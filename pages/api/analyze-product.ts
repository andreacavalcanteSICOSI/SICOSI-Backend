// pages/api/analyze-product.ts

import type { NextApiRequest, NextApiResponse } from 'next';
import Groq from 'groq-sdk';
import alternativesData from '../../data/alternatives.json';
import config from '../../config';
import webSearchClient from '../../services/web-search-client';

/**
 * Map ISO country code to language/locale
 * @param {string} countryCode - ISO 3166-1 alpha-2 country code
 * @returns {string} - Language locale (e.g., 'pt-BR', 'en-US')
 */
function getLanguageFromCountry(countryCode: string): string {
  const languageMap: Record<string, string> = {
    // Portuguese
    'BR': 'pt-BR',
    'PT': 'pt-PT',

    // Spanish
    'ES': 'es-ES',
    'MX': 'es-MX',
    'AR': 'es-AR',
    'CL': 'es-CL',
    'CO': 'es-CO',

    // English
    'US': 'en-US',
    'GB': 'en-GB',
    'CA': 'en-CA',
    'AU': 'en-AU',

    // French
    'FR': 'fr-FR',

    // German
    'DE': 'de-DE',

    // Italian
    'IT': 'it-IT',

    // Japanese
    'JP': 'ja-JP',

    // Chinese
    'CN': 'zh-CN'
  };

  return languageMap[countryCode] || 'en-US';
}

/**
 * Get preferred e-commerce sites by country
 * @param {string} countryCode - ISO 3166-1 alpha-2 country code
 * @returns {Array<string>} - List of local e-commerce sites
 */
function getLocalEcommerce(countryCode: string): string[] {
  const ecommerceByCountry: Record<string, string[]> = {
    'BR': [
      'Mercado Livre (mercadolivre.com.br)',
      'Americanas (americanas.com.br)',
      'Magazine Luiza (magazineluiza.com.br)',
      'Amazon Brasil (amazon.com.br)',
      'Shopee Brasil (shopee.com.br)'
    ],
    'US': [
      'Amazon (amazon.com)',
      'Walmart (walmart.com)',
      'Target (target.com)',
      'eBay (ebay.com)',
      'Best Buy (bestbuy.com)'
    ],
    'GB': [
      'Amazon UK (amazon.co.uk)',
      'Argos (argos.co.uk)',
      'Currys (currys.co.uk)',
      'John Lewis (johnlewis.com)'
    ],
    'ES': [
      'Amazon España (amazon.es)',
      'El Corte Inglés (elcorteingles.es)',
      'MediaMarkt (mediamarkt.es)',
      'Carrefour (carrefour.es)'
    ],
    'MX': [
      'Mercado Libre (mercadolibre.com.mx)',
      'Amazon México (amazon.com.mx)',
      'Liverpool (liverpool.com.mx)',
      'Coppel (coppel.com)'
    ],
    'AR': [
      'Mercado Libre (mercadolibre.com.ar)',
      'Falabella (falabella.com.ar)',
      'Garbarino (garbarino.com)'
    ],
    'FR': [
      'Amazon France (amazon.fr)',
      'Cdiscount (cdiscount.com)',
      'Fnac (fnac.com)',
      'Darty (darty.com)'
    ],
    'DE': [
      'Amazon Deutschland (amazon.de)',
      'MediaMarkt (mediamarkt.de)',
      'Saturn (saturn.de)',
      'Otto (otto.de)'
    ],
    'IT': [
      'Amazon Italia (amazon.it)',
      'ePRICE (eprice.it)',
      'Unieuro (unieuro.it)'
    ],
    'CA': [
      'Amazon Canada (amazon.ca)',
      'Best Buy Canada (bestbuy.ca)',
      'Walmart Canada (walmart.ca)'
    ],
    'AU': [
      'Amazon Australia (amazon.com.au)',
      'JB Hi-Fi (jbhifi.com.au)',
      'Harvey Norman (harveynorman.com.au)'
    ]
  };

  return ecommerceByCountry[countryCode] || [
    'Amazon',
    'eBay',
    'Local e-commerce sites',
    'Specialty sustainable retailers'
  ];
}

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
  exclusion_keywords: string[];
  keyword_synonyms: Record<string, string[]>;
  sustainability_criteria: Record<string, SustainabilityCriterion>;
  certifications: string[];
  references: string[];
  brazilian_brands?: string[];
  product_types?: string[];
}

interface ScoringSource {
  text: string;
  weight: number;
}

interface CategoryScore {
  category: string;
  score: number;
  matches: string[];
  exclusions: string[];
  confidence: 'high' | 'medium' | 'low';
}

interface ScoringConfig {
  source_weights: {
    product_name_translated: number;
    product_name_original: number;
    page_title: number;
    description: number;
    url: number;
  };
  validation_thresholds: {
    minimum_score: number;
    confidence_ratio: number;
    exclusion_penalty: number;
  };
}

interface TextProcessingConfig {
  remove_accents: boolean;
  lowercase: boolean;
  remove_punctuation: boolean;
  word_boundary_matching: boolean;
}

interface AlternativesConfig {
  version: string;
  description: string;
  lastUpdated: string;
  source: string;
  common_translations: Record<string, string>;
  incompatible_types: Record<string, string[]>;
  categories: Record<string, CategoryData>;
  scoring_config: ScoringConfig;
  text_processing: TextProcessingConfig;
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

// Cast seguro para o JSON
const alternativesConfig = alternativesData as unknown as AlternativesConfig;

const VALID_CATEGORIES: Record<string, true> = Object.keys(alternativesConfig.categories).reduce(
  (map, key) => {
    map[key] = true;
    return map;
  },
  {} as Record<string, true>
);

// ======= UTILIDADES DE CATEGORIZAÇÃO DINÂMICA =======
function getTextProcessingConfig(): TextProcessingConfig {
  return (
    alternativesConfig.text_processing || {
      remove_accents: true,
      lowercase: true,
      remove_punctuation: true,
      word_boundary_matching: true
    }
  );
}

function normalizeCategoryText(text: string): string {
  const settings = getTextProcessingConfig();
  let result = text || '';

  if (settings.lowercase) {
    result = result.toLowerCase();
  }

  if (settings.remove_accents) {
    result = result.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  if (settings.remove_punctuation) {
    result = result.replace(/[^a-z0-9\s]/g, ' ');
  }

  return result.replace(/\s+/g, ' ').trim();
}

function expandKeywordWithSynonyms(
  keyword: string,
  synonymsMap: Record<string, string[]>
): string[] {
  const normalizedKeyword = (keyword || '').toLowerCase();
  const variants = new Set<string>([normalizedKeyword]);

  const synonyms = synonymsMap?.[normalizedKeyword] || [];
  synonyms.forEach((syn) => variants.add((syn || '').toLowerCase()));

  if (!normalizedKeyword.endsWith('s')) {
    variants.add(`${normalizedKeyword}s`);
  }
  variants.add(normalizedKeyword.replace(/s$/, ''));

  return Array.from(variants).filter(Boolean);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countMatches(text: string, keyword: string): number {
  const settings = getTextProcessingConfig();
  const safeKeyword = escapeRegex((keyword || '').toLowerCase());

  if (settings.word_boundary_matching) {
    const pattern = new RegExp(`\\b${safeKeyword}\\b`, 'gi');
    const matches = text.match(pattern);
    return matches ? matches.length : 0;
  }

  return (text.match(new RegExp(safeKeyword, 'gi')) || []).length;
}

function calculateCategoryScores(sources: ScoringSource[]): CategoryScore[] {
  const categories = alternativesConfig.categories;
  const results: CategoryScore[] = [];

  for (const [categoryKey, categoryData] of Object.entries(categories)) {
    let totalScore = 0;
    const matches: string[] = [];

    for (const source of sources) {
      if (!source.text || source.weight === 0) continue;

      const normalizedText = normalizeCategoryText(source.text);

      for (const keyword of categoryData.keywords) {
        const allVariants = expandKeywordWithSynonyms(keyword, categoryData.keyword_synonyms);

        for (const variant of allVariants) {
          const matchCount = countMatches(normalizedText, variant);

          if (matchCount > 0) {
            const points = matchCount * source.weight;
            totalScore += points;
            matches.push(`${variant} (${matchCount}x, +${points}pts)`);
          }
        }
      }
    }

    results.push({
      category: categoryKey,
      score: totalScore,
      matches,
      exclusions: [],
      confidence: 'medium'
    });
  }

  return results;
}

function applyExclusionRules(
  scores: CategoryScore[],
  primaryText: string
): CategoryScore[] {
  const normalizedPrimary = normalizeCategoryText(primaryText);
  const categories = alternativesConfig.categories;
  const penalty =
    alternativesConfig.scoring_config?.validation_thresholds?.exclusion_penalty ?? -999;

  return scores.map((scoreData) => {
    const categoryData = categories[scoreData.category];
    const exclusionKeywords = categoryData.exclusion_keywords || [];
    const exclusionsFound: string[] = [];

    for (const exclusionKw of exclusionKeywords) {
      const allVariants = expandKeywordWithSynonyms(
        exclusionKw,
        categoryData.keyword_synonyms
      );

      for (const variant of allVariants) {
        if (countMatches(normalizedPrimary, variant) > 0) {
          exclusionsFound.push(variant);
        }
      }
    }

    if (exclusionsFound.length > 0) {
      return {
        ...scoreData,
        score: scoreData.score + penalty,
        exclusions: exclusionsFound
      };
    }

    return scoreData;
  });
}

function selectWinner(scores: CategoryScore[]): CategoryScore | null {
  const thresholds = alternativesConfig.scoring_config.validation_thresholds;
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const first = sorted[0];
  const second = sorted[1];

  if (!first || first.score < thresholds.minimum_score) {
    console.log(
      `❌ [CATEGORY] Winner score too low: ${first?.score ?? 0} < ${thresholds.minimum_score}`
    );
    return null;
  }

  const ratio = second && second.score > 0 ? first.score / second.score : Infinity;

  if (ratio < thresholds.confidence_ratio) {
    first.confidence = 'low';
    console.log(
      `⚠️ [CATEGORY] Low confidence: ratio ${ratio.toFixed(2)} < ${thresholds.confidence_ratio}`
    );
  } else if (ratio >= thresholds.confidence_ratio * 1.5) {
    first.confidence = 'high';
  } else {
    first.confidence = 'medium';
  }

  if (first.exclusions.length > 0) {
    console.log(`❌ [CATEGORY] Exclusions found for ${first.category}:`, first.exclusions);
    return null;
  }

  return first;
}

async function classifyWithAI(
  name: string,
  translated: string,
  title: string
): Promise<string> {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    throw new Error('Cannot classify: low confidence and no AI available');
  }

  const categories = alternativesConfig.categories;
  const categoryList = Object.entries(categories)
    .map(
      ([key, data]) =>
        `- ${key}: ${data.name} (keywords: ${data.keywords.slice(0, 5).join(', ')})`
    )
    .join('\n');

  const prompt = `Classify this product into ONE category:

PRODUCT: ${name}
TRANSLATED: ${translated}
PAGE TITLE: ${title}

AVAILABLE CATEGORIES:
${categoryList}

Return ONLY the category key (e.g., "fashion_apparel").
Category:`;

  try {
    const groq = new Groq({ apiKey: groqApiKey });
    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: 'Return only the category key, nothing else.' },
        { role: 'user', content: prompt }
      ],
      model: config.groq.defaultModel,
      temperature: config.groq.operations.typeDetection.temperature,
      max_tokens: config.groq.operations.typeDetection.maxTokens
    });

    const rawCategory = completion.choices[0]?.message?.content?.trim();
    const category = rawCategory ? rawCategory.toLowerCase() : '';

    if (category && categories[category]) {
      console.log(`🤖 [CATEGORY] AI classified as: ${category}`);
      return category;
    }

    throw new Error(`AI returned invalid category: ${category}`);
  } catch (error) {
    console.error('❌ [CATEGORY] AI classification failed:', error);
    throw new Error('Could not identify product category');
  }
}

function logCategorizationResult(
  allScores: CategoryScore[],
  winner: CategoryScore | null
): void {
  console.log('🔍 [CATEGORY] Detailed Analysis:');
  console.log('━'.repeat(60));

  const top3 = [...allScores]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  for (const score of top3) {
    console.log(`\n📊 ${score.category}: ${score.score} points`);
    if (score.matches.length > 0) {
      console.log(`   ✓ Matches: ${score.matches.join(', ')}`);
    }
    if (score.exclusions.length > 0) {
      console.log(`   ✗ Exclusions: ${score.exclusions.join(', ')}`);
    }
  }

  console.log('\n' + '━'.repeat(60));

  if (winner) {
    console.log(`✅ [CATEGORY] Winner: ${winner.category}`);
    console.log(`   Confidence: ${winner.confidence}`);
    console.log(`   Score: ${winner.score}`);
  } else {
    console.log('❌ [CATEGORY] No valid winner found');
  }

  console.log('━'.repeat(60));
}

// ===== DETECTAR TIPO DE PRODUTO COM IA (CORRIGIDO) =====
async function detectProductType(
  productName: string, 
  pageTitle: string = '',
  categoryName: string = ''
): Promise<string> {

  // ✅ CORREÇÃO 3: FALLBACK INTELIGENTE com dicionário dinâmico do JSON
  const categories = alternativesConfig.categories;

  // Buscar tipo conhecido no nome do produto
  const safeProductName = productName || '';
  const lowerName = safeProductName.toLowerCase();
  const lowerTitle = (pageTitle || '').toLowerCase();
  
  for (const [, data] of Object.entries(categories)) {
    if (data.product_types) {
      for (const type of data.product_types) {
        // Usar regex com word boundaries
        const pattern = new RegExp(`\\b${type}s?\\b`, 'i');
        if (pattern.test(lowerName) || pattern.test(lowerTitle)) {
          console.log(`🏷️ Type detected (keyword from json): "${type}"`);
          return type;
        }
      }
    }
  }
  
  const groqApiKey = process.env.GROQ_API_KEY;
  
  // Se não achou com keywords e não tem API key, usar fallback básico
  if (!groqApiKey) {
    const words = safeProductName.split(/\s+/).filter(w => w.length > 2);
    const fallback = words.slice(-2).join(' ');
    console.log(`🏷️ Type (basic fallback): "${fallback}"`);
    return fallback;
  }

  try {
    const groq = new Groq({ apiKey: groqApiKey });
    
    const prompt = `Extract the SPECIFIC and DETAILED product type from: "${productName}".

CRITICAL INSTRUCTIONS:
- Be EXTREMELY SPECIFIC, not generic
- Include the product's primary function/purpose
- For software, specify what kind of software (photo editing, video editing, office, etc.)
- For electronics, specify the device type (smartphone, laptop, tablet, etc.)
- For clothing, specify the item type (sneakers, jacket, t-shirt, etc.)

EXAMPLES:
- "Adobe Photoshop 2024" → "photo editing software"
- "Microsoft Office 365" → "office productivity software"
- "iPhone 15 Pro" → "smartphone"
- "Nike Air Max" → "athletic sneakers"
- "IKEA POÄNG Chair" → "armchair furniture"
- "Pantene Shampoo" → "hair care shampoo"
- "Tesla Model 3" → "electric sedan vehicle"

Return ONLY the specific product type in English, nothing else.`;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: 'Extract product type. Return 1-2 words only.' },
        { role: 'user', content: prompt }
      ],
      model: config.groq.defaultModel,
      temperature: config.groq.operations.typeDetection.temperature,
      max_tokens: config.groq.operations.typeDetection.maxTokens
    });

    const rawType = completion.choices[0]?.message?.content?.trim();
    const type = rawType ? rawType.toLowerCase() : '';
    
    if (type && type.length > 0 && type.length < 50) {
      console.log(`🏷️ Type (AI): "${type}"`);
      return type;
    }

    throw new Error('Invalid type from AI');

  } catch (error) {
    console.error('⚠️ Type detection error:', error);
    // Fallback: últimas palavras do nome
    const words = safeProductName.split(/\s+/).filter(w => w.length > 2);
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
    const userCountry = body.userCountry || body.productInfo?.userCountry || 'US';

    const productInfo: ProductInfo = body.productInfo || {
      productName: body.product_name || body.productName,
      pageUrl: body.product_url || body.pageUrl,
      userCountry
    };

    productInfo.userCountry = productInfo.userCountry || userCountry;

    const productName = productInfo.productName || productInfo.product_name;
    if (!productName) {
      return res.status(400).json({ success: false, error: 'productName is required' });
    }

    // ✅ LOGGING MELHORADO
    console.log('📥 [ANALYZE] Request received:', {
      productName: productName,
      pageUrl: productInfo.pageUrl,
      userCountry: productInfo.userCountry || userCountry || 'N/A',
      timestamp: new Date().toISOString()
    });

    // 1. IDENTIFICAR CATEGORIA
    const category = await identifyCategory(productInfo);
    console.log('📂 [CATEGORY] Identified:', category);

    const categories = alternativesConfig.categories;
    const categoryData = categories[category];

    if (!categoryData) {
      return res.status(400).json({ success: false, error: `Category not found: ${category}` });
    }

    // 2. BUSCAR PRODUTOS REAIS
    console.log('🔍 [SEARCH] Searching sustainable alternatives...');
    
    const translatedName = await translateProductName(productName);
    const productType = await detectProductType(translatedName, productInfo.pageTitle || '', categoryData.name);

    console.log('🏷️ [TYPE] Detected:', {
      productType: productType,
      translatedName: translatedName
    });
    
    const realProducts = await searchRealProducts(
      productName,
      productType,
      categoryData,
      category,
      userCountry
    );

    console.log(`✅ [SEARCH] Found ${realProducts.length} products`);

    console.log('📦 Product Name:', productName);
    console.log('🏷️ Detected Type:', productType);
    console.log('📁 Category:', categoryData.name);
    console.log('🔍 Search Results Count:', realProducts.length);

    // 3. ANALISAR COM GROQ
    const analysis = await analyzeWithGroq(
      productInfo,
      category,
      categoryData,
      productType,
      realProducts,
      userCountry
    );

    console.log('🤖 [GROQ] Analysis complete:', {
      originalScore: analysis.originalProduct.sustainability_score,
      alternativesCount: analysis.alternatives.length,
      averageScore: analysis.alternatives.length > 0
        ? Math.round(analysis.alternatives.reduce((sum, a) => sum + a.sustainability_score, 0) / analysis.alternatives.length)
        : 0
    });

    console.log('🎯 Final Score:', analysis.originalProduct.sustainability_score);
    console.log('💡 Alternatives:', analysis.alternatives);

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
  productName: string,
  productType: string,
  categoryData: CategoryData,
  category: string,
  userCountry: string
): Promise<Array<{title: string, url: string, snippet: string}>> {
  
  const countryNames: Record<string, string> = {
    'BR': 'Brazil', 'US': 'United States', 'UK': 'United Kingdom',
    'CA': 'Canada', 'AU': 'Australia', 'DE': 'Germany',
    'FR': 'France', 'ES': 'Spain', 'IT': 'Italy'
  };
  
  // Construir query mais específica baseada na categoria
  let query: string;

  if (category === 'digital_products_software' || category === 'cloud_services') {
    // Para software, incluir "alternative to" + nome do produto principal
    const mainProduct = (productName || '').split(' ')[0];
    query = `sustainable ${productType} alternative to ${mainProduct} eco-friendly`;
  } else {
    // Para produtos físicos, manter abordagem atual melhorada
    query = `sustainable ${productType} eco-friendly certified brands buy`;
  }

  console.log(`🔍 Web Search Query: ${query}`);

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
    const rawResults = (results.results || []).filter(Boolean);
    const validProducts = rawResults.filter(r => {
      const url = (r.url || '').toLowerCase();
      const text = `${r.title || ''} ${r.snippet || ''}`.toLowerCase();
      
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
                           categoryData.certifications.some(cert => {
                             const certText = (cert || '').toLowerCase();
                             return text.includes(certText);
                           });
      
      // Deve ter o tipo de produto (normalizado para plural/singular)
      const typeWords = (productType || '').toLowerCase().split(/\s+/);
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
      title: r.title || 'Untitled Product',
      url: r.url || '',
      snippet: r.snippet || 'No description available'
    }));

  } catch (error) {
    console.error('❌ [SEARCH] Error:', error);
    return [];
  }
}

// ===== TRADUZIR (CORRIGIDO) =====
async function translateProductName(name: string): Promise<string> {
  if (!name || name.trim().length === 0) {
    console.log('⚠️ [TRANSLATE] Empty product name provided');
    return '';
  }
  // Se já está em inglês, retornar
  if (/^[a-zA-Z0-9\s\-_]+$/.test(name)) {
    return name;
  }

  // ✅ CORREÇÃO 6: DICIONÁRIO BÁSICO DE TRADUÇÃO (dinâmico do JSON)
  const commonTranslations = alternativesConfig.common_translations;
  const basicTranslations: Record<string, string> = commonTranslations || {
    // Fallback caso o JSON falhe
    'sapato': 'shoe', 'sapatos': 'shoes',
    'salto': 'heel', 'saltos': 'heels',
    'tênis': 'sneaker', 'tenis': 'sneaker'
  };
  
  // Tentar tradução básica primeiro
  const normalizedName = name || '';
  const words = normalizedName.toLowerCase().split(/\s+/);
  const basicTranslation = words
    .map(word => basicTranslations[word] || word)
    .join(' ');
  
  // Se conseguiu traduzir algo, usar
  if (basicTranslation !== normalizedName.toLowerCase()) {
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
        { role: 'system', content: 'Translate to English. Return ONLY the translation, nothing else.' },
        { role: 'user', content: name }
      ],
      model: config.groq.defaultModel,
      temperature: config.groq.operations.translation.temperature,
      max_tokens: config.groq.operations.translation.maxTokens
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

// ===== IDENTIFICAR CATEGORIA (REFATORADA - CONFIG-DRIVEN) =====
async function identifyCategory(productInfo: ProductInfo): Promise<string> {
  const name = productInfo.productName || productInfo.product_name || '';
  const desc = productInfo.description || '';
  const title = productInfo.pageTitle || '';
  const url = productInfo.pageUrl || productInfo.product_url || '';

  // 🔎 Heuristic categorization to distinguish software vs physical supplies
  try {
    const heuristicCategory = categorizeProduct(
      name,
      `${title} ${desc}`
    );

    if (heuristicCategory) {
      if (!VALID_CATEGORIES[heuristicCategory]) {
        throw new Error(`Internal error: Invalid category "${heuristicCategory}"`);
      }

      console.log('✅ [CATEGORY] Heuristic match:', heuristicCategory);
      return heuristicCategory;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('too generic')) {
      throw error;
    }
    console.log('ℹ️ [CATEGORY] Heuristic not conclusive:', error);
  }

  const translated = await translateProductName(name);
  if (!name && !desc && !title && !url) {
    console.error('❌ [CATEGORY] No product information provided');
    throw new Error(
      'Product information is required. Please provide at least a product name, description, title, or URL.'
    );
  }
  const weights = alternativesConfig.scoring_config.source_weights;

  const textSample = [translated, name, title, desc].filter(Boolean).join(' | ');
  console.log('🔍 [CATEGORY] Text sample:', textSample ? textSample.substring(0, 150) : '(empty)');

  const sources: ScoringSource[] = [
    { text: translated, weight: weights.product_name_translated },
    { text: name, weight: weights.product_name_original },
    { text: title, weight: weights.page_title },
    { text: desc, weight: weights.description }
  ];

  const categoryScores = calculateCategoryScores(sources);
  const filteredScores = applyExclusionRules(categoryScores, translated);
  const winner = selectWinner(filteredScores);

  logCategorizationResult(filteredScores, winner);

  if (!winner || winner.confidence === 'low') {
    console.log('⚠️ [CATEGORY] Low confidence, using AI fallback');
    return await classifyWithAI(name, translated, title);
  }

  return winner.category;
}

function categorizeProduct(productName: string, productType: string): string {
  const nameLower = (productName || '').toLowerCase();
  const typeLower = (productType || '').toLowerCase();

  const isTooShort = productName.trim().length < 3;
  const isJustNumbers = /^\d+$/.test(productName.trim());
  const isGenericWord = ['product', 'item', 'thing', 'test', 'xyz', 'abc'].includes(
    nameLower.trim()
  );

  if (isTooShort || isJustNumbers || isGenericWord) {
    throw new Error('Could not identify product category - product name too generic or incomplete');
  }

  throw new Error('Use identifyCategory() instead');
}

// ===== ANALISAR COM GROQ (CORRIGIDO) =====
async function analyzeWithGroq(
  productInfo: ProductInfo,
  category: string,
  categoryData: CategoryData,
  productType: string,
  realProducts: Array<{title: string, url: string, snippet: string}>,
  userCountry: string
): Promise<GroqAnalysisResult> {
  
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    throw new Error('GROQ_API_KEY not configured');
  }

  const groq = new Groq({ apiKey: groqApiKey });
  const productName = productInfo.productName || productInfo.product_name || '';

  const userLanguage = getLanguageFromCountry(userCountry);
  const localEcommerce = getLocalEcommerce(userCountry);

  const prompt = `You are a sustainability expert analyzing products for users worldwide.

═══════════════════════════════════════════════════════════════
USER CONTEXT (CRITICAL - READ CAREFULLY):
═══════════════════════════════════════════════════════════════
- User Country: ${userCountry}
- User Language: ${userLanguage}
- Local E-commerce Sites: ${localEcommerce.slice(0, 3).join(', ')}

═══════════════════════════════════════════════════════════════
LOCALIZATION REQUIREMENTS (MANDATORY):
═══════════════════════════════════════════════════════════════

1. LANGUAGE: Respond ENTIRELY in ${userLanguage}
   - ALL text fields must be in ${userLanguage}
   - Do NOT use English unless userLanguage is en-US or en-GB
   
2. E-COMMERCE: Suggest products available in ${userCountry}
   - Prioritize these local sites: ${localEcommerce.slice(0, 3).join(', ')}
   - Provide real product URLs from these sites when possible
   - Use "where_to_buy" field to specify local retailers
   
3. CERTIFICATIONS: Include certifications relevant to ${userCountry}
   - Use local/regional certifications when applicable
   - Example: For BR use INMETRO, for EU use EU Ecolabel, for US use EPA Safer Choice

═══════════════════════════════════════════════════════════════
PRODUCT TO ANALYZE:
═══════════════════════════════════════════════════════════════

Product Name: ${productName}
URL: ${productInfo.pageUrl}
Category: ${category}

═══════════════════════════════════════════════════════════════
REQUIRED JSON RESPONSE FORMAT:
═══════════════════════════════════════════════════════════════

{
  "sustainability_score": <number 0-100>,
  "summary": "<brief summary in ${userLanguage}>",
  "strengths": ["<strength 1 in ${userLanguage}>", "<strength 2 in ${userLanguage}>"],
  "weaknesses": ["<weakness 1 in ${userLanguage}>", "<weakness 2 in ${userLanguage}>"],
  "recommendations": ["<recommendation 1 in ${userLanguage}>", "<recommendation 2 in ${userLanguage}>"],
  "alternatives": [
    {
      "name": "<product name in ${userLanguage}>",
      "description": "<description in ${userLanguage}>",
      "sustainability_score": <number 0-100>,
      "benefits": "<benefits in ${userLanguage}>",
      "where_to_buy": "<prefer ${localEcommerce[0]} or similar>",
      "product_url": "<actual URL from ${localEcommerce[0]} if available, or Google search URL>",
      "certifications": ["<certification 1>", "<certification 2>"]
    }
  ]
}

═══════════════════════════════════════════════════════════════
EXAMPLES BY LANGUAGE:
═══════════════════════════════════════════════════════════════

If userLanguage = "pt-BR" (Brazilian Portuguese):
- summary: "Este produto tem baixo impacto ambiental devido..."
- strengths: ["Uso de materiais recicláveis", "Certificação B Corp"]
- where_to_buy: "Mercado Livre, Americanas"

If userLanguage = "es-MX" (Mexican Spanish):
- summary: "Este producto tiene bajo impacto ambiental debido..."
- strengths: ["Uso de materiales reciclables", "Certificación B Corp"]
- where_to_buy: "Mercado Libre, Amazon México"

If userLanguage = "en-US" (US English):
- summary: "This product has low environmental impact due to..."
- strengths: ["Use of recyclable materials", "B Corp certification"]
- where_to_buy: "Amazon, Walmart"

═══════════════════════════════════════════════════════════════
CRITICAL REMINDERS:
═══════════════════════════════════════════════════════════════

1. ALL text must be in ${userLanguage} - no exceptions
2. Suggest 4 alternatives available in ${userCountry}
3. Use real product URLs from ${localEcommerce[0]} when possible
4. Return ONLY valid JSON (no markdown, no extra text)

Begin analysis now.`;

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: 'Return valid JSON only. Use real products. Match product types strictly.' },
        { role: 'user', content: prompt }
      ],
      model: config.groq.defaultModel,
      temperature: config.groq.operations.analysis.temperature,
      max_tokens: config.groq.operations.analysis.maxTokens,
      response_format: { type: 'json_object' }
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('No response from Groq');

    const result = JSON.parse(content) as GroqAnalysisResult;

    if (result.alternatives) {
      result.alternatives = result.alternatives.filter(alt => {
        if (!alt || !alt.name) {
          return false;
        }

        const altName = (alt.name || '').toLowerCase();

        if (/\b(book|guide|article|manual|course|tutorial)\b/.test(altName)) {
          return false;
        }

        if (alt.sustainability_score < config.sustainability.minAlternativeScore) {
          return false;
        }

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

export { identifyCategory };
// pages/api/analyze-product.ts

import type { NextApiRequest, NextApiResponse } from 'next';
import Groq from 'groq-sdk';
import alternativesData from '../../data/alternatives.json';
import config from '../../config';
import webSearchClient from '../../services/web-search-client';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 horas

function getCacheKey(productName: string, userCountry: string): string {
  const normalized = productName.toLowerCase().trim().replace(/\s+/g, ' ');
  return `sicosi:${normalized}:${userCountry}`;
}

async function getCachedAnalysis(productName: string, userCountry: string): Promise<GroqAnalysisResult | null> {
  try {
    const key = getCacheKey(productName, userCountry);
    const cached = await redis.get<GroqAnalysisResult>(key);

    if (cached) {
      console.log(`✅ [CACHE] Redis HIT: ${key.substring(0, 50)}`);
      return cached;
    }

    console.log(`📭 [CACHE] Redis MISS: ${key.substring(0, 50)}`);
    return null;
  } catch (error) {
    console.error('❌ [CACHE] Redis error:', error);
    return null;
  }
}

async function setCachedAnalysis(productName: string, userCountry: string, result: GroqAnalysisResult): Promise<void> {
  try {
    const key = getCacheKey(productName, userCountry);
    await redis.set(key, result, { ex: CACHE_TTL_SECONDS });
    console.log(`💾 [CACHE] Redis SAVED: ${key.substring(0, 50)} (TTL: 24h)`);
  } catch (error) {
    console.error('❌ [CACHE] Redis save error:', error);
  }
}

/**
 * Map ISO country code to language/locale
 * @param {string} countryCode - ISO 3166-1 alpha-2 country code
 * @returns {string} - Language locale (e.g., 'pt-BR', 'en-US')
 */
function getLanguageFromCountry(countryCode: string): string {
  // Return ISO locale format for reference only
  // Groq will detect actual language from product name
  return `${countryCode.toLowerCase()}-${countryCode}`;
}

// Cross-validate country using multiple signals
function validateAndCorrectCountry(
  userCountry: string,
  pageUrl: string | undefined,
  productName: string
): string {
  console.log('🔍 [VALIDATE] Cross-validating country...');
  console.log('📍 [VALIDATE] Input:', { userCountry, pageUrl: pageUrl || 'N/A', productName: productName.substring(0, 50) });

  const signals: { source: string; country: string; confidence: 'high' | 'medium' | 'low' }[] = [];

  // SIGNAL 1: userCountry from frontend
  signals.push({ source: 'frontend', country: userCountry, confidence: 'medium' });

  // SIGNAL 2: Domain TLD
  const domainMatch = (pageUrl || '').match(/\.(com\.br|com\.mx|es|fr|de|it|co\.uk|com\.au|ca)($|\/)/);
  if (domainMatch) {
    const tld = domainMatch[1];
    const tldToCountry: Record<string, string> = {
      'com.br': 'BR',
      'com.mx': 'MX',
      'es': 'ES',
      'fr': 'FR',
      'de': 'DE',
      'it': 'IT',
      'co.uk': 'GB',
      'com.au': 'AU',
      'ca': 'CA'
    };
    const domainCountry = tldToCountry[tld];
    if (domainCountry) {
      signals.push({ source: 'domain', country: domainCountry, confidence: 'high' });
      console.log(`✅ [VALIDATE] Domain signal: ${tld} → ${domainCountry}`);
    }
  }

  // SIGNAL 3: Product name language - REMOVED
  // Let Groq handle language detection automatically
  console.log('ℹ️ [VALIDATE] Language detection delegated to Groq');

  console.log('📊 [VALIDATE] All signals:', signals);

  // Count votes by country (weighted by confidence)
  const votes: Record<string, number> = {};
  signals.forEach(signal => {
    const weight = signal.confidence === 'high' ? 2 : 1;
    votes[signal.country] = (votes[signal.country] || 0) + weight;
  });

  console.log('🗳️ [VALIDATE] Votes:', votes);

  // Get winner
  const winner = Object.entries(votes)
    .sort(([_, a], [__, b]) => b - a)[0];

  const correctedCountry = winner[0];

  if (correctedCountry !== userCountry) {
    console.log(`🔄 [VALIDATE] Country corrected: ${userCountry} → ${correctedCountry}`);
    console.log(`📊 [VALIDATE] Confidence: ${winner[1]} votes`);
  } else {
    console.log(`✅ [VALIDATE] Country confirmed: ${userCountry}`);
  }

  return correctedCountry;
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
    ],
    'KR': [
      'Coupang (coupang.com)',
      'Gmarket (gmarket.co.kr)',
      '11번가 (11st.co.kr)',
      'Interpark (interpark.com)'
    ],
    'JP': [
      'Rakuten (rakuten.co.jp)',
      'Amazon Japan (amazon.co.jp)',
      'Mercari (mercari.com)'
    ],
    'CN': [
      'Taobao (taobao.com)',
      'JD.com (jd.com)',
      'Tmall (tmall.com)'
    ],
    'IN': [
      'Amazon India (amazon.in)',
      'Flipkart (flipkart.com)',
      'Myntra (myntra.com)'
    ],
    'RU': [
      'Wildberries (wildberries.ru)',
      'Ozon (ozon.ru)',
      'Yandex Market (market.yandex.ru)'
    ]
  };

  return ecommerceByCountry[countryCode] || [
    `Local ${countryCode} e-commerce sites`,
    'Amazon',
    'eBay',
    'Local retailers'
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
  product_url?: string | null;
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
  _meta?: {
    cached: boolean;
    cacheSize: number;
  };
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
    let aiCategory = rawCategory ? rawCategory.toLowerCase() : '';

    // NORMALIZE COMMON TYPOS
    const typoMap: Record<string, string> = {
      reuseable_zero_waste: 'reusable_zero_waste',
      reuseable: 'reusable',
      sustinable: 'sustainable',
      sustianable: 'sustainable',
      reneweable: 'renewable',
      recylable: 'recyclable',
      recycleable: 'recyclable',
      biodegradeable: 'biodegradable',
      composteable: 'compostable',
      enviroment: 'environment',
      enviorment: 'environment'
    };

    // Apply typo corrections
    for (const [typo, correct] of Object.entries(typoMap)) {
      if (aiCategory.includes(typo)) {
        console.log(`🔧 [CATEGORY] Fixing typo: "${typo}" → "${correct}"`);
        aiCategory = aiCategory.replace(typo, correct);
      }
    }

    console.log(`🏷️ [CATEGORY] Normalized category: "${aiCategory}"`);

    if (aiCategory && categories[aiCategory]) {
      console.log(`🤖 [CATEGORY] AI classified as: ${aiCategory}`);
      return aiCategory;
    }

    console.error(`❌ [CATEGORY] Invalid category after normalization: "${aiCategory}"`);
    console.error(`📋 [CATEGORY] Available categories:`, Object.keys(categories));
    throw new Error(`AI returned invalid category: ${aiCategory}`);
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
    const rawUserCountry = body.userCountry || body.productInfo?.userCountry || 'US';
    console.log('🌍 [COUNTRY] Raw user country:', rawUserCountry);

    const productInfo: ProductInfo = body.productInfo || {
      productName: body.product_name || body.productName,
      pageUrl: body.product_url || body.pageUrl,
      userCountry: rawUserCountry
    };

    productInfo.userCountry = productInfo.userCountry || rawUserCountry;

    // Cross-validate country (não usa Groq, pode ficar aqui)
    const userCountry = validateAndCorrectCountry(
      productInfo.userCountry,
      productInfo.pageUrl,
      productInfo.productName || productInfo.product_name || ''
    );

    productInfo.userCountry = userCountry;
    console.log('🌍 [COUNTRY] Validated country:', userCountry);

    const productName = productInfo.productName || productInfo.product_name;
    if (!productName) {
      return res.status(400).json({ success: false, error: 'productName is required' });
    }

    console.log('📥 [ANALYZE] Request received:', {
      productName: productName,
      pageUrl: productInfo.pageUrl,
      userCountry: userCountry,
      timestamp: new Date().toISOString()
    });

    // ════════════════════════════════════════════════════════════
    // ✅ STEP 1: CHECK CACHE FIRST (ANTES DE QUALQUER GROQ!)
    // ════════════════════════════════════════════════════════════
    console.log('🔍 [CACHE] Checking cache BEFORE any Groq calls...');

    const cachedAnalysis = await getCachedAnalysis(productName, userCountry);

    if (cachedAnalysis) {
      console.log('🚀 [CACHE] HIT! Returning cached result (0 tokens, 0 API calls)');

      // Retorna imediatamente sem chamar Groq
      return res.status(200).json({
        success: true,
        productInfo: {
          productName: productName,
          pageUrl: productInfo.pageUrl || '',
          pageTitle: productInfo.pageTitle || '',
          selectedText: productInfo.selectedText || ''
        },
        category: cachedAnalysis.originalProduct.category,
        originalProduct: cachedAnalysis.originalProduct,
        alternatives: cachedAnalysis.alternatives,
        timestamp: new Date().toISOString(),
        _meta: {
          cached: true,
          tokensUsed: 0,
          tokensSaved: '~2800'
        }
      });
    }

    console.log('📭 [CACHE] MISS - Proceeding with full analysis...');

    // ════════════════════════════════════════════════════════════
    // STEP 2: IDENTIFICAR CATEGORIA (com validação do frontend)
    // ════════════════════════════════════════════════════════════
    const categoryFromFrontend = body.category;
    let category: string;

    if (categoryFromFrontend) {
      console.log('📥 [BACKEND] Category from frontend:', categoryFromFrontend);

      const availableCategories = Object.keys(alternativesConfig.categories);

      if (availableCategories.includes(categoryFromFrontend)) {
        console.log('✅ [BACKEND] Frontend category is valid:', categoryFromFrontend);
        console.log('🔍 [BACKEND] Validating if category matches product...');

        const productLower = productName.toLowerCase();
        const categoryData = alternativesConfig.categories[categoryFromFrontend];

        // Verificar se alguma keyword da categoria aparece no nome do produto
        const hasKeywordMatch = categoryData.keywords.some((keyword: string) => 
          productLower.includes(keyword.toLowerCase())
        );

        // Verificar se alguma exclusion_keyword aparece (indica categoria errada)
        const exclusionKeywords = (categoryData as any).exclusion_keywords || [];
        const hasExclusionMatch = exclusionKeywords.some((keyword: string) =>
          productLower.includes(keyword.toLowerCase())
        );

        if (hasKeywordMatch && !hasExclusionMatch) {
          console.log('✅ [BACKEND] Category validated, using frontend category:', categoryFromFrontend);
          category = categoryFromFrontend;
        } else {
          console.warn('⚠️ [BACKEND] Category does NOT match product, ignoring frontend category');
          console.warn('⚠️ [BACKEND] Product:', productName.substring(0, 50));
          console.warn('⚠️ [BACKEND] Frontend sent:', categoryFromFrontend);
          console.warn('⚠️ [BACKEND] Will use heuristic instead');

          // Usar heurística
          category = await identifyCategory(productInfo);
          console.log('✅ [BACKEND] Heuristic category:', category);
        }
      } else {
        console.warn('⚠️ [BACKEND] Frontend sent invalid category:', categoryFromFrontend);
        category = await identifyCategory(productInfo);
        console.log('✅ [BACKEND] Heuristic category:', category);
      }
    } else {
      // Categoria não enviada pelo frontend
      category = await identifyCategory(productInfo);
    }

    console.log('📂 [CATEGORY] Final category:', category);

    const categories = alternativesConfig.categories;
    const categoryData = categories[category];

    if (!categoryData) {
      return res.status(400).json({ success: false, error: `Category not found: ${category}` });
    }

    // ════════════════════════════════════════════════════════════
    // STEP 3: TRADUZIR E DETECTAR TIPO (só executa se cache miss)
    // ════════════════════════════════════════════════════════════
    console.log('🔍 [SEARCH] Searching sustainable alternatives...');

    const translatedName = await translateProductName(productName);
    const productType = await detectProductType(
      translatedName,
      productInfo.pageTitle || '',
      categoryData.name
    );

    console.log('🏷️ [TYPE] Detected:', {
      productType: productType,
      translatedName: translatedName
    });

    // ════════════════════════════════════════════════════════════
    // STEP 4: BUSCAR PRODUTOS REAIS (não usa Groq)
    // ════════════════════════════════════════════════════════════
    const realProducts = await searchRealProducts(
      productName,
      productType,
      categoryData,
      category,
      userCountry
    );

    console.log(`✅ [SEARCH] Found ${realProducts.length} products`);

    // ════════════════════════════════════════════════════════════
    // STEP 5: ANALISAR COM GROQ (só executa se cache miss)
    // ════════════════════════════════════════════════════════════
    console.log('📡 [GROQ] Analyzing product...');

    const analysis = await analyzeWithGroq(
      productInfo,
      category,
      categoryData,
      productType,
      realProducts,
      userCountry
    );

    if (!analysis) {
      throw new Error('Failed to generate analysis');
    }

    // ════════════════════════════════════════════════════════════
    // STEP 6: SALVAR NO CACHE
    // ════════════════════════════════════════════════════════════
    await setCachedAnalysis(productName, userCountry, analysis);
    console.log('💾 [CACHE] Analysis saved to cache');

    // ════════════════════════════════════════════════════════════
    // STEP 7: RETORNAR RESULTADO
    // ════════════════════════════════════════════════════════════
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
      timestamp: new Date().toISOString(),
      _meta: {
        cached: false,
        tokensUsed: '~2800'
      }
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

  // Construir query otimizada via Groq
  const groqApiKey = process.env.GROQ_API_KEY;
  const groqPrompt = `Generate a short e-commerce search query (max 6 words) to find sustainable/eco-friendly ${productType} in ${userCountry}. Return ONLY the query in the local language, nothing else.`;

  let query = `sustainable ${productType} eco-friendly ${countryNames[userCountry] || userCountry}`;

  if (groqApiKey) {
    try {
      const groq = new Groq({ apiKey: groqApiKey });
      const completion = await groq.chat.completions.create({
        messages: [
          { role: 'system', content: 'You generate concise e-commerce search queries.' },
          { role: 'user', content: groqPrompt }
        ],
        model: config.groq.defaultModel,
        temperature: 0.2,
        max_tokens: 30
      });

      const aiQuery = completion.choices?.[0]?.message?.content?.trim();
      if (aiQuery) {
        query = aiQuery;
      }
    } catch (error) {
      console.log('⚠️ [SEARCH] Groq query generation failed, using fallback query', error);
    }
  } else {
    console.log('⚠️ [SEARCH] No GROQ_API_KEY, using fallback query');
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

    const rawResults = (results.results || []).filter(Boolean);

    const ecommerceDomains = [
      'mercadolivre.com', 'amazon.com', 'amazon.com.br', 'magazineluiza.com',
      'americanas.com', 'shopee.com', 'shopee.com.br', 'walmart.com',
      'target.com', 'ebay.com', 'bestbuy.com', 'coppel.com', 'liverpool.com.mx',
      'aliexpress.com', 'kabum.com', 'submarino.com', 'carrefour', 'allegro',
      'rakuten', 'falabella', 'leroymerlin', 'decathlon'
    ];

    const ecommerceUrlSignals = [
      '/dp/', '/product/', '/products/', '/produto/', '/p/', '/item/', '/listing/',
      '/buy/', '/shop/', '/loja/', '/store/', '/collections/', '/categoria/', '/category/',
      '/tenis', '/sapato', '/calcado', '/calçado'
    ];

    const ecommerceTextSignals = [
      'comprar', 'buy', 'shop', 'loja', 'store', 'carrinho', 'cart', 'frete', 'entrega', 'parcelamento'
    ];

    const sustainKeywords = [
      'sustain', 'eco', 'organic', 'recycle', 'natural', 'fair trade',
      'ethical', 'green', 'bamboo', 'recycled'
    ];

    const validProducts = rawResults.filter(r => {
      const url = (r.url || '').toLowerCase();
      const text = `${r.title || ''} ${r.snippet || ''}`.toLowerCase();

      if (!url) {
        console.log(`🔍 [FILTER] Rejected: (missing url) - Reason: missing URL`);
        return false;
      }

      let host = '';
      try {
        host = new URL(url).host.toLowerCase();
      } catch (_) {
        console.log(`🔍 [FILTER] Rejected: ${url} - Reason: invalid URL`);
        return false;
      }

      const isArticle = [
        '/blog/', '/article/', '/news/', '/guide/', '/review', '/reviews',
        'youtube.', 'wikipedia.', '/best-', '/top-'
      ].some(p => url.includes(p));
      if (isArticle) {
        console.log(`🔍 [FILTER] Rejected: ${url} - Reason: article/guide`);
        return false;
      }

      const matchesEcommerce = ecommerceDomains.some(domain => host.includes(domain));
      const hasUrlSignal = ecommerceUrlSignals.some(p => url.includes(p)) ||
        url.includes('?srsltid=') || /\/[\w-]+-\d+/.test(url);
      const hasPrice = /(r\$|\$|€|£)/.test(text);
      const hasPurchaseKeywords = ecommerceTextSignals.some(keyword => text.includes(keyword));
      const hasSizeInfo = /\b(p|m|g|gg|\d{2})\b/.test(text);
      const isSustainable = sustainKeywords.some(kw => text.includes(kw)) ||
        categoryData.certifications.some(cert => {
          const certText = (cert || '').toLowerCase();
          return certText && text.includes(certText);
        });

      const isEcommerceLike = matchesEcommerce || hasUrlSignal || hasPrice || hasPurchaseKeywords || hasSizeInfo;

      if (!isEcommerceLike) {
        console.log(`🔍 [FILTER] Rejected: ${url} - Reason: not an e-commerce product page`);
        return false;
      }

      if (!isSustainable) {
        console.log(`🔍 [FILTER] Rejected: ${url} - Reason: lacks sustainability keywords`);
        return false;
      }

      return true;
    });

    console.log(`✅ [SEARCH] Filtered: ${validProducts.length}/${results.results.length}`);

    let unique = Array.from(new Map(validProducts.map(p => [p.url, p])).values());

    // Fallback permissivo: se nada passou, pegar até 5 e-commerces usando sinais gerais sem exigir sustentabilidade
    if (unique.length === 0) {
      console.log('⚠️ [SEARCH] No sustainable matches, applying ecommerce-only fallback');
      const ecommerceOnly = rawResults.filter(r => {
        const url = (r.url || '').toLowerCase();
        if (!url) return false;

        try {
          const host = new URL(url).host.toLowerCase();
          const isArticle = [
            '/blog/', '/article/', '/news/', '/guide/', '/review', '/reviews',
            'youtube.', 'wikipedia.', '/best-', '/top-'
          ].some(p => url.includes(p));
          if (isArticle) return false;

          const hasUrlSignal = ecommerceUrlSignals.some(p => url.includes(p)) ||
            url.includes('?srsltid=') || /\/[\w-]+-\d+/.test(url);
          const text = `${r.title || ''} ${r.snippet || ''}`.toLowerCase();
          const hasPrice = /(r\$|\$|€|£)/.test(text);
          const hasPurchaseKeywords = ecommerceTextSignals.some(keyword => text.includes(keyword));
          const hasSizeInfo = /\b(p|m|g|gg|\d{2})\b/.test(text);
          const matchesEcommerce = ecommerceDomains.some(domain => host.includes(domain));

          return matchesEcommerce || hasUrlSignal || hasPrice || hasPurchaseKeywords || hasSizeInfo;
        } catch (_) {
          return false;
        }
      });

      unique = Array.from(new Map(ecommerceOnly.map(p => [p.url, p])).values()).slice(0, 5);
    }

    const limited = unique.slice(0, 10);

    console.log(`✅ [SEARCH] Returning ${limited.length} products after dedupe/limit`);

    return limited.map(r => ({
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

function validateAlternativeUrls(
  alternatives: Alternative[] = [],
  realProducts: Array<{ title: string; url: string; snippet: string }> = []
): Alternative[] {
  const realUrls = new Set(
    realProducts
      .filter((p) => p && typeof p.url === 'string' && p.url.trim().length > 0)
      .map((p) => p.url.trim())
  );

  return alternatives.map((alternative) => {
    const url = alternative?.product_url?.trim();
    const isRealUrl = url ? realUrls.has(url) : false;

    return {
      ...alternative,
      product_url: isRealUrl ? url! : null
    };
  });
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

  const localEcommerce = getLocalEcommerce(userCountry);

  // Build criteria text
  const criteria = Object.entries(categoryData.sustainability_criteria)
    .map(([key, val]) => `${key} (weight ${val.weight}): ${val.guidelines.join('; ')}`)
    .join('\n');

  // Build products list
  const validProducts = (realProducts || [])
    .filter((p) => p && typeof p === 'object' && p.title && p.url)
    .map((p) => ({
      title: p.title || 'Untitled',
      url: p.url || 'N/A',
      snippet: p.snippet || 'No description available'
    }));

  const productsText = validProducts.length > 0
    ? `\n\nREAL PRODUCTS FOUND (${validProducts.length} total):\n${
        validProducts.map((p, i) =>
          `${i + 1}. ${p.title}\n   URL: ${p.url}\n   ${(p.snippet || 'No description available').substring(0, 100)}...\n`
        ).join('\n')
      }`
    : '\n\nNO PRODUCTS FOUND - Suggest well-known sustainable brands in the user\'s country.';

  const prompt = `You are a sustainability expert analyzing products for users worldwide.

═══════════════════════════════════════════════════════════════
USER CONTEXT:
═══════════════════════════════════════════════════════════════
- User Country: ${userCountry}
- Product Name: ${productName}
- Local E-commerce Sites: ${localEcommerce.slice(0, 5).join(', ')}

═══════════════════════════════════════════════════════════════
DYNAMIC LOCALIZATION (CRITICAL):
═══════════════════════════════════════════════════════════════

1. LANGUAGE DETECTION:
   - Analyze the product name: "${productName}"
   - Determine the language automatically
   - Respond in the SAME LANGUAGE as the product name
   - If product name is in Korean, respond in Korean
   - If product name is in German, respond in German
   - If product name is in Spanish, respond in Spanish
   - And so on for ANY language

2. E-COMMERCE SITES:
   - User is in ${userCountry}
   - Suggest products available in these local sites: ${localEcommerce.join(', ')}
   - Provide realistic product URLs from local e-commerce

3. CERTIFICATIONS:
   - Include certifications relevant to ${userCountry}
   - Research what certifications are used in this country

═══════════════════════════════════════════════════════════════
SCORING METHODOLOGY (MANDATORY):
═══════════════════════════════════════════════════════════════

You MUST calculate sustainability_score using weighted average of criteria scores.

STEP 1 - Analyze the product name for material indicators:
Look for keywords that indicate sustainable materials:
- Natural fibers: bamboo, bambu, linen, linho, hemp, cânhamo, cotton, algodão
- Organic: organic, orgânico, orgânica, bio
- Recycled: recycled, reciclado, reciclada, upcycled

If found, the "materials" criterion should score HIGH (75-95).

STEP 2 - Score each criterion (0-100):
For each criterion in the category, evaluate based on:
- Evidence of compliance with guidelines: 70-100
- Sustainable material in product name (for materials criterion): 75-95
- No information available: 50 (neutral, NOT zero)
- Evidence of non-compliance: 0-30

STEP 3 - Calculate weighted score:
Final score = sum of (criterion_score × criterion_weight) for all criteria

STEP 4 - Validate your score:
- Product with sustainable material in name + no negative indicators = minimum 55
- Product with certified sustainable material = minimum 70
- Product with synthetic/conventional materials = maximum 50

CRITICAL: The product name "${productName}" - analyze it for material keywords BEFORE scoring.

═══════════════════════════════════════════════════════════════
EXAMPLES:
═══════════════════════════════════════════════════════════════

Example 1 - Korean product:
Input: "남성용 가을 겨울 패턴 캐주얼 투피스"
Country: KR
Response: {
  "summary": "이 제품은 합성 소재를 사용하여...",
  "weaknesses": ["합성 소재", "환경 인증 없음"],
  "where_to_buy": "Coupang, Gmarket"
}

Example 2 - German product:
Input: "Lässiges zweiteiliges Set für Herren"
Country: DE
Response: {
  "summary": "Dieses Produkt hat eine niedrige...",
  "weaknesses": ["Synthetische Materialien", "Keine Zertifizierungen"],
  "where_to_buy": "Amazon Deutschland, MediaMarkt"
}

Example 3 - Portuguese product:
Input: "Conjunto casual de duas peças"
Country: BR
Response: {
  "summary": "Este produto tem baixo impacto...",
  "weaknesses": ["Materiais sintéticos", "Sem certificações"],
  "where_to_buy": "Mercado Livre, Americanas"
}

═══════════════════════════════════════════════════════════════
IMPORTANT:
═══════════════════════════════════════════════════════════════

- Do NOT ask what language to use
- Do NOT default to English unless product name is in English
- Detect language automatically from product name
- Match the language exactly
- This works for ANY language: Korean, Japanese, Chinese, Arabic, Hindi, etc.

Now analyze this product:
Product: ${productName}
Category: ${categoryData.name}
Country: ${userCountry}
URL: ${productInfo.pageUrl || 'N/A'}

SUSTAINABILITY CRITERIA FOR THIS CATEGORY:
${criteria}

RELEVANT CERTIFICATIONS: ${categoryData.certifications.join(', ')}
${productsText}

═══════════════════════════════════════════════════════════════
CRITICAL URL RULES:
════════════════════════════════════════════════════════════════

- ONLY use URLs from the REAL PRODUCTS FOUND list above
- If suggesting a product not in the list, set product_url to null
- NEVER invent or guess URLs
- NEVER create URLs based on product names
- Invalid example: "mercadolivre.com.br/produto-nome" (WRONG - invented)
- Valid example: Use exact URL from search results or null

═══════════════════════════════════════════════════════════════
CRITICAL VALIDATION RULES:
═══════════════════════════════════════════════════════════════

1. Alternatives MUST be the SAME product type as the original
2. You MUST provide at least 4 sustainable alternatives
3. Each alternative must have sustainability_score >= 70
4. Use REAL products from the search results when available
5. If no real products found, suggest well-known sustainable brands

═══════════════════════════════════════════════════════════════
REQUIRED JSON RESPONSE FORMAT:
═══════════════════════════════════════════════════════════════

{
  "originalProduct": {
    "name": "${productName}",
    "category": "${category}",
    "sustainability_score": <number 0-100>,
    "summary": "<analysis in detected language>",
    "environmental_impact": {
      "carbon_footprint": "<assessment>",
      "water_usage": "<assessment>",
      "recyclability": "<assessment>",
      "toxicity": "<assessment>"
    },
    "strengths": ["<strength in detected language>", "<strength in detected language>"],
    "weaknesses": ["<weakness in detected language>", "<weakness in detected language>"],
    "certifications_found": ["<certifications>"],
    "recommendations": ["<recommendation in detected language>", "<recommendation in detected language>"],
  },
  "alternatives": [
    {
      "name": "<product name in detected language>",
      "description": "<clear description in detected language>",
      "benefits": "<why more sustainable, in detected language>",
      "sustainability_score": <number 70-100>,
      "where_to_buy": "<prefer: ${localEcommerce[0]}, ${localEcommerce[1]}, or ${localEcommerce[2]}>",
      "certifications": ["<relevant certifications>"],
      "product_url": "<URL from local e-commerce if available, else null>"
    }
  ]
}

═══════════════════════════════════════════════════════════════
FINAL REMINDERS:
═══════════════════════════════════════════════════════════════

1. RESPOND ENTIRELY in the detected language from the product name
2. PRIORITIZE LOCAL E-COMMERCE: ${localEcommerce[0]}, ${localEcommerce[1]}
3. PROVIDE 4 ALTERNATIVES MINIMUM
4. RETURN ONLY VALID JSON - NO MARKDOWN, NO COMMENTS

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

    const validatedAlternatives = validateAlternativeUrls(
      result.alternatives || [],
      validProducts
    );

    if (validatedAlternatives) {
      result.alternatives = validatedAlternatives.filter(alt => {
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
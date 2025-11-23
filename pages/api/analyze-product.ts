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
const config = alternativesData as unknown as AlternativesConfig;

// ======= UTILIDADES DE CATEGORIZAÇÃO DINÂMICA =======
function getTextProcessingConfig(): TextProcessingConfig {
  return (
    config.text_processing || {
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
  const categories = config.categories;
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
  const categories = config.categories;
  const penalty =
    config.scoring_config?.validation_thresholds?.exclusion_penalty ?? -999;

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
  const thresholds = config.scoring_config.validation_thresholds;
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

  const categories = config.categories;
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
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      max_tokens: 20
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
  const categories = config.categories;

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
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      max_tokens: 20
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

    const categories = config.categories;
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
      realProducts
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
  const commonTranslations = config.common_translations;
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

// ===== IDENTIFICAR CATEGORIA (REFATORADA - CONFIG-DRIVEN) =====
async function identifyCategory(productInfo: ProductInfo): Promise<string> {
  const name = productInfo.productName || productInfo.product_name || '';
  const desc = productInfo.description || '';
  const title = productInfo.pageTitle || '';
  const url = productInfo.pageUrl || productInfo.product_url || '';

  const translated = await translateProductName(name);
  if (!name && !desc && !title && !url) {
    console.error('❌ [CATEGORY] No product information provided');
    throw new Error(
      'Product information is required. Please provide at least a product name, description, title, or URL.'
    );
  }
  const weights = config.scoring_config.source_weights;

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

  const validProducts = (realProducts || [])
    .filter((p) => p && typeof p === 'object' && p.title && p.url)
    .map((p) => ({
      title: p.title || 'Untitled',
      url: p.url || 'N/A',
      snippet: p.snippet || 'No description available'
    }));

  // Construir lista de produtos
  const productsText = validProducts.length > 0
    ? `\n\nREAL PRODUCTS FOUND (${validProducts.length} total):\n${
        validProducts.map((p, i) =>
          `${i + 1}. ${p.title}\n   URL: ${p.url}\n   ${(p.snippet || 'No description available').substring(0, 100)}...\n`
        ).join('\n')
      }`
    : '\n\nNO PRODUCTS FOUND - Suggest well-known sustainable brands.';

  const prompt = `You are a sustainability expert analyzing products.

PRODUCT INFORMATION:
- Name: ${productName}
- Type: ${productType}
- Category: ${categoryData.name}
- Web Search Results: ${JSON.stringify(validProducts || [])}

🚨 CRITICAL VALIDATION RULE:
**Alternatives MUST serve THE SAME PRIMARY PURPOSE as the original product.**

VALIDATION EXAMPLES:
✅ CORRECT:
- Adobe Photoshop → GIMP, Affinity Photo, Photopea (all are photo editing)
- Nike Sneakers → Veja, Allbirds, Adidas Parley (all are sneakers)
- Pantene Shampoo → Lush, Ethique bars, Organic Shop (all are hair care)

❌ INCORRECT:
- Adobe Photoshop → AWS, Azure, Google Cloud (different purposes)
- Nike Sneakers → Patagonia Jackets, Organic Cotton T-shirts (different items)
- iPhone → Samsung Galaxy Buds, Apple Watch (different devices)

SCORING GUIDELINES (be fair, not overly harsh):
- 70-100: Excellent sustainability (certified B-Corp, carbon neutral, circular economy)
- 50-69: Good sustainability (some certifications, transparent supply chain)
- 30-49: Average sustainability (basic eco claims, minimal transparency)
- 10-29: Poor sustainability (greenwashing, no certifications)
- 0-9: Very poor sustainability (known environmental violations)

IMPORTANT: A score of 30-35 should be reserved for products with MINIMAL sustainability effort.
If a major brand has at least some recycling program or basic certifications, score should be 40-55.

SUSTAINABILITY CRITERIA:
${criteria}

CERTIFICATIONS: ${categoryData.certifications.join(', ')}
${productsText}

RETURN JSON:
{
  "originalProduct": {
    "name": "${productName}",
    "category": "${category}",
    "sustainability_score": 40-55,
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
      const typeLower = (productType || '').toLowerCase();
      
      // ✅ Usar REGEX com word boundaries ao invés de includes()
      const incompatibleTypes = config.incompatible_types;
      const wrongTypes: Record<string, string[]> = incompatibleTypes || {
        'heels': ['sneaker', 'boot', 'sandal', 'flat', 'loafer'],
        'sneakers': ['heel', 'boot', 'sandal', 'dress shoe', 'pump'],
        'boots': ['heel', 'sneaker', 'sandal', 'flat', 'pump']
      };
      
      result.alternatives = result.alternatives.filter(alt => {
        if (!alt || !alt.name) {
          console.log('❌ [VALIDATION] Rejected (missing name)');
          return false;
        }

        const altName = (alt.name || '').toLowerCase();
        
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
        
        // ✅ Rejeitar tipo diferente usando REGEX gerado dinamicamente
        const wrongList = wrongTypes[typeLower] || [];
        const wrongTypePatterns = wrongList.map(t => new RegExp(`\\b${t}s?\\b`, 'i'));
        
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

export { identifyCategory };
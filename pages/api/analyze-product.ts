// pages/api/analyze-product.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import Groq from 'groq-sdk';
import { Redis } from '@upstash/redis';
import alternativesData from '../../data/alternatives.json';
import config from '../../config';
import webSearchClient from '../../services/web-search-client';
import { AlternativesConfig, CategoryConfig } from '../../types';
import { calculateSustainabilityScore, ProductFacts } from '../../services/scoring-engine';
import { extractProductFacts, generateDescriptiveTexts } from '../../services/fact-extractor';

interface AnalysisRequest {
  productInfo?: Record<string, any>;
  product_name?: string;
  productName?: string;
  product_url?: string;
  pageUrl?: string;
  pageTitle?: string;
  description?: string;
  userCountry?: string;
  userLanguage?: string;
  category?: string;
}

interface ProductInfo {
  productName?: string;
  product_name?: string;
  pageTitle?: string;
  description?: string;
  pageUrl?: string;
  selectedText?: string;
  userCountry?: string;
  category?: string;
  [key: string]: any;
}

const alternativesConfig = alternativesData as AlternativesConfig;

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 horas

function getCacheKey(productName: string, userCountry: string, categoryKey: string): string {
  const normalized = productName.toLowerCase().trim().replace(/\s+/g, ' ');
  const normalizedCategory = (categoryKey || 'auto').toLowerCase();
  return `sicosi:${normalized}:${normalizedCategory}:${userCountry}`;
}

async function getCachedAnalysis(
  productName: string,
  userCountry: string,
  categoryKey: string,
  userLanguage: string,
  groqClient: Groq,
) {
  try {
    const key = getCacheKey(productName, userCountry, categoryKey);
    const cached = await redis.get<any>(key);

    if (cached) {
      console.log(`✅ [CACHE] Redis HIT: ${key.substring(0, 50)}`);
      const translations = await generateTranslations(userLanguage || 'en', groqClient);
      return { ...cached, translations };
    }

    console.log(`📭 [CACHE] Redis MISS: ${key.substring(0, 50)}`);
    return null;
  } catch (error) {
    console.error('❌ [CACHE] Redis error:', error);
    return null;
  }
}

async function generateTranslations(
  language: string,
  groqClient: Groq,
): Promise<Record<string, string>> {
  const prompt = `You are a translation assistant. Translate the following UI labels to ${language}.

LABELS TO TRANSLATE:
- alternatives
- viewProduct
- searchGoogle
- buyAnyway
- toast (congratulations message for sustainable product)
- close
- sustainabilityScoreTitle
- strengthsTitle
- weaknessesTitle
- recommendationsTitle
- benefitsLabel
- certificationsLabel
- whereToBuyLabel
- noAlternatives
- noSummary
- alternativeFallback
- purchaseAllowed
- offlineAnalysisWarning

REQUIRED JSON RESPONSE FORMAT:
{
  "alternatives": "translated text",
  "viewProduct": "translated text",
  "searchGoogle": "translated text",
  "buyAnyway": "translated text",
  "toast": "🎉 translated congratulations message",
  "close": "translated text",
  "sustainabilityScoreTitle": "translated text",
  "strengthsTitle": "translated text",
  "weaknessesTitle": "translated text",
  "recommendationsTitle": "translated text",
  "benefitsLabel": "translated text",
  "certificationsLabel": "translated text",
  "whereToBuyLabel": "translated text",
  "noAlternatives": "translated text",
  "noSummary": "translated text",
  "alternativeFallback": "translated text",
  "purchaseAllowed": "translated text",
  "offlineAnalysisWarning": "translated text"
}

IMPORTANT: Return ONLY valid JSON. Use the target language for all translations.`;

  try {
    const completion = await groqClient.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from Groq');
    }

    return JSON.parse(content);
  } catch (error) {
    console.error('❌ [TRANSLATIONS] Error generating translations:', error);
    return {
      alternatives: 'Sustainable Alternatives',
      viewProduct: 'View Product',
      searchGoogle: 'Search on Google',
      buyAnyway: 'Buy anyway',
      toast: '🎉 Congratulations! This product is sustainable!',
      close: 'Close',
      sustainabilityScoreTitle: 'Sustainability Score',
      strengthsTitle: 'Strengths',
      weaknessesTitle: 'Weaknesses',
      recommendationsTitle: 'Recommendations',
      benefitsLabel: 'Benefits:',
      certificationsLabel: 'Certifications:',
      whereToBuyLabel: 'Where to buy:',
      noAlternatives: 'No alternatives available',
      noSummary: 'Summary not available',
      alternativeFallback: 'Alternative',
      purchaseAllowed: 'Purchase allowed',
      offlineAnalysisWarning: 'Offline analysis - limited data',
    };
  }
}

async function setCachedAnalysis(
  productName: string,
  userCountry: string,
  categoryKey: string,
  result: any,
): Promise<void> {
  try {
    const key = getCacheKey(productName, userCountry, categoryKey);
    await redis.set(key, result, { ex: CACHE_TTL_SECONDS });
    console.log(`💾 [CACHE] Redis SAVED: ${key.substring(0, 50)} (TTL: 24h)`);
  } catch (error) {
    console.error('❌ [CACHE] Redis save error:', error);
  }
}

function getTextProcessingConfig() {
  return (
    (alternativesConfig as any).text_processing || {
      remove_accents: true,
      lowercase: true,
      remove_punctuation: true,
      word_boundary_matching: true,
    }
  );
}

function getWebSearchConfig() {
  return (alternativesConfig as any)['Web Search_config'] || {};
}

function getArticlePatterns(): string[] {
  return (
    getWebSearchConfig().article_url_patterns || [
      '/blog/',
      '/article/',
      '/news/',
      '/guide/',
      '/review',
      '/reviews',
      'youtube.',
      'wikipedia.',
      '/best-',
      '/top-',
    ]
  );
}

function containsAny(text: string, patterns: string[]): boolean {
  const haystack = (text || '').toLowerCase();
  return patterns.some((pattern) => haystack.includes((pattern || '').toLowerCase()));
}

function isArticleUrl(url: string, articlePatterns: string[]): boolean {
  const normalizedUrl = (url || '').toLowerCase();
  return articlePatterns.some((pattern) => normalizedUrl.includes((pattern || '').toLowerCase()));
}

function isEcommerceResult(
  url: string,
  title: string,
  snippet: string,
  domains: string[],
  urlSignals: string[],
  textSignals: string[],
): boolean {
  const normalizedUrl = (url || '').toLowerCase();
  const normalizedText = `${title || ''} ${snippet || ''}`.toLowerCase();

  const matchesDomain = domains.some((domain) => normalizedUrl.includes((domain || '').toLowerCase()));
  const matchesUrlSignal = urlSignals.some((signal) => normalizedUrl.includes((signal || '').toLowerCase()));
  const matchesTextSignal = textSignals.some((signal) => normalizedText.includes((signal || '').toLowerCase()));

  return matchesDomain || matchesUrlSignal || matchesTextSignal;
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

function expandKeywordWithSynonyms(keyword: string, synonymsMap: Record<string, string[]> = {}): string[] {
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

function calculateCategoryScores(sources: { text: string; weight: number }[]): Array<{
  category: string;
  score: number;
  matches: string[];
}> {
  const categories = alternativesConfig.categories;
  const results: Array<{ category: string; score: number; matches: string[] }> = [];

  for (const [categoryKey, categoryData] of Object.entries(categories)) {
    let totalScore = 0;
    const matches: string[] = [];

    for (const source of sources) {
      if (!source.text || source.weight === 0) continue;

      const normalizedText = normalizeCategoryText(source.text);

      for (const keyword of categoryData.keywords) {
        const allVariants = expandKeywordWithSynonyms(
          keyword,
          (categoryData as CategoryConfig).keyword_synonyms,
        );

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
    });
  }

  return results;
}

function applyExclusionRules(scores: Array<{ category: string; score: number; matches: string[] }>, primaryText: string) {
  const normalizedPrimary = normalizeCategoryText(primaryText);
  const categories = alternativesConfig.categories;
  const penalty =
    alternativesConfig.scoring_config?.validation_thresholds?.exclusion_penalty ?? -999;

  return scores.map((scoreData) => {
    const categoryData = categories[scoreData.category] as CategoryConfig;
    const exclusionKeywords = categoryData.exclusion_keywords || [];
    const exclusionsFound: string[] = [];

    for (const exclusionKw of exclusionKeywords) {
      const allVariants = expandKeywordWithSynonyms(
        exclusionKw,
        categoryData.keyword_synonyms,
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
        exclusions: exclusionsFound,
      };
    }

    return { ...scoreData, exclusions: [] as string[] };
  });
}

function selectWinner(scores: Array<{ category: string; score: number; exclusions: string[] }>) {
  const thresholds = alternativesConfig.scoring_config?.validation_thresholds || {
    minimum_score: 1,
    confidence_ratio: 1.5,
  };
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const first = sorted[0];
  const second = sorted[1];

  if (!first || first.score < thresholds.minimum_score) {
    return null;
  }

  const ratio = second && second.score > 0 ? first.score / second.score : Infinity;

  if (first.exclusions.length > 0) {
    return null;
  }

  return { ...first, confidence: ratio >= thresholds.confidence_ratio ? 'medium' : 'low' };
}

function keywordFallbackCategory(
  productName: string,
  context: string,
  categories: Record<string, CategoryConfig>,
): string {
  const searchText = `${productName} ${context}`.toLowerCase();

  let bestMatch: { category: string; score: number } = { category: '', score: 0 };

  for (const [categoryKey, categoryData] of Object.entries(categories)) {
    const keywords = categoryData.keywords || [];
    const productTypes = categoryData.product_types || [];
    const allKeywords = [...keywords, ...productTypes];

    let matchScore = 0;

    for (const keyword of allKeywords) {
      if (searchText.includes((keyword || '').toLowerCase())) {
        matchScore += 1;
      }
    }

    const exclusionKeywords = categoryData.exclusion_keywords || [];
    for (const exclusion of exclusionKeywords) {
      if (searchText.includes((exclusion || '').toLowerCase())) {
        matchScore = 0;
        break;
      }
    }

    if (matchScore > bestMatch.score) {
      bestMatch = { category: categoryKey, score: matchScore };
    }
  }

  if (bestMatch.score > 0) {
    return bestMatch.category;
  }

  const firstCategory = Object.keys(categories)[0] || 'electronics';
  console.warn(`[SICOSI] No keyword match for "${productName}", using fallback: ${firstCategory}`);
  return firstCategory;
}

function categorizeProduct(name: string, context: string): string | null {
  const webSearchConfig = getWebSearchConfig();
  const genericNames =
    webSearchConfig.generic_product_names || ['product', 'item', 'thing', 'test', 'xyz', 'abc'];

  const nameLower = (name || '').toLowerCase().trim();
  const text = `${name} ${context}`.toLowerCase();

  if (genericNames.includes(nameLower)) {
    console.warn('⚠️ [HEURISTIC] Generic product name detected, skipping heuristic categorization');
    return null;
  }

  console.log('🔍 [HEURISTIC] Text to analyze:', text.substring(0, 150));

  const scores = calculateCategoryScores([
    { text: name || '', weight: 3 },
    { text: context || '', weight: 1 },
  ]);

  const scoresWithExclusions = applyExclusionRules(scores, name || '');
  const winner = selectWinner(scoresWithExclusions);

  if (winner) {
    console.log('🔍 [HEURISTIC] Match found:', winner.category);
    return winner.category;
  }

  console.log('🔍 [HEURISTIC] No match found');
  return null;
}

export async function identifyCategory(
  productInfo: ProductInfo,
  categoryFromFrontend?: string | null,
): Promise<string> {
  const name = productInfo.productName || productInfo.product_name || '';
  const description = productInfo.description || '';
  const pageTitle = productInfo.pageTitle || '';
  const availableCategories = alternativesConfig.categories || {};

  console.log('🔍 [CATEGORY] Starting identification...');
  console.log('  - Product:', name.substring(0, 50));
  console.log('  - Frontend category:', categoryFromFrontend || 'none');

  if (categoryFromFrontend) {
    const validCategories = Object.keys(availableCategories);

    if (validCategories.includes(categoryFromFrontend)) {
      console.log('✅ [BACKEND] Frontend category is valid:', categoryFromFrontend);
      console.log('🔍 [BACKEND] Will verify with own analysis...');

      const contextForHeuristic = `${pageTitle} ${description}`;

      try {
        const heuristicCategory = categorizeProduct(name, contextForHeuristic);

        if (heuristicCategory && heuristicCategory !== categoryFromFrontend) {
          console.warn('⚠️ [BACKEND] Category mismatch!');
          console.warn(`  Frontend: ${categoryFromFrontend}`);
          console.warn(`  Backend:  ${heuristicCategory}`);
          console.log('✅ [BACKEND] Using backend analysis (more reliable)');
          return heuristicCategory;
        } else if (heuristicCategory === categoryFromFrontend) {
          console.log('✅ [BACKEND] Frontend and backend agree:', categoryFromFrontend);
          return categoryFromFrontend;
        }
      } catch (error) {
        console.log('ℹ️ [BACKEND] Heuristic inconclusive, trusting frontend');
        return categoryFromFrontend;
      }

      return categoryFromFrontend;
    }

    console.warn('⚠️ [BACKEND] Invalid category from frontend:', categoryFromFrontend);
    console.log('🔍 [BACKEND] Will auto-detect...');
  }

  console.log('🔍 [BACKEND] Auto-detecting category...');
  console.log('🔍 [CATEGORY] Trying heuristic identification...');
  const heuristicCategory = categorizeProduct(name, `${pageTitle} ${description}`);

  console.log('🔍 [HEURISTIC] Analyzing:', {
    name: name.substring(0, 50),
    context: `${pageTitle} ${description}`.substring(0, 100),
    result: heuristicCategory,
  });

  if (heuristicCategory) {
    if (!availableCategories[heuristicCategory]) {
      console.error('❌ [CATEGORY] Heuristic returned invalid:', heuristicCategory);
    } else {
      console.log('✅ [CATEGORY] Heuristic match:', heuristicCategory);
      return heuristicCategory;
    }
  }

  console.log('🤖 [CATEGORY] Heuristic inconclusive, using AI...');
  const aiCategory = keywordFallbackCategory(name, `${pageTitle} ${description}`, availableCategories);
  console.log('✅ [CATEGORY] AI selected:', aiCategory);

  return aiCategory;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    return res.status(500).json({ success: false, error: 'GROQ_API_KEY not configured' });
  }

  const groqClient = new Groq({ apiKey: groqApiKey });

  const body = (req.body || {}) as AnalysisRequest;
  const rawProductInfo = (body.productInfo || {}) as ProductInfo;
  const productName = body.productName || body.product_name || rawProductInfo.productName || rawProductInfo.product_name;
  const productInfo: ProductInfo = {
    ...rawProductInfo,
    productName: rawProductInfo.productName || rawProductInfo.product_name || productName,
    product_name: rawProductInfo.product_name || rawProductInfo.productName || productName,
  };
  const pageTitle = productInfo.pageTitle || body.pageTitle || '';
  const description = productInfo.description || body.description || '';
  const userCountry = (body.userCountry || productInfo.userCountry || 'US').toUpperCase();
  const userLanguage = body.userLanguage || productInfo.userLanguage || 'pt-BR';
  const categoryFromFrontend = body.category || null;

  if (categoryFromFrontend) {
    console.log('📥 [BACKEND] Category from frontend:', categoryFromFrontend);
  } else {
    console.log('📥 [BACKEND] No category from frontend, will auto-detect');
  }

  console.log('📥 [REQUEST] Full body:', JSON.stringify(body, null, 2));

  if (!productName || typeof productName !== 'string') {
    return res.status(400).json({ success: false, error: 'Product name is required' });
  }

  const availableCategories = Object.keys(alternativesConfig.categories || {});
  const webSearchConfig = getWebSearchConfig();
  const articlePatterns = getArticlePatterns();
  const ecommerceDomains = webSearchConfig.ecommerce_domains || [];
  const ecommerceUrlSignals = webSearchConfig.ecommerce_url_signals || [];
  const ecommerceTextSignals = webSearchConfig.ecommerce_text_signals || [];
  const sustainKeywords = webSearchConfig.sustainability_keywords || [];
  let category: string | undefined;

  try {
    const cacheKeyCategory =
      categoryFromFrontend && availableCategories.includes(categoryFromFrontend)
        ? categoryFromFrontend
        : 'auto';
    const cached = await getCachedAnalysis(
      productName,
      userCountry,
      cacheKeyCategory,
      userLanguage,
      groqClient,
    );
    if (cached) {
      return res.status(200).json({ ...cached, _meta: { cached: true } });
    }

    // ════════════════════════════════════════════════════════════
    // STEP 2: DETERMINAR CATEGORIA (priorizar frontend)
    // ════════════════════════════════════════════════════════════
    category = await identifyCategory(productInfo, categoryFromFrontend);

    if (!category || !alternativesConfig.categories?.[category]) {
      console.warn(`⚠️ [CATEGORY] "${category}" not found, using fallback`);
      category = availableCategories[0] || 'electronics';
    }

    console.log(`📂 [CATEGORY] Final category: ${category}`);

    // ════════════════════════════════════════════════════════════
    // STEP 3: BUSCAR CONTEXTO WEB (Tavily)
    // ════════════════════════════════════════════════════════════
    console.log('🔍 [SEARCH] Searching web context for product...');

    const searchQuery = `${productName} sustainability review certifications materials`;
    const searchResults = await webSearchClient.search(searchQuery, {
      maxResults: 5,
      includeAnswer: false,
      searchDepth: 'basic',
    });

    const filteredSearchResults = (searchResults.results || []).filter((r: any) => {
      const url = r.url || '';
      const title = r.title || '';
      const snippet = (r.content || r.snippet || '') as string;
      const article = isArticleUrl(url, articlePatterns);
      const ecommerce = isEcommerceResult(
        url,
        title,
        snippet,
        ecommerceDomains,
        ecommerceUrlSignals,
        ecommerceTextSignals,
      );
      const hasSustainabilitySignal = containsAny(`${title} ${snippet}`, sustainKeywords);

      if (article) return false;
      if (ecommerce && !hasSustainabilitySignal) return false;

      return true;
    });

    const contextualResults = filteredSearchResults.length
      ? filteredSearchResults
      : searchResults.results || [];

    const searchContext = contextualResults
      .map((r: any) => `${r.title}\n${r.content || r.snippet || ''}`)
      .join('\n\n');

    const searchCount = searchResults.results?.length ?? 0;
    console.log(`📄 [SEARCH] Found ${searchCount} results`);

    if (!category || !alternativesConfig.categories?.[category]) {
      console.warn(`⚠️ [CATEGORY] "${category}" not found, using first available`);
      category = availableCategories[0] || 'electronics';
    }

    console.log(`✅ [CATEGORY] Final category: ${category}`);

    // ════════════════════════════════════════════════════════════
    // STEP 4: EXTRAIR FATOS COM LLM (Groq)
    // ════════════════════════════════════════════════════════════
    console.log('🤖 [EXTRACT] Extracting product facts with LLM...');

    const facts: ProductFacts = await extractProductFacts(productName, category, searchContext);

    console.log('✅ [EXTRACT] Facts extracted:', Object.keys(facts));

    // ════════════════════════════════════════════════════════════
    // STEP 5: CALCULAR SCORE DETERMINISTICAMENTE (TypeScript)
    // ════════════════════════════════════════════════════════════
    console.log('🧮 [SCORE] Calculating sustainability score...');

    const scoreResult = calculateSustainabilityScore(
      facts,
      category,
      alternativesConfig.categories,
    );

    console.log(`📊 [SCORE] Final score: ${scoreResult.finalScore}/100 (${scoreResult.classification})`);
    console.log('📊 [SCORE] Breakdown:', scoreResult.breakdown);

    // ════════════════════════════════════════════════════════════
    // STEP 6: GERAR TEXTOS DESCRITIVOS COM LLM (Groq)
    // ════════════════════════════════════════════════════════════
    console.log('📝 [TEXT] Generating descriptive texts...');

    const texts = await generateDescriptiveTexts(
      productName,
      category,
      scoreResult.finalScore,
      scoreResult.breakdown,
      facts,
      userLanguage,
      userCountry,
    );

    console.log('✅ [TEXT] Texts generated');

    // ════════════════════════════════════════════════════════════
    // STEP 7: BUSCAR ALTERNATIVAS (se score < 70)
    // ════════════════════════════════════════════════════════════
    let alternatives: any[] = [];

    if (scoreResult.finalScore < config.sustainability.minScore) {
      console.log('🔍 [ALTERNATIVES] Score below threshold, searching alternatives...');

      const altSearchQuery = `sustainable ${category} alternatives ${productName}`;
      const altSearchResults = await webSearchClient.search(altSearchQuery, {
        maxResults: 10,
        includeAnswer: false,
        searchDepth: 'basic',
      });

      const filteredAltResults = (altSearchResults.results || []).filter((r: any) => {
        const url = r.url || '';
        const title = r.title || '';
        const snippet = (r.content || r.snippet || '') as string;
        const article = isArticleUrl(url, articlePatterns);
        const ecommerce = isEcommerceResult(
          url,
          title,
          snippet,
          ecommerceDomains,
          ecommerceUrlSignals,
          ecommerceTextSignals,
        );
        const hasSustainabilitySignal = containsAny(`${title} ${snippet}`, sustainKeywords);

        if (article) return false;
        if (ecommerce && !hasSustainabilitySignal) return false;

        return true;
      });

      const altResultsForPrompt = filteredAltResults.length
        ? filteredAltResults
        : altSearchResults.results || [];

      if (altResultsForPrompt.length) {
        const prompt = `You are a sustainable purchasing assistant analyzing a product with sustainability score ${scoreResult.finalScore}/100.

REAL PRODUCTS FOUND (from web search):
${altResultsForPrompt
  .map(
    (r: any, i: number) => `${i + 1}. ${r.title}\nURL: ${r.url}\nSnippet: ${(r.snippet || '').substring(0, 180)}`,
  )
  .join('\n\n')}

YOUR TASK:
The original product scored ${scoreResult.finalScore}/100 (below the 70 threshold).
You MUST suggest exactly 4 sustainable alternatives from the REAL PRODUCTS FOUND list above.

REQUIREMENTS:
1. Use ONLY products from the REAL PRODUCTS FOUND list
2. Use the exact URLs from the search results
3. Each alternative should have estimated sustainability_score >= 70
4. Respond in the same language as the product name: "${productName}"
5. If a product from the list doesn't have a direct URL, set product_url to null
6. You MUST return exactly 4 alternatives (or as many as available from the list, minimum 1)

REQUIRED JSON RESPONSE FORMAT:
{
  "alternatives": [
    {
      "name": "Product name from search results",
      "description": "Why this is a sustainable alternative",
      "benefits": "Key sustainability benefits",
      "sustainability_score": 75,
      "where_to_buy": "Store name or region",
      "certifications": ["cert1", "cert2"],
      "product_url": "exact URL from search results or null"
    }
  ]
}

IMPORTANT: Return a JSON object with "alternatives" array, NOT a plain array.`;

        const completion = await groqClient.chat.completions.create({
          messages: [{ role: 'user', content: prompt }],
          model: 'llama-3.3-70b-versatile',
          temperature: 0.2,
          response_format: { type: 'json_object' },
        });

        const parsedAlternatives = JSON.parse(completion.choices[0].message.content || '{}');
        const parsedArray = (parsedAlternatives as any)?.alternatives;
        alternatives = Array.isArray(parsedArray) ? parsedArray : [];
      }

      console.log(`✅ [ALTERNATIVES] Found ${alternatives.length} alternatives`);
    }

    // ════════════════════════════════════════════════════════════
    // STEP 8: MONTAR RESPOSTA FINAL
    // ════════════════════════════════════════════════════════════
    const validatedAlternatives = alternatives;

    const translations = await generateTranslations(userLanguage || 'en', groqClient);

    const responsePayload = {
      success: true,
      analysis: {
        sustainability_score: scoreResult.finalScore,
        category,
        summary: texts.summary,
        strengths: texts.strengths,
        weaknesses: texts.weaknesses,
        recommendations: texts.recommendations,
        breakdown: scoreResult.breakdown,
        classification: scoreResult.classification,
      },
      score: scoreResult.finalScore,
      breakdown: scoreResult.breakdown,
      classification: scoreResult.classification,
      summary: texts.summary,
      strengths: texts.strengths,
      weaknesses: texts.weaknesses,
      recommendations: texts.recommendations,
      productInfo: {
        productName,
        pageUrl: productInfo.pageUrl || '',
        pageTitle: productInfo.pageTitle || '',
        selectedText: productInfo.selectedText || '',
      },
      category,
      originalProduct: {
        name: productName,
        category,
        sustainability_score: scoreResult.finalScore,
        breakdown: scoreResult.breakdown,
        classification: scoreResult.classification,
        summary: texts.summary,
        strengths: texts.strengths,
        weaknesses: texts.weaknesses,
        recommendations: texts.recommendations,
      },
      alternatives: validatedAlternatives,
      translations,
      _meta: {
        cached: cached || false,
      },
      timestamp: new Date().toISOString(),
    };

    await setCachedAnalysis(productName, userCountry, category, responsePayload);

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error('❌ [ERROR]:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
      debug: {
        productName,
        categoryFromFrontend: categoryFromFrontend || 'not provided',
        categoryUsed: category || 'undefined',
        availableCategories,
      },
    });
  }
}
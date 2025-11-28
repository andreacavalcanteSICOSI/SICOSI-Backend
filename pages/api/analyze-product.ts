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

async function getCachedAnalysis(productName: string, userCountry: string, categoryKey: string) {
  try {
    const key = getCacheKey(productName, userCountry, categoryKey);
    const cached = await redis.get<any>(key);

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
  const thresholds = alternativesConfig.scoring_config.validation_thresholds;
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

export function identifyCategory(
  productName: string,
  pageTitle: string,
  description: string,
  categories: Record<string, CategoryConfig>,
): string {
  const searchText = `${productName} ${pageTitle} ${description}`.toLowerCase();

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

  const body = req.body || {};
  const productInfo = body.productInfo || {};
  const productName = body.productName || body.product_name || productInfo.productName || productInfo.product_name;
  const pageTitle = productInfo.pageTitle || body.pageTitle || '';
  const description = productInfo.description || body.description || '';
  const userCountry = (body.userCountry || productInfo.userCountry || 'US').toUpperCase();
  const categoryFromFrontend = body.category || productInfo.category;

  if (!productName || typeof productName !== 'string') {
    return res.status(400).json({ success: false, error: 'Product name is required' });
  }

  const availableCategories = Object.keys(alternativesConfig.categories || {});
  let category: string | undefined;

  try {
    const cacheKeyCategory =
      categoryFromFrontend && availableCategories.includes(categoryFromFrontend)
        ? categoryFromFrontend
        : 'auto';
    const cached = await getCachedAnalysis(productName, userCountry, cacheKeyCategory);
    if (cached) {
      return res.status(200).json({ ...cached, _meta: { cached: true } });
    }

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

    const searchContext = (searchResults.results || [])
      .map((r: any) => `${r.title}\n${r.content || r.snippet || ''}`)
      .join('\n\n');

    const searchCount = searchResults.results?.length ?? 0;
    console.log(`📄 [SEARCH] Found ${searchCount} results`);

    if (categoryFromFrontend && availableCategories.includes(categoryFromFrontend)) {
      console.log(`📂 [CATEGORY] Using category from frontend: ${categoryFromFrontend}`);
      category = categoryFromFrontend;
    } else {
      console.log('🔍 [CATEGORY] No valid category from frontend, auto-identifying...');
      category = identifyCategory(productName, pageTitle, description, alternativesConfig.categories);
      console.log(`📂 [CATEGORY] Auto-identified: ${category}`);
    }

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

      if (altSearchResults.results?.length) {
        const prompt = `You are a sustainable purchasing assistant. Suggest up to 3 alternatives for the product using ONLY the real search results below.

REAL PRODUCTS FOUND:
${altSearchResults.results
  .map(
    (r: any, i: number) => `${i + 1}. ${r.title}\nURL: ${r.url}\nSnippet: ${(r.snippet || '').substring(0, 180)}`,
  )
  .join('\n\n')}

IMPORTANT:
- Suggest ONLY products that appear in the REAL PRODUCTS FOUND list above
- Use the exact URLs from the search results
- If no suitable alternatives found, return empty array

Return JSON with this structure:
[
  {
    "name": "Product name",
    "description": "Why this is a sustainable alternative (PT-BR)",
    "benefits": "Key sustainability benefits (PT-BR)",
    "sustainability_score": 0,
    "where_to_buy": "URL",
    "certifications": ["cert1", "cert2"],
    "product_url": "URL"
  }
]`;

        const completion = await groqClient.chat.completions.create({
          messages: [{ role: 'user', content: prompt }],
          model: 'llama-3.3-70b-versatile',
          temperature: 0.2,
          response_format: { type: 'json_object' },
        });

        const parsedAlternatives = JSON.parse(completion.choices[0].message.content || '[]');
        alternatives = Array.isArray(parsedAlternatives) ? parsedAlternatives : [];
      }

      console.log(`✅ [ALTERNATIVES] Found ${alternatives.length} alternatives`);
    }

    // ════════════════════════════════════════════════════════════
    // STEP 8: MONTAR RESPOSTA FINAL
    // ════════════════════════════════════════════════════════════
    const responsePayload = {
      success: true,
      score: scoreResult.finalScore,
      breakdown: scoreResult.breakdown,
      classification: scoreResult.classification,
      summary: texts.summary,
      strengths: texts.strengths,
      weaknesses: texts.weaknesses,
      recommendations: texts.recommendations,
      alternatives,
      category,
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

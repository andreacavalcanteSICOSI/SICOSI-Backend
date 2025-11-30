// pages/api/analyze-product.ts

import type { NextApiRequest, NextApiResponse } from "next";
import Groq from "groq-sdk";
import alternativesData from "../../data/alternatives.json";
import config from "../../config";
import webSearchClient from "../../services/web-search-client";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 horas

function getCacheKey(productName: string, userCountry: string): string {
  const normalized = productName.toLowerCase().trim().replace(/\s+/g, " ");
  return `sicosi:${normalized}:${userCountry}`;
}

async function getCachedAnalysis(
  productName: string,
  userCountry: string
): Promise<GroqAnalysisResult | null> {
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
    console.error("❌ [CACHE] Redis error:", error);
    return null;
  }
}

async function setCachedAnalysis(
  productName: string,
  userCountry: string,
  result: GroqAnalysisResult
): Promise<void> {
  try {
    const key = getCacheKey(productName, userCountry);
    await redis.set(key, result, { ex: CACHE_TTL_SECONDS });
    console.log(`💾 [CACHE] Redis SAVED: ${key.substring(0, 50)} (TTL: 24h)`);
  } catch (error) {
    console.error("❌ [CACHE] Redis save error:", error);
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

/**
 * Get localized congratulations message for sustainable products using Groq
 * @param {string} productName - Product name to detect language
 * @returns {Promise<string>} - Localized message
 */
async function getSustainableProductMessage(productName: string): Promise<string> {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    // Fallback if no API key
    return "Congratulations! You've already chosen a sustainable product! 🌱";
  }

  try {
    const groq = new Groq({ apiKey: groqApiKey });
    
    const prompt = `Detect the language of this product name and generate a congratulations message in that EXACT language:

Product name: "${productName}"

Generate a short, friendly congratulations message saying the user has already chosen a sustainable product. Include the 🌱 emoji at the end.

CRITICAL RULES:
1. Detect the language from the product name automatically
2. Respond in the SAME language as the product name
3. Keep it short (one sentence, max 15 words)
4. Be enthusiastic and positive
5. Include 🌱 emoji at the end
6. Return ONLY the message, nothing else

Examples:
- If product is in Portuguese: "Parabéns! Você já escolheu um produto sustentável! 🌱"
- If product is in Japanese: "おめでとうございます！すでに持続可能な製品を選択しています！🌱"
- If product is in German: "Glückwunsch! Sie haben bereits ein nachhaltiges Produkt gewählt! 🌱"
- If product is in Spanish: "¡Felicitaciones! ¡Ya elegiste un producto sostenible! 🌱"

Now generate the message:`;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a language expert. Detect language and respond in that language. Return only the congratulations message, nothing else.",
        },
        { role: "user", content: prompt },
      ],
      model: config.groq.defaultModel,
      temperature: 0.3,
      max_tokens: 50,
    });

    const message = completion.choices[0]?.message?.content?.trim();
    
    if (message && message.length > 0 && message.length < 200) {
      console.log(`💬 [MESSAGE] Generated localized message: ${message}`);
      return message;
    }

    // Fallback
    return "Congratulations! You've already chosen a sustainable product! 🌱";
  } catch (error) {
    console.error("❌ [MESSAGE] Error generating message:", error);
    return "Congratulations! You've already chosen a sustainable product! 🌱";
  }
}

// Cross-validate country using multiple signals
function validateAndCorrectCountry(
  userCountry: string,
  pageUrl: string | undefined,
  productName: string
): string {
  console.log("🔍 [VALIDATE] Cross-validating country...");
  console.log("📍 [VALIDATE] Input:", {
    userCountry,
    pageUrl: pageUrl || "N/A",
    productName: productName.substring(0, 50),
  });

  const signals: {
    source: string;
    country: string;
    confidence: "high" | "medium" | "low";
  }[] = [];

  // SIGNAL 1: userCountry from frontend
  signals.push({
    source: "frontend",
    country: userCountry,
    confidence: "medium",
  });

  // SIGNAL 2: Domain TLD
  const domainMatch = (pageUrl || "").match(
    /\.(com\.br|com\.mx|es|fr|de|it|co\.uk|com\.au|ca)($|\/)/
  );
  if (domainMatch) {
    const tld = domainMatch[1];
    const tldToCountry: Record<string, string> = {
      "com.br": "BR",
      "com.mx": "MX",
      es: "ES",
      fr: "FR",
      de: "DE",
      it: "IT",
      "co.uk": "GB",
      "com.au": "AU",
      ca: "CA",
    };
    const domainCountry = tldToCountry[tld];
    if (domainCountry) {
      signals.push({
        source: "domain",
        country: domainCountry,
        confidence: "high",
      });
      console.log(`✅ [VALIDATE] Domain signal: ${tld} → ${domainCountry}`);
    }
  }

  // SIGNAL 3: Product name language - REMOVED
  // Let Groq handle language detection automatically
  console.log("ℹ️ [VALIDATE] Language detection delegated to Groq");

  console.log("📊 [VALIDATE] All signals:", signals);

  // Count votes by country (weighted by confidence)
  const votes: Record<string, number> = {};
  signals.forEach((signal) => {
    const weight = signal.confidence === "high" ? 2 : 1;
    votes[signal.country] = (votes[signal.country] || 0) + weight;
  });

  console.log("🗳️ [VALIDATE] Votes:", votes);

  // Get winner
  const winner = Object.entries(votes).sort(([_, a], [__, b]) => b - a)[0];

  const correctedCountry = winner[0];

  if (correctedCountry !== userCountry) {
    console.log(
      `🔄 [VALIDATE] Country corrected: ${userCountry} → ${correctedCountry}`
    );
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
    BR: [
      "Mercado Livre (mercadolivre.com.br)",
      "Americanas (americanas.com.br)",
      "Magazine Luiza (magazineluiza.com.br)",
      "Amazon Brasil (amazon.com.br)",
      "Shopee Brasil (shopee.com.br)",
    ],
    US: [
      "Amazon (amazon.com)",
      "Walmart (walmart.com)",
      "Target (target.com)",
      "eBay (ebay.com)",
      "Best Buy (bestbuy.com)",
    ],
    GB: [
      "Amazon UK (amazon.co.uk)",
      "Argos (argos.co.uk)",
      "Currys (currys.co.uk)",
      "John Lewis (johnlewis.com)",
    ],
    ES: [
      "Amazon España (amazon.es)",
      "El Corte Inglés (elcorteingles.es)",
      "MediaMarkt (mediamarkt.es)",
      "Carrefour (carrefour.es)",
    ],
    MX: [
      "Mercado Libre (mercadolibre.com.mx)",
      "Amazon México (amazon.com.mx)",
      "Liverpool (liverpool.com.mx)",
      "Coppel (coppel.com)",
    ],
    AR: [
      "Mercado Libre (mercadolibre.com.ar)",
      "Falabella (falabella.com.ar)",
      "Garbarino (garbarino.com)",
    ],
    FR: [
      "Amazon France (amazon.fr)",
      "Cdiscount (cdiscount.com)",
      "Fnac (fnac.com)",
      "Darty (darty.com)",
    ],
    DE: [
      "Amazon Deutschland (amazon.de)",
      "MediaMarkt (mediamarkt.de)",
      "Saturn (saturn.de)",
      "Otto (otto.de)",
    ],
    IT: [
      "Amazon Italia (amazon.it)",
      "ePRICE (eprice.it)",
      "Unieuro (unieuro.it)",
    ],
    CA: [
      "Amazon Canada (amazon.ca)",
      "Best Buy Canada (bestbuy.ca)",
      "Walmart Canada (walmart.ca)",
    ],
    AU: [
      "Amazon Australia (amazon.com.au)",
      "JB Hi-Fi (jbhifi.com.au)",
      "Harvey Norman (harveynorman.com.au)",
    ],
    KR: [
      "Coupang (coupang.com)",
      "Gmarket (gmarket.co.kr)",
      "11번가 (11st.co.kr)",
      "Interpark (interpark.com)",
    ],
    JP: [
      "Rakuten (rakuten.co.jp)",
      "Amazon Japan (amazon.co.jp)",
      "Mercari (mercari.com)",
    ],
    CN: ["Taobao (taobao.com)", "JD.com (jd.com)", "Tmall (tmall.com)"],
    IN: [
      "Amazon India (amazon.in)",
      "Flipkart (flipkart.com)",
      "Myntra (myntra.com)",
    ],
    RU: [
      "Wildberries (wildberries.ru)",
      "Ozon (ozon.ru)",
      "Yandex Market (market.yandex.ru)",
    ],
  };

  return (
    ecommerceByCountry[countryCode] || [
      `Local ${countryCode} e-commerce sites`,
      "Amazon",
      "eBay",
      "Local retailers",
    ]
  );
}

const COUNTRY_ECOMMERCE: Record<
  string,
  { name: string; domains: string[]; lang: string }
> = {
  BR: {
    name: "Brasil",
    domains: ["mercadolivre.com.br", "amazon.com.br", "magazineluiza.com.br"],
    lang: "pt",
  },
  JP: {
    name: "Japan",
    domains: ["rakuten.co.jp", "amazon.co.jp", "mercari.com"],
    lang: "ja",
  },
  KR: {
    name: "South Korea",
    domains: ["coupang.com", "gmarket.co.kr", "11st.co.kr"],
    lang: "ko",
  },
  DE: {
    name: "Germany",
    domains: ["amazon.de", "mediamarkt.de", "otto.de"],
    lang: "de",
  },
  US: {
    name: "United States",
    domains: ["amazon.com", "walmart.com", "target.com"],
    lang: "en",
  },
};

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
  category?: string;
}

interface SustainabilityIndicator {
  id?: string;
  name?: string;
  description?: string;
  measurement?: string;
  target?: string;
  data_sources?: string[];
}

interface SustainabilityCriterion {
  weight: number;
  guidelines?: string[];
  indicators?: SustainabilityIndicator[];
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
  confidence: "high" | "medium" | "low";
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
  isAlreadySustainable?: boolean;  // ✅ Flag for sustainable products
  sustainableMessage?: string;  // ✅ NEW: Localized message for sustainable products
  timestamp?: string;
  error?: string;
  _meta?: {
    cached: boolean;
    tokensUsed?: number | string;
    tokensSaved?: string;
    cacheSize?: number;
    duplicate?: boolean;
  };
}

// Cast seguro para o JSON
const alternativesConfig = alternativesData as unknown as AlternativesConfig;

const VALID_CATEGORIES: Record<string, true> = Object.keys(
  alternativesConfig.categories
).reduce((map, key) => {
  map[key] = true;
  return map;
}, {} as Record<string, true>);

// ======= UTILIDADES DE CATEGORIZAÇÃO DINÂMICA =======
function getTextProcessingConfig(): TextProcessingConfig {
  return (
    alternativesConfig.text_processing || {
      remove_accents: true,
      lowercase: true,
      remove_punctuation: true,
      word_boundary_matching: true,
    }
  );
}

function normalizeCategoryText(text: string): string {
  const settings = getTextProcessingConfig();
  let result = text || "";

  if (settings.lowercase) {
    result = result.toLowerCase();
  }

  if (settings.remove_accents) {
    result = result.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  if (settings.remove_punctuation) {
    result = result.replace(/[^a-z0-9\s]/g, " ");
  }

  return result.replace(/\s+/g, " ").trim();
}

function extractGuidelinesFromCriteria(
  criteria: Record<string, SustainabilityCriterion>
): string[] {
  const guidelines: string[] = [];

  for (const [, criterionData] of Object.entries(criteria)) {
    if (criterionData.indicators && Array.isArray(criterionData.indicators)) {
      criterionData.indicators.forEach((indicator) => {
        if (indicator.target) {
          guidelines.push(indicator.target);
        }
        if (indicator.description) {
          guidelines.push(indicator.description);
        }
      });
    } else if (
      criterionData.guidelines &&
      Array.isArray(criterionData.guidelines)
    ) {
      guidelines.push(...criterionData.guidelines);
    }
  }

  return guidelines;
}

function formatCriteriaForPrompt(categoryData: CategoryData): string {
  const criteria = categoryData.sustainability_criteria || {};
  let formatted = "";

  for (const [key, data] of Object.entries(criteria)) {
    formatted += `\n${key.toUpperCase()} (weight: ${data.weight}):\n`;

    if (data.indicators && Array.isArray(data.indicators)) {
      data.indicators.forEach((indicator, i) => {
        const indicatorLabel = indicator.name || "Indicator";
        const indicatorTarget = indicator.target || indicator.description || "";
        formatted += `  ${i + 1}. ${indicatorLabel}: ${indicatorTarget}\n`;
      });
    } else if (data.guidelines && Array.isArray(data.guidelines)) {
      data.guidelines.forEach((g, i) => {
        formatted += `  ${i + 1}. ${g}\n`;
      });
    }
  }

  return formatted;
}

function expandKeywordWithSynonyms(
  keyword: string,
  synonymsMap: Record<string, string[]>
): string[] {
  const normalizedKeyword = (keyword || "").toLowerCase();
  const variants = new Set<string>([normalizedKeyword]);

  const synonyms = synonymsMap?.[normalizedKeyword] || [];
  synonyms.forEach((syn) => variants.add((syn || "").toLowerCase()));

  if (!normalizedKeyword.endsWith("s")) {
    variants.add(`${normalizedKeyword}s`);
  }
  variants.add(normalizedKeyword.replace(/s$/, ""));

  return Array.from(variants).filter(Boolean);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countMatches(text: string, keyword: string): number {
  const settings = getTextProcessingConfig();
  const safeKeyword = escapeRegex((keyword || "").toLowerCase());

  if (settings.word_boundary_matching) {
    const pattern = new RegExp(`\\b${safeKeyword}\\b`, "gi");
    const matches = text.match(pattern);
    return matches ? matches.length : 0;
  }

  return (text.match(new RegExp(safeKeyword, "gi")) || []).length;
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
        const allVariants = expandKeywordWithSynonyms(
          keyword,
          categoryData.keyword_synonyms
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
      exclusions: [],
      confidence: "medium",
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
    alternativesConfig.scoring_config?.validation_thresholds
      ?.exclusion_penalty ?? -999;

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
        exclusions: exclusionsFound,
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
      `❌ [CATEGORY] Winner score too low: ${first?.score ?? 0} < ${
        thresholds.minimum_score
      }`
    );
    return null;
  }

  const ratio =
    second && second.score > 0 ? first.score / second.score : Infinity;

  if (ratio < thresholds.confidence_ratio) {
    first.confidence = "low";
    console.log(
      `⚠️ [CATEGORY] Low confidence: ratio ${ratio.toFixed(2)} < ${
        thresholds.confidence_ratio
      }`
    );
  } else if (ratio >= thresholds.confidence_ratio * 1.5) {
    first.confidence = "high";
  } else {
    first.confidence = "medium";
  }

  if (first.exclusions.length > 0) {
    console.log(
      `❌ [CATEGORY] Exclusions found for ${first.category}:`,
      first.exclusions
    );
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
    throw new Error("Cannot classify: low confidence and no AI available");
  }

  const categories = alternativesConfig.categories;
  const categoryList = Object.entries(categories)
    .map(
      ([key, data]) =>
        `- ${key}: ${data.name} (keywords: ${data.keywords
          .slice(0, 5)
          .join(", ")})`
    )
    .join("\n");

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
        {
          role: "system",
          content: "Return only the category key, nothing else.",
        },
        { role: "user", content: prompt },
      ],
      model: config.groq.defaultModel,
      temperature: config.groq.operations.typeDetection.temperature,
      max_tokens: config.groq.operations.typeDetection.maxTokens,
    });

    const rawCategory = completion.choices[0]?.message?.content?.trim();
    let aiCategory = rawCategory ? rawCategory.toLowerCase() : "";

    // NORMALIZE COMMON TYPOS
    const typoMap: Record<string, string> = {
      reuseable_zero_waste: "reusable_zero_waste",
      reuseable: "reusable",
      sustinable: "sustainable",
      sustianable: "sustainable",
      reneweable: "renewable",
      recylable: "recyclable",
      recycleable: "recyclable",
      biodegradeable: "biodegradable",
      composteable: "compostable",
      enviroment: "environment",
      enviorment: "environment",
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

    console.error(
      `❌ [CATEGORY] Invalid category after normalization: "${aiCategory}"`
    );
    console.error(
      `📋 [CATEGORY] Available categories:`,
      Object.keys(categories)
    );
    throw new Error(`AI returned invalid category: ${aiCategory}`);
  } catch (error) {
    console.error("❌ [CATEGORY] AI classification failed:", error);
    throw new Error("Could not identify product category");
  }
}

function logCategorizationResult(
  allScores: CategoryScore[],
  winner: CategoryScore | null
): void {
  console.log("🔍 [CATEGORY] Detailed Analysis:");
  console.log("━".repeat(60));

  const top3 = [...allScores].sort((a, b) => b.score - a.score).slice(0, 3);

  for (const score of top3) {
    console.log(`\n📊 ${score.category}: ${score.score} points`);
    if (score.matches.length > 0) {
      console.log(`   ✓ Matches: ${score.matches.join(", ")}`);
    }
    if (score.exclusions.length > 0) {
      console.log(`   ✗ Exclusions: ${score.exclusions.join(", ")}`);
    }
  }

  console.log("\n" + "━".repeat(60));

  if (winner) {
    console.log(`✅ [CATEGORY] Winner: ${winner.category}`);
    console.log(`   Confidence: ${winner.confidence}`);
    console.log(`   Score: ${winner.score}`);
  } else {
    console.log("❌ [CATEGORY] No valid winner found");
  }

  console.log("━".repeat(60));
}

// ===== DETECTAR TIPO DE PRODUTO COM IA (CORRIGIDO) =====
async function detectProductType(
  productName: string,
  pageTitle: string = "",
  categoryName: string = ""
): Promise<string> {
  // ✅ CORREÇÃO 3: FALLBACK INTELIGENTE com dicionário dinâmico do JSON
  const categories = alternativesConfig.categories;

  // Buscar tipo conhecido no nome do produto
  const safeProductName = productName || "";
  const lowerName = safeProductName.toLowerCase();
  const lowerTitle = (pageTitle || "").toLowerCase();

  for (const [, data] of Object.entries(categories)) {
    if (data.product_types) {
      for (const type of data.product_types) {
        // Usar regex com word boundaries
        const pattern = new RegExp(`\\b${type}s?\\b`, "i");
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
    const words = safeProductName.split(/\s+/).filter((w) => w.length > 2);
    const fallback = words.slice(-2).join(" ");
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
        {
          role: "system",
          content: "Extract product type. Return 1-2 words only.",
        },
        { role: "user", content: prompt },
      ],
      model: config.groq.defaultModel,
      temperature: config.groq.operations.typeDetection.temperature,
      max_tokens: config.groq.operations.typeDetection.maxTokens,
    });

    const rawType = completion.choices[0]?.message?.content?.trim();
    const type = rawType ? rawType.toLowerCase() : "";

    if (type && type.length > 0 && type.length < 50) {
      console.log(`🏷️ Type (AI): "${type}"`);
      return type;
    }

    throw new Error("Invalid type from AI");
  } catch (error) {
    console.error("⚠️ Type detection error:", error);
    // Fallback: últimas palavras do nome
    const words = safeProductName.split(/\s+/).filter((w) => w.length > 2);
    const fallback = words.slice(-2).join(" ");
    console.log(`🏷️ Type (error fallback): "${fallback}"`);
    return fallback;
  }
}

/**
 * Validates if a URL is a real e-commerce product URL (not a search engine)
 * Generic validation without hardcoded domain lists - works for any country/language
 * @param {string | null | undefined} url - URL to validate
 * @returns {boolean} - true if valid e-commerce URL, false if search engine or invalid
 */
function isValidEcommerceUrl(url: string | null | undefined): boolean {
  if (!url) return true; // null/undefined is valid (frontend will handle)
  
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    const searchParams = parsed.search.toLowerCase();
    
    // Pattern 1: Common search engine domains (generic patterns)
    const searchEnginePatterns = [
      'google',      // google.com, google.de, google.co.uk, etc.
      'bing',        // bing.com
      'yahoo',       // yahoo.com, yahoo.co.jp, etc.
      'duckduckgo',  // duckduckgo.com
      'baidu',       // baidu.com (China)
      'yandex',      // yandex.ru (Russia)
      'naver',       // naver.com (Korea)
      'ask',         // ask.com
      'aol',         // aol.com
      'ecosia',      // ecosia.org
    ];
    
    // Check if hostname contains any search engine pattern
    if (searchEnginePatterns.some(pattern => hostname.includes(pattern))) {
      console.log(`⚠️ [URL-VALIDATION] Detected search engine in hostname: ${hostname}`);
      return false;
    }
    
    // Pattern 2: Search path patterns (universal)
    const searchPathPatterns = [
      '/search',     // /search, /search/, /search?q=
      '/s/',         // /s/query
      '/query',      // /query
      '/find',       // /find
      '/results',    // /results
    ];
    
    if (searchPathPatterns.some(pattern => pathname.includes(pattern))) {
      console.log(`⚠️ [URL-VALIDATION] Detected search path pattern: ${pathname}`);
      return false;
    }
    
    // Pattern 3: Search query parameters (universal)
    const searchQueryPatterns = [
      'q=',          // ?q=query (most common)
      'query=',      // ?query=
      'search=',     // ?search=
      'keyword=',    // ?keyword=
      's=',          // ?s=query
    ];
    
    if (searchQueryPatterns.some(pattern => searchParams.includes(pattern))) {
      console.log(`⚠️ [URL-VALIDATION] Detected search query parameter: ${searchParams}`);
      return false;
    }
    
    // Pattern 4: URL shorteners and redirects (often used in search results)
    const redirectPatterns = [
      'bit.ly',
      'tinyurl',
      'goo.gl',
      't.co',
      'ow.ly',
    ];
    
    if (redirectPatterns.some(pattern => hostname.includes(pattern))) {
      console.log(`⚠️ [URL-VALIDATION] Detected URL shortener: ${hostname}`);
      return false;
    }
    
    // ✅ URL passed all validation checks
    return true;
  } catch (error) {
    // Invalid URL format
    console.log(`⚠️ [URL-VALIDATION] Invalid URL format: ${url}`);
    return false;
  }
}

/**
 * Prioritizes domain diversity in alternatives - reorders to show diverse domains first
 * Does NOT remove products, just reorders to maximize diversity in top results
 * Generic implementation that works with any e-commerce domain
 * @param {Alternative[]} alternatives - List of alternative products
 * @returns {Alternative[]} - Reordered list with diverse domains prioritized
 */
function enforceDomainDiversity(alternatives: Alternative[]): Alternative[] {
  if (!alternatives || alternatives.length === 0) {
    return alternatives;
  }

  const domainGroups: Record<string, Alternative[]> = {};
  const nullUrlAlternatives: Alternative[] = [];

  console.log(`🔍 [DIVERSITY] Reordering ${alternatives.length} alternatives for diversity`);

  // Group alternatives by domain
  for (const alt of alternatives) {
    if (!alt.product_url) {
      nullUrlAlternatives.push(alt);
      continue;
    }

    try {
      const url = new URL(alt.product_url);
      const domain = url.hostname.replace(/^www\./, '').toLowerCase();

      if (!domainGroups[domain]) {
        domainGroups[domain] = [];
      }
      domainGroups[domain].push(alt);
    } catch (error) {
      // Invalid URL, add to null group
      nullUrlAlternatives.push(alt);
    }
  }

  // Reorder: Take products round-robin from each domain to maximize diversity
  const reorderedAlternatives: Alternative[] = [];
  const domains = Object.keys(domainGroups);
  let maxProductsPerDomain = Math.max(...domains.map(d => domainGroups[d].length));

  // Round-robin: take 1 from each domain, then repeat
  for (let i = 0; i < maxProductsPerDomain; i++) {
    for (const domain of domains) {
      if (domainGroups[domain][i]) {
        reorderedAlternatives.push(domainGroups[domain][i]);
        console.log(`✅ [DIVERSITY] Added from ${domain}: ${domainGroups[domain][i].name}`);
      }
    }
  }

  // Add alternatives without URLs at the end
  reorderedAlternatives.push(...nullUrlAlternatives);

  // Log domain distribution
  const domainCount: Record<string, number> = {};
  domains.forEach(d => {
    domainCount[d] = domainGroups[d].length;
  });
  console.log(`📊 [DIVERSITY] Domain distribution:`, domainCount);
  console.log(`✅ [DIVERSITY] Reordered ${alternatives.length} alternatives (kept all, prioritized diversity)`);

  return reorderedAlternatives;
}



// ════════════════════════════════════════════════════════════
// FUNÇÃO AUXILIAR: Extrai domínios do país dinamicamente
// ════════════════════════════════════════════════════════════
function getCountryDomains(userCountry: string): string[] {
  const countryData = COUNTRY_ECOMMERCE[userCountry] || COUNTRY_ECOMMERCE["US"];

  // Extrai domínios dos e-commerces do país
  const domains = countryData.domains.map((domain) => {
    // Remove "www." e pega só o domínio
    return domain.replace("www.", "").toLowerCase();
  });

  // Adiciona o nome do país como variação
  const countryName = countryData.name.toLowerCase();
  domains.push(countryName);

  return domains;
}

// ===== HANDLER PRINCIPAL =====
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AnalysisResponse>
) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ success: false, error: "Method not allowed" });
  }

  try {
    const body = req.body as AnalysisRequest;
    const rawUserCountry =
      body.userCountry || body.productInfo?.userCountry || "US";
    console.log("🌍 [COUNTRY] Raw user country:", rawUserCountry);

    const productInfo: ProductInfo = body.productInfo || {
      productName: body.product_name || body.productName,
      pageUrl: body.product_url || body.pageUrl,
      userCountry: rawUserCountry,
    };

    productInfo.userCountry = productInfo.userCountry || rawUserCountry;

    // Cross-validate country (não usa Groq, pode ficar aqui)
    const userCountry = validateAndCorrectCountry(
      productInfo.userCountry,
      productInfo.pageUrl,
      productInfo.productName || productInfo.product_name || ""
    );

    productInfo.userCountry = userCountry;
    console.log("🌍 [COUNTRY] Validated country:", userCountry);

    const productName = productInfo.productName || productInfo.product_name;
    if (!productName) {
      return res
        .status(400)
        .json({ success: false, error: "productName is required" });
    }

    // ════════════════════════════════════════════════════════════
    // ✅ PROTEÇÃO CONTRA REQUESTS DUPLICADAS
    // ════════════════════════════════════════════════════════════
    const requestFingerprint = `${productName}:${userCountry}`.toLowerCase().replace(/\s+/g, '');
    const requestId = `req:${requestFingerprint}`;

    try {
      const recentRequest = await redis.get<AnalysisResponse>(requestId);
      
      if (recentRequest) {
        console.log("⚠️ [DUPLICATE] Request duplicada detectada, retornando cache");
        return res.status(200).json({
          ...recentRequest,
          _meta: {
            cached: true,
            duplicate: true,
            tokensUsed: recentRequest._meta?.tokensUsed,
            tokensSaved: recentRequest._meta?.tokensSaved,
            cacheSize: recentRequest._meta?.cacheSize,
          },
        });
      }
    } catch (error) {
      console.error("❌ [DUPLICATE] Erro ao verificar duplicata:", error);
      // Continua com a análise normal se falhar
    }

    console.log("📥 [ANALYZE] Request received:", {
      productName: productName,
      pageUrl: productInfo.pageUrl,
      userCountry: userCountry,
      timestamp: new Date().toISOString(),
    });
    // ════════════════════════════════════════════════════════════
    // ✅ STEP 1: CHECK CACHE FIRST (ANTES DE QUALQUER GROQ!)
    // ════════════════════════════════════════════════════════════
    console.log("🔍 [CACHE] Checking cache BEFORE any Groq calls...");

    const cachedAnalysis = await getCachedAnalysis(productName, userCountry);

    if (cachedAnalysis) {
      console.log(
        "🚀 [CACHE] HIT! Returning cached result (0 tokens, 0 API calls)"
      );

      // Retorna imediatamente sem chamar Groq
      const SUSTAINABLE_THRESHOLD = 70;
      const isAlreadySustainable = cachedAnalysis.originalProduct.sustainability_score >= SUSTAINABLE_THRESHOLD;
      const sustainableMessage = isAlreadySustainable ? await getSustainableProductMessage(productName) : undefined;
      
      return res.status(200).json({
        success: true,
        productInfo: {
          productName: productName,
          pageUrl: productInfo.pageUrl || "",
          pageTitle: productInfo.pageTitle || "",
          selectedText: productInfo.selectedText || "",
        },
        category: cachedAnalysis.originalProduct.category,
        originalProduct: cachedAnalysis.originalProduct,
        alternatives: cachedAnalysis.alternatives,
        isAlreadySustainable: isAlreadySustainable,
        sustainableMessage: sustainableMessage,
        timestamp: new Date().toISOString(),
        _meta: {
          cached: true,
          tokensUsed: 0,
          tokensSaved: "~2800",
        },
      });
    }

    console.log("📭 [CACHE] MISS - Proceeding with full analysis...");

    // ════════════════════════════════════════════════════════════
    // STEP 2: IDENTIFICAR CATEGORIA (com validação do frontend)
    // ════════════════════════════════════════════════════════════
    const categoryFromFrontend = body.category;
    let category: string;

    if (categoryFromFrontend) {
      console.log("📥 [BACKEND] Category from frontend:", categoryFromFrontend);

      const availableCategories = Object.keys(alternativesConfig.categories);

      if (availableCategories.includes(categoryFromFrontend)) {
        console.log(
          "✅ [BACKEND] Frontend category is valid:",
          categoryFromFrontend
        );
        console.log("🔍 [BACKEND] Validating if category matches product...");

        const productLower = productName.toLowerCase();
        const categoryData =
          alternativesConfig.categories[categoryFromFrontend];

        // Verificar se alguma keyword da categoria aparece no nome do produto
        const hasKeywordMatch = categoryData.keywords.some((keyword: string) =>
          productLower.includes(keyword.toLowerCase())
        );

        // Verificar se alguma exclusion_keyword aparece (indica categoria errada)
        const exclusionKeywords =
          (categoryData as any).exclusion_keywords || [];
        const hasExclusionMatch = exclusionKeywords.some((keyword: string) =>
          productLower.includes(keyword.toLowerCase())
        );

        if (hasKeywordMatch && !hasExclusionMatch) {
          console.log(
            "✅ [BACKEND] Category validated, using frontend category:",
            categoryFromFrontend
          );
          category = categoryFromFrontend;
        } else {
          console.warn(
            "⚠️ [BACKEND] Category does NOT match product, ignoring frontend category"
          );
          console.warn("⚠️ [BACKEND] Product:", productName.substring(0, 50));
          console.warn("⚠️ [BACKEND] Frontend sent:", categoryFromFrontend);
          console.warn("⚠️ [BACKEND] Will use heuristic instead");

          // Usar heurística
          category = await identifyCategory(productInfo);
          console.log("✅ [BACKEND] Heuristic category:", category);
        }
      } else {
        console.warn(
          "⚠️ [BACKEND] Frontend sent invalid category:",
          categoryFromFrontend
        );
        category = await identifyCategory(productInfo);
        console.log("✅ [BACKEND] Heuristic category:", category);
      }
    } else {
      // Categoria não enviada pelo frontend
      category = await identifyCategory(productInfo);
    }

    console.log("📂 [CATEGORY] Final category:", category);

    console.log("📊 [CRITERIA] Structure:", {
      hasIndicators:
        !!alternativesConfig.categories[category]?.sustainability_criteria
          ?.durability?.indicators,
      hasGuidelines:
        !!alternativesConfig.categories[category]?.sustainability_criteria
          ?.durability?.guidelines,
      version: alternativesConfig.version,
    });

    const categories = alternativesConfig.categories;
    const categoryData = categories[category];

    if (!categoryData) {
      return res
        .status(400)
        .json({ success: false, error: `Category not found: ${category}` });
    }

    // ════════════════════════════════════════════════════════════
    // STEP 3: TRADUZIR E DETECTAR TIPO (só executa se cache miss)
    // ════════════════════════════════════════════════════════════
    console.log("🔍 [SEARCH] Searching sustainable alternatives...");

    const translatedName = await translateProductName(productName);
    const productType = await detectProductType(
      translatedName,
      productInfo.pageTitle || "",
      categoryData.name
    );

    console.log("🏷️ [TYPE] Detected:", {
      productType: productType,
      translatedName: translatedName,
    });

    // ════════════════════════════════════════════════════════════
    // STEP 4: BUSCAR PRODUTOS REAIS (não usa Groq)
    // ════════════════════════════════════════════════════════════
    const { products: realProducts, validUrls } = await searchRealProducts(
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
    console.log("📡 [GROQ] Analyzing product...");

    const analysis = await analyzeWithGroq(
      productInfo,
      category,
      categoryData,
      productType,
      realProducts,
      userCountry,
      validUrls
    );

    if (!analysis) {
      throw new Error("Failed to generate analysis");
    }

    // ════════════════════════════════════════════════════════════
    // STEP 6: SALVAR NO CACHE
    // ════════════════════════════════════════════════════════════
    await setCachedAnalysis(productName, userCountry, analysis);
    console.log("💾 [CACHE] Analysis saved to cache");

    // ════════════════════════════════════════════════════════════
    // STEP 7: RETORNAR RESULTADO
    // ════════════════════════════════════════════════════════════
    
    // ✅ Check if product is already sustainable
    const SUSTAINABLE_THRESHOLD = 70;
    const isAlreadySustainable = analysis.originalProduct.sustainability_score >= SUSTAINABLE_THRESHOLD;
    const sustainableMessage = isAlreadySustainable ? await getSustainableProductMessage(productName) : undefined;
    
    if (isAlreadySustainable) {
      console.log(`🌱 [SUSTAINABLE] Product already sustainable! Score: ${analysis.originalProduct.sustainability_score}`);
      console.log(`💬 [MESSAGE] Localized message (${userCountry}): ${sustainableMessage}`);
    }
    
    const response: AnalysisResponse = {
      success: true,
      productInfo: {
        productName: productName,
        pageUrl: productInfo.pageUrl || "",
        pageTitle: productInfo.pageTitle || "",
        selectedText: productInfo.selectedText || "",
      },
      category: category,
      originalProduct: analysis.originalProduct,
      alternatives: analysis.alternatives,
      isAlreadySustainable: isAlreadySustainable,  // ✅ Flag for frontend
      sustainableMessage: sustainableMessage,  // ✅ NEW: Localized message
      timestamp: new Date().toISOString(),
      _meta: {
        cached: false,
        tokensUsed: "~2800",
      },
    };

    console.log("📤 [ANALYZE] Response sent:", {
      success: true,
      category: category,
      alternativesCount: analysis.alternatives.length,
      isAlreadySustainable: isAlreadySustainable,
      timestamp: response.timestamp,
    });

    return res.status(200).json(response);
  } catch (error) {
    console.error("❌ [ERROR]:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
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
): Promise<{
  products: Array<{ title: string; url: string; snippet: string }>;
  validUrls: string[];
}> {
  const country = COUNTRY_ECOMMERCE[userCountry] || COUNTRY_ECOMMERCE["US"];

  // Query otimizada com site: operator
  const query = `sustainable eco-friendly ${productType} ${
    country.name
  } (${country.domains.map((d: string) => "site:" + d).join(" OR ")})`;

  console.log(`🔍 [TAVILY] Query: ${query}`);

  try {
    let results = await webSearchClient.search(query, {
      maxResults: 100,
      searchDepth: "advanced",
      includeAnswer: false,
    });

    const validUrls = new Set(
      (results.results || []).map((r) => r.url).filter(Boolean)
    );

    console.log(`🔍 [TAVILY] Found ${validUrls.size} valid product URLs`);

    // ✅ FALLBACK: Se poucos resultados, simplificar query
    if (!results.success || !results.results || results.results.length < 5) {
      console.log("⚠️ [SEARCH] Few results, trying broader query...");
      const fallbackQuery = `eco-friendly sustainable ${productType} shop`;
      console.log("🔎 [SEARCH] Query (broad):", fallbackQuery);

      results = await webSearchClient.search(fallbackQuery, {
        maxResults: 100,
        searchDepth: "advanced",
        includeAnswer: false,
      });

      (results.results || []).forEach((r) => {
        if (r?.url) {
          validUrls.add(r.url);
        }
      });
    }

    if (!results.success || !results.results) {
      return { products: [], validUrls: Array.from(validUrls) };
    }

    const rawResults = (results.results || []).filter(Boolean);

    // ✅ Pegar domínios permitidos do país (SEM HARDCODE)
    const allowedDomains = country.domains;

    // ✅ Pegar certificações da categoria (SEM HARDCODE)
    const sustainKeywords = categoryData.certifications.map((cert) =>
      cert.toLowerCase()
    );

    const validProducts = rawResults.filter((r) => {
      const url = (r.url || "").toLowerCase();
      const text = `${r.title || ""} ${r.snippet || ""}`.toLowerCase();

      if (!url) {
        return false;
      }

      let host = "";
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch (_) {
        console.log(`🔍 [FILTER] Rejected: ${url} - Reason: invalid URL`);
        return false;
      }

      // ✅ FILTRO RELAXADO: Aceita domínios do país OU domínios com nome do país
      const countryName = country.name.toLowerCase();
      const matchesDomain =
        allowedDomains.some((domain: string) => host.includes(domain)) ||
        host.includes(countryName) ||
        url.includes(countryName);

      if (!matchesDomain) {
        console.log(
          `🔍 [FILTER] Rejected: ${url} - Reason: domain not in ${userCountry}`
        );
        return false;
      }

      // ✅ FILTRO RELAXADO: Remove apenas produtos CLARAMENTE não relacionados
      const blacklist = [
        "book",
        "ebook",
        "guide",
        "manual",
        "course",
        "tutorial",
        "article",
        "pdf",
      ];
      const isBlacklisted = blacklist.some((word) => text.includes(word));

      if (isBlacklisted) {
        console.log(
          `🔍 [FILTER] Rejected: ${url} - Reason: not a product (${blacklist.find(
            (w) => text.includes(w)
          )})`
        );
        return false;
      }

      // ✅ REMOVIDO: Filtro de "sustainability keywords" - deixa o Groq decidir
      // O Tavily já busca com "sustainable eco-friendly", não precisa filtrar novamente

      return true;
    });
    console.log(
      `✅ [SEARCH] Filtered: ${validProducts.length}/${results.results.length}`
    );

    const unique = Array.from(
      new Map(validProducts.map((p) => [p.url, p])).values()
    );

    const limited = unique.slice(0, 20);

    console.log(
      `✅ [SEARCH] Returning ${limited.length} products after dedupe/limit`
    );

    const products = limited.map((r) => ({
      title: r.title || "Untitled Product",
      url: r.url || "",
      snippet: r.snippet || "No description available",
    }));

    return { products, validUrls: Array.from(validUrls) };
  } catch (error) {
    console.error("❌ [SEARCH] Error:", error);
    return { products: [], validUrls: [] };
  }
}

// ===== TRADUZIR (CORRIGIDO) =====
// ===== TRADUZIR (CORRIGIDO) =====
async function translateProductName(name: string): Promise<string> {
  if (!name || name.trim().length === 0) {
    console.log("⚠️ [TRANSLATE] Empty product name provided");
    return "";
  }
  // Se já está em inglês, retornar
  if (/^[a-zA-Z0-9\s\-_]+$/.test(name)) {
    return name;
  }

  // ✅ CORREÇÃO 6: DICIONÁRIO BÁSICO DE TRADUÇÃO (dinâmico do JSON)
  const commonTranslations = alternativesConfig.common_translations;
  const basicTranslations: Record<string, string> = commonTranslations || {
    // Fallback caso o JSON falhe
    sapato: "shoe",
    sapatos: "shoes",
    salto: "heel",
    saltos: "heels",
    tênis: "sneaker",
    tenis: "sneaker",
  };

  // Tentar tradução básica primeiro
  const normalizedName = name || "";
  const words = normalizedName.toLowerCase().split(/\s+/);
  const basicTranslation = words
    .map((word) => basicTranslations[word] || word)
    .join(" ");

  // Se conseguiu traduzir algo, usar
  if (basicTranslation !== normalizedName.toLowerCase()) {
    console.log(`🌐 [TRANSLATE] Basic: "${name}" → "${basicTranslation}"`);
    return basicTranslation;
  }

  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    console.log("⚠️ [TRANSLATE] No API key, using basic translation");
    return basicTranslation;
  }

  try {
    const groq = new Groq({ apiKey: groqApiKey });
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "Translate to English. Return ONLY the translation, nothing else.",
        },
        { role: "user", content: name },
      ],
      model: config.groq.defaultModel,
      temperature: config.groq.operations.translation.temperature,
      max_tokens: config.groq.operations.translation.maxTokens,
    });

    const translation = completion.choices[0]?.message?.content?.trim();
    if (translation && translation.length > 0) {
      console.log(`🌐 [TRANSLATE] AI: "${name}" → "${translation}"`);
      return translation;
    }

    console.log("⚠️ [TRANSLATE] AI failed, using basic translation");
    return basicTranslation;
  } catch (error) {
    console.error("❌ [TRANSLATE] Error:", error);
    return basicTranslation;
  }
}

// ===== IDENTIFICAR CATEGORIA (REFATORADA - CONFIG-DRIVEN) =====
async function identifyCategory(productInfo: ProductInfo): Promise<string> {
  const name = productInfo.productName || productInfo.product_name || "";
  const desc = productInfo.description || "";
  const title = productInfo.pageTitle || "";
  const url = productInfo.pageUrl || productInfo.product_url || "";

  // 🔎 Heuristic categorization to distinguish software vs physical supplies
  try {
    const heuristicCategory = categorizeProduct(name, `${title} ${desc}`);

    if (heuristicCategory) {
      if (!VALID_CATEGORIES[heuristicCategory]) {
        throw new Error(
          `Internal error: Invalid category "${heuristicCategory}"`
        );
      }

      console.log("✅ [CATEGORY] Heuristic match:", heuristicCategory);
      return heuristicCategory;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("too generic")) {
      throw error;
    }
    console.log("ℹ️ [CATEGORY] Heuristic not conclusive:", error);
  }

  const translated = await translateProductName(name);
  if (!name && !desc && !title && !url) {
    console.error("❌ [CATEGORY] No product information provided");
    throw new Error(
      "Product information is required. Please provide at least a product name, description, title, or URL."
    );
  }
  const weights = alternativesConfig.scoring_config.source_weights;

  const textSample = [translated, name, title, desc]
    .filter(Boolean)
    .join(" | ");
  console.log(
    "🔍 [CATEGORY] Text sample:",
    textSample ? textSample.substring(0, 150) : "(empty)"
  );

  const sources: ScoringSource[] = [
    { text: translated, weight: weights.product_name_translated },
    { text: name, weight: weights.product_name_original },
    { text: title, weight: weights.page_title },
    { text: desc, weight: weights.description },
  ];

  const categoryScores = calculateCategoryScores(sources);
  const filteredScores = applyExclusionRules(categoryScores, translated);
  const winner = selectWinner(filteredScores);

  logCategorizationResult(filteredScores, winner);

  if (!winner || winner.confidence === "low") {
    console.log("⚠️ [CATEGORY] Low confidence, using AI fallback");
    return await classifyWithAI(name, translated, title);
  }

  return winner.category;
}

function categorizeProduct(productName: string, productType: string): string {
  const nameLower = (productName || "").toLowerCase();
  const typeLower = (productType || "").toLowerCase();

  const isTooShort = productName.trim().length < 3;
  const isJustNumbers = /^\d+$/.test(productName.trim());
  const isGenericWord = [
    "product",
    "item",
    "thing",
    "test",
    "xyz",
    "abc",
  ].includes(nameLower.trim());

  if (isTooShort || isJustNumbers || isGenericWord) {
    throw new Error(
      "Could not identify product category - product name too generic or incomplete"
    );
  }

  throw new Error("Use identifyCategory() instead");
}

// ===== ANALISAR COM GROQ (CORRIGIDO) =====
async function analyzeWithGroq(
  productInfo: ProductInfo,
  category: string,
  categoryData: CategoryData,
  productType: string,
  realProducts: Array<{ title: string; url: string; snippet: string }>,
  userCountry: string,
  validUrls: string[]
): Promise<GroqAnalysisResult> {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    throw new Error("GROQ_API_KEY not configured");
  }

  const groq = new Groq({ apiKey: groqApiKey });
  const productName = productInfo.productName || productInfo.product_name || "";

  const localEcommerce = getLocalEcommerce(userCountry);

  // Build criteria text
  const criteriaText = formatCriteriaForPrompt(categoryData);

  // Build products list
  const validProducts = (realProducts || [])
    .filter((p) => p && typeof p === "object" && p.title && p.url)
    .map((p) => ({
      title: p.title || "Untitled",
      url: p.url || "N/A",
      snippet: p.snippet || "No description available",
    }));

  const productsText =
    validProducts.length > 0
      ? `\n\nREAL PRODUCTS FOUND (${
          validProducts.length
        } total):\n${validProducts
          .map(
            (p, i) =>
              `${i + 1}. ${p.title}\n   URL: ${p.url}\n   ${(
                p.snippet || "No description available"
              ).substring(0, 100)}...\n`
          )
          .join("\n")}`
      : "\n\nNO PRODUCTS FOUND - Suggest well-known sustainable brands in the user's country.";

  const prompt = `You are a sustainability expert analyzing products for users worldwide.

    ═══════════════════════════════════════════════════════════════
    USER CONTEXT:
    ═══════════════════════════════════════════════════════════════
    - User Country: ${userCountry}
    - Product Name: ${productName}
    - Local E-commerce Sites: ${localEcommerce.slice(0, 5).join(", ")}

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

    2. CERTIFICATIONS:
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
    URL: ${productInfo.pageUrl || "N/A"}

    SUSTAINABILITY CRITERIA FOR THIS CATEGORY:
    ${criteriaText}

    RELEVANT CERTIFICATIONS: ${categoryData.certifications.join(", ")}
    ${productsText}

    ═══════════════════════════════════════════════════════════════
    CRITICAL INSTRUCTIONS - READ CAREFULLY:
    ═══════════════════════════════════════════════════════════════

    🚨 RULE #0 - CATEGORY COHERENCE (MOST IMPORTANT):
    ═══════════════════════════════════════════════════════════════
    
    The original product is from category: "${category}" (${categoryData.name})
    Product type: "${productType}"
    
    ALL ALTERNATIVES MUST BE FROM THE SAME CATEGORY AND PRODUCT TYPE.
    
    ❌ NEVER suggest products from different categories:
       - If original is CLOTHING (sweater, shirt, pants), DO NOT suggest electronics, furniture, or appliances
       - If original is ELECTRONICS (phone, laptop), DO NOT suggest clothing, food, or furniture
       - If original is PERSONAL CARE (shampoo, soap), DO NOT suggest electronics, clothing, or furniture
       - If original is FURNITURE (chair, table), DO NOT suggest electronics, clothing, or appliances
    
    ✅ ONLY suggest products that:
       1. Belong to the EXACT SAME category: "${category}"
       2. Are the SAME product type: "${productType}"
       3. Serve the SAME purpose as the original product
    
    EXAMPLES OF CORRECT ALTERNATIVES:
    - Original: Cotton Sweater → Alternatives: Organic wool sweater, bamboo pullover, recycled cotton jumper
    - Original: Shampoo → Alternatives: Organic shampoo, sulfate-free shampoo, natural hair wash
    - Original: Laptop → Alternatives: Refurbished laptop, energy-efficient laptop, recycled materials laptop
    
    EXAMPLES OF INCORRECT ALTERNATIVES (NEVER DO THIS):
    - Original: Sweater → ❌ Printer, Air conditioner, Furniture (WRONG CATEGORY)
    - Original: Shampoo → ❌ Laptop, Clothing, Furniture (WRONG CATEGORY)
    - Original: Phone → ❌ Shampoo, Sweater, Chair (WRONG CATEGORY)
    
    IF YOU CANNOT FIND 4 ALTERNATIVES FROM THE SAME CATEGORY IN THE SEARCH RESULTS:
    - Return fewer alternatives (even 0 is acceptable)
    - DO NOT fill the gap with products from other categories
    - Category coherence is MORE IMPORTANT than meeting the minimum count
    
    ═══════════════════════════════════════════════════════════════

    1. MINIMUM ALTERNATIVES REQUIRED:
      - You SHOULD provide AT LEAST 4 sustainable alternatives
      - BUT ONLY if they are from the same category as the original
      - If you cannot find 4 alternatives from the SAME CATEGORY, return fewer
      - Look through ALL products in "REAL PRODUCTS FOUND" to find valid options

    2. PRODUCT MATCHING:
      - Suggest ONLY products that appear in the "REAL PRODUCTS FOUND" list above
      - Match products by name and description from the search results
      - Each alternative MUST correspond to one of the numbered items above

    3. URL USAGE (CRITICAL - DO NOT VIOLATE):
      - Use the EXACT URL from the search results (copy it character-by-character)
      - DO NOT modify, shorten, or create new URLs under ANY circumstances
      - DO NOT invent URLs even if you know the product exists
      - DO NOT use placeholder URLs like "example.com" or "store.com"
      - If a product from the list doesn't have a clear URL, skip it and find another
      - EVERY alternative MUST have a real, working URL from the search results

    4. VALIDATION CHECKLIST (Check each alternative IN THIS ORDER):
      ✓ Is it from the SAME CATEGORY as "${category}"? (If NO, REMOVE IT IMMEDIATELY)
      ✓ Is it the SAME PRODUCT TYPE as "${productType}"? (If NO, REMOVE IT IMMEDIATELY)
      ✓ Does this product appear in "REAL PRODUCTS FOUND"? (If NO, remove it)
      ✓ Is the URL copied exactly from the search results? (If NO, remove it)
      ✓ Is the URL from a store in ${userCountry}? (If NO, remove it)
      ✓ Is the sustainability_score >= 70? (If NO, remove it)

    5. COUNTRY VERIFICATION:
      - ALL product URLs MUST be from stores that operate in ${userCountry}
      - Check the domain: ${localEcommerce.slice(0, 3).join(", ")}
      - If a URL is from a different country, DO NOT include it

    ═══════════════════════════════════════════════════════════════
    DOMAIN DIVERSITY REQUIREMENT (MANDATORY):
    ═══════════════════════════════════════════════════════════════

    1. MAXIMUM 2 PRODUCTS PER DOMAIN:
      - Extract the domain from each product URL (e.g., amazon.de, mercadolivre.com.br)
      - You MUST NOT select more than 2 alternatives from the same domain
      - If you find 3+ good products from one domain, choose only the best 2

    2. PRIORITIZATION ORDER:
      a) Specialized eco-friendly/sustainable stores (highest priority)
      b) Different general retailers (medium priority)
      c) Same domain as other alternatives (lowest priority - max 2)

    3. DIVERSITY EXAMPLES:
      ✓ GOOD: 1 from amazon.de + 1 from ebay.de + 1 from avocadostore.de + 1 from waschbaer.de
      ✓ GOOD: 2 from amazon.de + 1 from otto.de + 1 from mediamarkt.de
      ✗ BAD: 4 from amazon.de (violates max 2 per domain rule)
      ✗ BAD: 3 from mercadolivre.com.br + 1 from amazon.com.br (violates max 2 per domain rule)

    4. FALLBACK BEHAVIOR:
      - If you cannot find 4 products with domain diversity, it's acceptable to have duplicates
      - But you MUST prioritize diversity first
      - Only use the same domain for 3+ products if absolutely no other options exist

    5. DOMAIN EXTRACTION:
      - Domain = the main website (e.g., "amazon.de" from "https://www.amazon.de/dp/B123")
      - Subdomains count as same domain (e.g., "www.amazon.de" = "amazon.de")
      - Different country TLDs are different domains (e.g., "amazon.de" ≠ "amazon.com")

    ═══════════════════════════════════════════════════════════════
    VALIDATION RULES (MANDATORY):
    ═══════════════════════════════════════════════════════════════

    1. Alternatives MUST be the SAME product type as the original
    2. You MUST provide AT LEAST 4 sustainable alternatives (REQUIRED)
    3. Each alternative MUST have sustainability_score >= 70
    4. Use ONLY products from the "REAL PRODUCTS FOUND" list
    5. Use ONLY exact URLs from the search results
    6. ALL URLs must be from stores in ${userCountry}
    7. MAXIMUM 2 alternatives per domain (prioritize diversity)
    8. If you cannot find 4 valid alternatives, review the list again more carefully

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
        "recommendations": ["<recommendation in detected language>", "<recommendation in detected language>"]
      },
      "alternatives": [
        {
          "name": "<product name from search results>",
          "description": "<clear description in detected language>",
          "benefits": "<why more sustainable, in detected language>",
          "sustainability_score": <number 70-100>,
          "where_to_buy": "<store names from search results>",
          "certifications": ["<relevant certifications>"],
          "product_url": "<EXACT URL from REAL PRODUCTS FOUND list>"
        }
      ]
    }

    ═══════════════════════════════════════════════════════════════
    FINAL REMINDERS:
    ═══════════════════════════════════════════════════════════════

    1. RESPOND ENTIRELY in the detected language from the product name
    2. Use ONLY URLs from the "REAL PRODUCTS FOUND" list above
    3. If no suitable products found, return empty alternatives array: []
    4. RETURN ONLY VALID JSON - NO MARKDOWN, NO COMMENTS

    Begin analysis now.`;

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "Return valid JSON only. Use real products. Match product types strictly.",
        },
        { role: "user", content: prompt },
      ],
      model: config.groq.defaultModel,
      temperature: config.groq.operations.analysis.temperature,
      max_tokens: config.groq.operations.analysis.maxTokens,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("No response from Groq");

    const result = JSON.parse(content) as GroqAnalysisResult;

    console.log("🤖 [GROQ] Alternatives received:", {
      count: result.alternatives?.length || 0,
      withUrls: (result.alternatives || []).filter((a) => a.product_url).length,
    });

    const validatedAlternatives = (result.alternatives || [])
      .map((alt) => {
        if (alt?.product_url && typeof alt.product_url === "string") {
          // ✅ Check if URL exists in Tavily results
          const urlExists = validUrls.some(
            (validUrl) =>
              validUrl === alt.product_url ||
              (alt.product_url && validUrl.includes(alt.product_url)) ||
              (alt.product_url && alt.product_url.includes(validUrl))
          );

          if (!urlExists) {
            console.log(
              `⚠️ [VALIDATION] URL not in Tavily results, removed: ${alt.product_url}`
            );
            alt.product_url = null;
            return alt;
          }

          // ✅ NEW: Verify URL is from user's country
          try {
            const urlObj = new URL(alt.product_url);
            const hostname = urlObj.hostname.toLowerCase();
            const countryData = COUNTRY_ECOMMERCE[userCountry] || COUNTRY_ECOMMERCE["US"];
            const allowedDomains = countryData.domains.map(d => d.toLowerCase());
            const countryName = countryData.name.toLowerCase();

            const isFromCorrectCountry = 
              allowedDomains.some(domain => hostname.includes(domain)) ||
              hostname.includes(countryName);

            if (!isFromCorrectCountry) {
              console.log(
                `⚠️ [VALIDATION] URL not from ${userCountry}, removed: ${alt.product_url}`
              );
              alt.product_url = null;
              return alt;
            }

            console.log(`✅ [VALIDATION] Valid URL from ${userCountry}: ${alt.product_url}`);
          } catch (error) {
            console.log(
              `⚠️ [VALIDATION] Invalid URL format, removed: ${alt.product_url}`
            );
            alt.product_url = null;
            return alt;
          }
        }

        return alt;
      })
      .filter((alt) => alt && alt.product_url !== null)
      .filter((alt) => {
        if (!alt || !alt.name) {
          return false;
        }

        const altName = (alt.name || "").toLowerCase();

        if (/\b(book|guide|article|manual|course|tutorial)\b/.test(altName)) {
          return false;
        }

        if (
          alt.sustainability_score < config.sustainability.minAlternativeScore
        ) {
          return false;
        }

        return true;
      });

    // ✅ Enforce domain diversity (maximum 2 products per domain)
    const diverseAlternatives = enforceDomainDiversity(validatedAlternatives);

    // ✅ Ensure minimum 4 alternatives
    const MIN_ALTERNATIVES = 4;
    if (diverseAlternatives.length < MIN_ALTERNATIVES) {
      const countryContext =
        COUNTRY_ECOMMERCE[userCountry] || COUNTRY_ECOMMERCE["US"];
      const productTypeFallback = productType || "product";

      const needed = MIN_ALTERNATIVES - diverseAlternatives.length;
      console.log(`⚠️ [FALLBACK] Only ${diverseAlternatives.length} alternatives found, adding ${needed} fallback entries`);

      for (let i = 0; i < needed; i++) {
        diverseAlternatives.push({
          name: `Search more sustainable alternatives`,
          description: `We couldn't find enough specific products, but you can search for sustainable alternatives`,
          benefits: `Find sustainable ${productTypeFallback} options available in ${countryContext.name}`,
          sustainability_score: 0,
          where_to_buy: `Search online`,
          certifications: [],
          product_url: null,  // ✅ Set to null - frontend will show "Search on Google" button
        });
      }

      console.log(`🔍 [FALLBACK] Added ${needed} fallback alternative(s) with null URLs to reach minimum ${MIN_ALTERNATIVES} alternatives`);
    }

    // ✅ Final validation: Clean any search engine URLs that might have slipped through
    result.alternatives = diverseAlternatives.map(alt => {
      if (!isValidEcommerceUrl(alt.product_url)) {
        console.log(`⚠️ [FINAL-VALIDATION] Removing invalid/search URL: ${alt.product_url}`);
        return { ...alt, product_url: null };
      }
      return alt;
    });

    console.log("✅ [FINAL] Validated alternatives:", {
      count: diverseAlternatives.length,
      urls: diverseAlternatives.map((a) => a.product_url),
    });

    return result;
  } catch (error) {
    console.error("❌ [GROQ] Error:", error);
    throw error;
  }
}

export { identifyCategory };

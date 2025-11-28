console.log('🌱 SICOSI Content Script iniciando...');

// ===== HELPER: Extrair categoria de forma segura =====
function extractCategorySafe(data) {
  if (!data) return null;

  const category =
    data.category ||
    data.productCategory ||
    data.categoryName ||
    data.tipo ||
    data.type ||
    data.analysis?.category ||
    data.analysis?.productCategory ||
    data.metadata?.category ||
    null;

  return category && typeof category === 'string' ? category : null;
}

// ===== STATE =====
const analyzedProducts = new Map();

function persistAnalyzedProducts() {
  try {
    const serialized = JSON.stringify(Array.from(analyzedProducts.entries()));
    localStorage.setItem('sicosi:analyzedProducts', serialized);
  } catch (error) {
    console.warn('[SICOSI] Não foi possível persistir análises', error);
  }
}

function loadAnalyzedProducts() {
  try {
    const serialized = localStorage.getItem('sicosi:analyzedProducts');
    if (serialized) {
      const entries = JSON.parse(serialized);
      entries.forEach(([url, value]) => analyzedProducts.set(url, value));
    }
  } catch (error) {
    console.warn('[SICOSI] Não foi possível carregar análises', error);
  }
}

loadAnalyzedProducts();

// ===== ENGINE =====
const { SustainabilityEngine } = require('./sustainability-engine');
const sustainabilityEngine = new SustainabilityEngine();

// ===== STORE ANALYSIS =====
function storeProductAnalysis(
  url,
  { score, name, category = null, suggestedByExtension = false, originalProduct = null }
) {
  const safeCategory = extractCategorySafe({ category });

  analyzedProducts.set(url, {
    score,
    name,
    category: safeCategory,
    suggestedByExtension,
    originalProduct,
    timestamp: Date.now(),
  });

  persistAnalyzedProducts();
}

// ===== UI UPDATE =====
function updateModalWithAnalysis(productUrl, analysis) {
  const safeAnalysis = analysis || {};
  const existing = analyzedProducts.get(productUrl);
  const category =
    extractCategorySafe(safeAnalysis) ||
    extractCategorySafe(safeAnalysis?.analysis) ||
    extractCategorySafe(existing) ||
    null;

  console.log('[SICOSI] 🔍 Debug categoria:', {
    'analysis.category': safeAnalysis.category,
    'analysis.analysis?.category': safeAnalysis.analysis?.category,
    extractedCategory: category,
    analysisKeys: Object.keys(safeAnalysis),
    analysisAnalysisKeys: safeAnalysis.analysis ? Object.keys(safeAnalysis.analysis) : null,
  });

  const modal = document.querySelector('#sicosi-modal');
  if (!modal) return;

  const scoreElement = modal.querySelector('[data-sicosi-score]');
  const categoryElement = modal.querySelector('[data-sicosi-category]');

  if (scoreElement && (analysis.analysis?.sustainability_score || analysis.score)) {
    scoreElement.textContent =
      analysis.analysis?.sustainability_score?.toString() || analysis.score?.toString() || '0';
  }

  if (categoryElement) {
    categoryElement.textContent = category || 'Categoria não identificada';
  }
}

// ===== MAIN FLOW (EXAMPLE) =====
async function analyzeCurrentProduct(productInfo) {
  if (!sustainabilityEngine) return null;

  const analysis = await sustainabilityEngine.analyzeProduct(productInfo);
  storeProductAnalysis(productInfo.url, {
    score: analysis.analysis?.sustainability_score ?? analysis.score ?? 0,
    name: productInfo.name || analysis.productInfo?.name || 'Produto',
    category: analysis.category,
    suggestedByExtension: false,
    originalProduct: null,
  });

  updateModalWithAnalysis(productInfo.url, analysis);
  return analysis;
}

module.exports = {
  extractCategorySafe,
  storeProductAnalysis,
  updateModalWithAnalysis,
  analyzeCurrentProduct,
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const alternativesConfig = require('../data/alternatives.json');

class SustainabilityEngine {
  constructor(alternatives = alternativesConfig) {
    this.alternatives = alternatives.categories || alternatives || {};
  }

  detectCategory(productInfo = {}) {
    const name = (productInfo.name || productInfo.title || '').toLowerCase();
    const description = (productInfo.description || '').toLowerCase();
    const haystack = `${name} ${description}`;
    const availableCategories = Object.keys(this.alternatives || {});

    const categoryKeywords = {
      electronics: ['phone', 'iphone', 'samsung', 'laptop', 'computer', 'tablet', 'tv', 'camera', 'eletrônico'],
      textiles_clothing: ['shirt', 'pants', 'dress', 'shoes', 'jacket', 'clothing', 'roupa', 'tênis', 'sapato'],
      food_agriculture: ['food', 'organic', 'coffee', 'tea', 'snack', 'alimento', 'comida'],
      furniture: ['chair', 'table', 'desk', 'sofa', 'bed', 'móvel', 'cadeira', 'mesa'],
      cosmetics_personal_care: ['shampoo', 'soap', 'cream', 'lotion', 'perfume', 'cosmético', 'sabonete'],
      digital_products_software: ['software', 'license', 'licença', 'download', 'app', 'aplicativo'],
      construction_materials: ['cement', 'concrete', 'brick', 'steel', 'wood', 'cimento', 'tijolo'],
      automotive: ['car', 'tire', 'pneu', 'carro', 'veículo', 'automotivo'],
      cleaning_products: ['detergent', 'cleaner', 'soap', 'detergente', 'limpeza', 'sabão'],
      toys_games: ['toy', 'game', 'brinquedo', 'jogo'],
    };

    for (const [category, keywords] of Object.entries(categoryKeywords)) {
      if (keywords.some((keyword) => haystack.includes(keyword)) && availableCategories.includes(category)) {
        return category;
      }
    }

    console.warn(`[SICOSI] Could not identify category for "${productInfo.name || 'produto'}", using fallback`);
    return availableCategories[0] || 'electronics';
  }

  calculateScore(productInfo = {}, category) {
    const scoreBase = 50;
    const signalBoost = productInfo.hasEcoLabel ? 20 : 0;
    const durabilityBoost = productInfo.durabilityScore || 0;
    const finalScore = Math.max(0, Math.min(100, scoreBase + signalBoost + durabilityBoost));

    return {
      sustainability_score: finalScore,
      summary: 'Avaliação automática do produto baseada em dados disponíveis.',
      strengths: ['Durabilidade avaliada', 'Consideração de certificações'],
      weaknesses: ['Dados limitados disponíveis publicamente'],
      recommendations: ['Validar informações com o fornecedor', 'Verificar certificações oficiais'],
      category,
    };
  }

  async analyzeProduct(productInfo) {
    const detectedCategory = this.detectCategory(productInfo);
    const score = this.calculateScore(productInfo, detectedCategory);
    const categoryData = this.alternatives[detectedCategory] || {};

    return {
      success: true,
      category: detectedCategory,
      analysis: {
        sustainability_score: score.sustainability_score,
        category: detectedCategory,
        summary: score.summary,
        strengths: score.strengths,
        weaknesses: score.weaknesses,
        recommendations: score.recommendations,
      },
      alternatives: categoryData.alternatives || [],
      productInfo,
    };
  }
}

module.exports = {
  SustainabilityEngine,
};

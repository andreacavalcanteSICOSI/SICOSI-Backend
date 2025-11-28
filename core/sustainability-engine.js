(() => {
  class SustainabilityEngine {
    constructor() {
      this.backendUrl = typeof window !== 'undefined' && window.SICOSI_BACKEND_URL
        ? window.SICOSI_BACKEND_URL
        : (typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost:3000');

      this.initialized = false;
      this.alternatives = null;
    }

    async initialize() {
      if (this.initialized) return;

      // Modo backend-only - sem arquivos locais
      this.alternatives = {
        categories: {
          general: {
            name: 'General Products',
            keywords: [],
            sustainability_criteria: {},
            certifications: []
          }
        }
      };
      this.initialized = true;
      console.log('✅ SustainabilityEngine initialized (backend-only mode)');
      console.log('🌐 Backend URL:', this.backendUrl);
    }

    async detectUserLanguage() {
      try {
        if (typeof navigator !== 'undefined') {
          const browserLanguage = navigator.language || (navigator.languages && navigator.languages[0]);
          return browserLanguage || 'pt-BR';
        }
      } catch (error) {
        console.warn('⚠️ Could not detect user language, defaulting to pt-BR', error);
      }

      return 'pt-BR';
    }

    async analyzeProduct(productInfo) {
      await this.initialize();
      console.log('🔍 Starting sustainability analysis...', productInfo);
      console.log('🌐 Calling backend:', `${this.backendUrl}/api/analyze-product`);

      let category = null;

      try {
        const userCountry = typeof window !== 'undefined' && typeof window.detectUserCountry === 'function'
          ? await window.detectUserCountry()
          : 'BR';

        const userLanguage = await this.detectUserLanguage();

        category = this.identifyCategory(productInfo);
        console.log('📂 [FRONTEND] Category identified:', category || 'none (backend will decide)');

        const requestBody = {
          productInfo: {
            productName: productInfo.productName || productInfo.selectedText || '',
            description: productInfo.description || '',
            pageUrl: productInfo.pageUrl || (typeof window !== 'undefined' ? window.location.href : ''),
            pageTitle: productInfo.pageTitle || (typeof document !== 'undefined' ? document.title : ''),
            selectedText: productInfo.selectedText || '',
            pageContext: productInfo.pageContext || ''
          },
          category: category || undefined,
          userCountry: productInfo.userCountry || userCountry,
          userLanguage: productInfo.userLanguage || userLanguage
        };

        console.log('📤 [FRONTEND] Sending request:', JSON.stringify(requestBody, null, 2));

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
          const response = await fetch(`${this.backendUrl}/api/analyze-product`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          console.log('📥 Response status:', response.status, response.statusText);

          if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Backend error response:', errorText);
            throw new Error(`Backend error: ${response.status} - ${response.statusText}`);
          }

          const result = await response.json();
          console.log('✅ Analysis result:', result);
          return result;
        } catch (fetchError) {
          clearTimeout(timeoutId);
          throw fetchError;
        }
      } catch (error) {
        console.error('❌ Error during sustainability analysis:', error);

        return {
          product_name: productInfo.productName || productInfo.selectedText || 'Produto não identificado',
          category: category || 'general',
          sustainability_score: 0,
          summary: `Não foi possível conectar ao servidor de análise. Erro: ${error.message}. Por favor, verifique sua conexão ou tente novamente mais tarde.`,
          environmental_impact: {
            carbon_footprint: 'Análise indisponível',
            water_usage: 'Análise indisponível',
            recyclability: 'Análise indisponível'
          },
          strengths: ['Análise temporariamente indisponível'],
          weaknesses: ['Não foi possível analisar o produto no momento'],
          certifications_found: [],
          recommendations: [
            'Tente novamente em alguns instantes',
            'Verifique sua conexão com a internet',
            'Pesquise manualmente sobre a sustentabilidade deste produto'
          ],
          alternatives: [],
          timestamp: new Date().toISOString(),
          fallback: true,
          originalError: error.message
        };
      }
    }

    identifyCategory(productInfo) {
      if (!this.alternatives?.categories) {
        console.warn('⚠️ [CATEGORY] No categories config available');
        return null;
      }

      const text = `
        ${productInfo.selectedText || ''}
        ${productInfo.productName || ''}
        ${productInfo.pageTitle || ''}
        ${productInfo.description || ''}
        ${productInfo.pageContext || ''}
      `.toLowerCase().trim();

      let bestMatch = { category: null, score: 0 };
      console.log('🔍 [CATEGORY] Analyzing text:', text.substring(0, 200));

      for (const [categoryKey, categoryData] of Object.entries(this.alternatives.categories)) {
        const keywords = categoryData.keywords || [];
        const productTypes = categoryData.product_types || [];
        const allKeywords = [...keywords, ...productTypes];

        let score = 0;

        for (const keyword of allKeywords) {
          if (!keyword) continue;

          const keywordLower = keyword.toLowerCase();
          const escapedKeyword = keywordLower.replace(/[.*+?^${}()|[\]\\]/g, '\$&');
          const wordBoundaryRegex = new RegExp(`\\b${escapedKeyword}\\b`, 'i');

          if (wordBoundaryRegex.test(text)) {
            score += 3;
            console.log(`  ✓ Full match: "${keyword}" in category "${categoryKey}"`);
          } else if (text.includes(keywordLower)) {
            score += 1;
            console.log(`  ~ Partial match: "${keyword}" in category "${categoryKey}"`);
          }
        }

        const exclusions = categoryData.exclusion_keywords || [];
        for (const exclusion of exclusions) {
          if (!exclusion) continue;

          const exclusionLower = exclusion.toLowerCase();
          if (text.includes(exclusionLower)) {
            score = 0;
            console.log(`  ✕ Exclusion found: "${exclusion}" in category "${categoryKey}"`);
            break;
          }
        }

        if (score > bestMatch.score) {
          bestMatch = { category: categoryKey, score };
        }
      }

      console.log(`📂 [CATEGORY] Best match: "${bestMatch.category}" (score: ${bestMatch.score})`);

      if (bestMatch.score === 0 || !bestMatch.category) {
        console.warn('⚠️ [CATEGORY] No confident match, letting backend decide');
        return null;
      }

      return bestMatch.category;
    }

    getCategoryInfo(categoryKey) {
      return this.alternatives?.categories?.[categoryKey] || null;
    }

    getAllCategories() {
      return this.alternatives?.categories || {};
    }
  }

  window.SustainabilityEngine = SustainabilityEngine;
  window.sustainabilityEngine = new SustainabilityEngine();

  console.log('✅ SustainabilityEngine loaded');
})();

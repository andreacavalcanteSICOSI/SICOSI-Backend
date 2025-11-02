const Groq = require("groq-sdk");
const axios = require("axios");

/**
 * Transforma qualquer JSON da IA no formato esperado
 */
function normalizeAIResponse(aiJSON, productType) {
  if (aiJSON.alternatives && Array.isArray(aiJSON.alternatives)) {
    return aiJSON;
  }

  const alternatives = [];
  let products = [];
  
  if (aiJSON.notebooks) products = aiJSON.notebooks;
  else if (aiJSON.produtos) products = aiJSON.produtos;
  else if (aiJSON.alternatives) products = aiJSON.alternatives;
  else if (aiJSON.products) products = aiJSON.products;
  else if (Array.isArray(aiJSON)) products = aiJSON;

  for (const product of products) {
    const name = product.nome || product.name || product.produto || 
                 `${productType} sustentável`;
    
    const benefits = [];
    
    if (product.beneficios) {
      benefits.push(...product.beneficios);
    } else if (product.benefits) {
      benefits.push(...product.benefits);
    } else if (product.caracteristicas) {
      const carac = product.caracteristicas;
      if (carac.certificacao) benefits.push(`Certificação ${carac.certificacao}`);
      if (carac.economia) benefits.push(carac.economia);
      if (carac.reciclavel) benefits.push(`${carac.reciclavel} materiais recicláveis`);
    }

    if (benefits.length === 0) {
      benefits.push("Produto com características sustentáveis");
      benefits.push("Certificação ambiental");
      benefits.push("Redução de impacto ambiental");
    }

    alternatives.push({
      name: name,
      benefits: benefits.slice(0, 4),
      searchTerms: [name.toLowerCase(), `${productType} sustentável`]
    });
  }

  if (alternatives.length === 0) {
    alternatives.push({
      name: `${productType} com certificação EPEAT Gold`,
      benefits: [
        "Certificação EPEAT Gold verificada",
        "Reduz consumo de energia em até 30%",
        "85% materiais recicláveis",
        "Programa de logística reversa"
      ],
      searchTerms: [`${productType} EPEAT`, `${productType} certificado`]
    });
  }

  return {
    isSustainable: false,
    reason: aiJSON.reason || aiJSON.razao || 
            `${productType} convencional - considere alternativas certificadas`,
    alternatives: alternatives.slice(0, 3)
  };
}

async function searchDuckDuckGo(query) {
  try {
    console.log("🔍 Buscando no DuckDuckGo:", query);

    const response = await axios.get("https://api.duckduckgo.com/", {
      params: {
        q: query,
        format: "json",
        no_html: 1,
        skip_disambig: 1,
      },
      timeout: 5000,
    });

    const data = response.data;
    const results = [];

    if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      data.RelatedTopics.forEach((topic) => {
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.substring(0, 100),
            snippet: topic.Text,
            url: topic.FirstURL,
          });
        }
      });
    }

    if (data.Abstract && data.AbstractURL) {
      results.unshift({
        title: data.Heading || "Resultado principal",
        snippet: data.Abstract,
        url: data.AbstractURL,
      });
    }

    console.log(`✅ Encontrados ${results.length} resultados`);
    return results.slice(0, 5);
  } catch (error) {
    console.error("❌ Erro ao buscar no DuckDuckGo:", error.message);
    return [];
  }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { prompt, productInfo, context } = req.body;

    if (!prompt || !productInfo) {
      return res.status(400).json({
        error: "prompt e productInfo são obrigatórios",
      });
    }

    const productType = productInfo.type || "produto";

    console.log("📦 Produto:", productInfo.description);
    console.log("🏷️ Tipo:", productType);

    const searchQuery = `${productType} sustentável certificado EPEAT Energy Star FSC 2024 2025`;
    const webResults = await searchDuckDuckGo(searchQuery);

    const webContext =
      webResults.length > 0
        ? webResults
            .map(
              (result, index) =>
                `[${index + 1}] ${result.title}\n   ${result.snippet}\n   URL: ${result.url}`
            )
            .join("\n\n")
        : "Nenhum resultado encontrado na web.";

    console.log("📊 Contexto web gerado");

    const enrichedPrompt = `${prompt}

═══════════════════════════════════════════════════════════════
RESULTADOS DA BUSCA NA WEB:
═══════════════════════════════════════════════════════════════

${webContext}

═══════════════════════════════════════════════════════════════
INSTRUÇÕES:
═══════════════════════════════════════════════════════════════

1. Use produtos dos resultados acima
2. Mantenha o tipo "${productType}"
3. Extraia marca, modelo e certificação
4. Priorize certificações ambientais`;

    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });

    console.log("🤖 Enviando para Groq com contexto web...");

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: context?.role 
            ? `${context.role}. Use os resultados da busca web. Responda sempre em formato JSON.`
            : "Você é um especialista em produtos sustentáveis. Use os resultados da busca web. Responda sempre em formato JSON."
        },
        {
          role: "user",
          content: enrichedPrompt + "\n\nResponda em formato JSON com lista de produtos sustentáveis."
          // ↑ PALAVRA "JSON" ADICIONADA AQUI!
        }
      ],
      temperature: 0.7,
      max_tokens: 2000,
      response_format: { type: "json_object" }
    });

    const aiResponse = completion.choices[0].message.content;

    let aiJSON;
    try {
      aiJSON = JSON.parse(aiResponse);
    } catch (parseError) {
      console.error("❌ Erro ao parsear:", parseError);
      return res.status(500).json({
        error: "Erro ao processar resposta da IA",
        rawResponse: aiResponse,
      });
    }

    console.log("📄 JSON recebido da IA");

    const normalizedResponse = normalizeAIResponse(aiJSON, productType);

    normalizedResponse._meta = {
      webResultsCount: webResults.length,
      searchQuery: searchQuery,
      source: "web-search-enhanced",
      model: "llama-3.3-70b-versatile",
    };

    console.log("✅ Resposta processada com sucesso");

    return res.status(200).json(normalizedResponse);
  } catch (error) {
    console.error("❌ Erro no web-search-proxy:", error);
    return res.status(500).json({
      error: "Erro interno do servidor",
      message: error.message,
    });
  }
};
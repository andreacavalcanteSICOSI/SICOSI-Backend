const Groq = require("groq-sdk");
const axios = require("axios");

/**
 * Extrai JSON de uma resposta que pode conter texto adicional
 */
function extractJSON(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    // Continuar tentando extrair
  }
  
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      throw new Error('JSON inválido encontrado');
    }
  }
  
  throw new Error('Nenhum JSON encontrado na resposta');
}

/**
 * Busca no DuckDuckGo (free, sem API key)
 */
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
          content: "Você é um especialista em produtos sustentáveis. Use os resultados da busca web. Responda SEMPRE no formato JSON especificado.",
        },
        {
          role: "user",
          content: `${enrichedPrompt}

FORMATO OBRIGATÓRIO DA RESPOSTA (copie esta estrutura exatamente):

{
  "isSustainable": false,
  "reason": "Breve explicação em português",
  "alternatives": [
    {
      "name": "Nome completo do produto com marca e modelo",
      "benefits": [
        "Benefício 1 com dados mensuráveis",
        "Benefício 2 com dados mensuráveis",
        "Benefício 3 com dados mensuráveis"
      ],
      "searchTerms": [
        "termo de busca 1",
        "termo de busca 2"
      ]
    }
  ]
}

CRÍTICO:
- Não adicione texto antes ou depois do JSON
- Use exatamente os campos mostrados
- alternatives deve ter 2-3 produtos do tipo "${productType}"
- Todos os campos são obrigatórios`,
        },
      ],
      temperature: 0,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    });

    const aiResponse = completion.choices[0].message.content;

    let parsedResponse;
    try {
      parsedResponse = extractJSON(aiResponse);
    } catch (parseError) {
      console.error("❌ Erro ao parsear:", parseError);
      console.error("Resposta bruta:", aiResponse);
      return res.status(500).json({
        error: "Erro ao processar resposta da IA",
        rawResponse: aiResponse,
      });
    }

    parsedResponse._meta = {
      webResultsCount: webResults.length,
      searchQuery: searchQuery,
      source: "web-search-enhanced",
      model: "llama-3.3-70b-versatile",
    };

    console.log("✅ Resposta processada com sucesso");

    return res.status(200).json(parsedResponse);
    
  } catch (error) {
    console.error("❌ Erro no web-search-proxy:", error);
    return res.status(500).json({
      error: "Erro interno do servidor",
      message: error.message,
    });
  }
};
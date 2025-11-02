const Groq = require("groq-sdk");

/**
 * Transforma qualquer JSON da IA no formato esperado
 */
function normalizeAIResponse(aiJSON, productType) {
  // Se já estiver no formato correto
  if (aiJSON.alternatives && Array.isArray(aiJSON.alternatives)) {
    return aiJSON;
  }

  const alternatives = [];

  // Tentar extrair de diferentes formatos
  let products = [];
  
  if (aiJSON.notebooks) products = aiJSON.notebooks;
  else if (aiJSON.produtos) products = aiJSON.produtos;
  else if (aiJSON.alternatives) products = aiJSON.alternatives;
  else if (aiJSON.products) products = aiJSON.products;
  else if (Array.isArray(aiJSON)) products = aiJSON;

  // Transformar para o formato esperado
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
    
    if (!prompt) {
      return res.status(400).json({ error: "prompt é obrigatório" });
    }

    console.log("📦 Analisando produto:", productInfo?.description || "N/A");
    console.log("🏷️ Tipo:", productInfo?.type || "N/A");

    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: context?.role 
            ? `${context.role}. Responda sempre em formato JSON.`
            : "Você é um especialista em sustentabilidade. Responda sempre em formato JSON."
        },
        {
          role: "user",
          content: prompt + "\n\nResponda em formato JSON com lista de produtos sustentáveis."
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
      console.error("❌ Erro ao parsear JSON:", parseError);
      return res.status(500).json({
        error: "Erro ao processar resposta da IA",
        rawResponse: aiResponse,
      });
    }

    console.log("📄 JSON recebido da IA");

    const productType = productInfo?.type || 'produto';
    const normalizedResponse = normalizeAIResponse(aiJSON, productType);

    console.log("✅ Resposta normalizada com sucesso");

    return res.status(200).json(normalizedResponse);
    
  } catch (error) {
    console.error("❌ Erro no groq-proxy:", error);
    return res.status(500).json({
      error: "Erro interno do servidor",
      message: error.message,
    });
  }
};
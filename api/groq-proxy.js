const Groq = require("groq-sdk");

/**
 * Converte resposta em texto da IA para JSON estruturado
 */
function parseAITextToJSON(text, productType) {
  // Se já vier JSON, usar direto
  try {
    return JSON.parse(text);
  } catch (e) {
    // Ignorar, vamos parsear o texto
  }

  // Extrair alternativas do texto
  const alternatives = [];
  
  // Padrões comuns que a IA usa
  const patterns = [
    /\*\*(.+?)\*\*/g,  // **Nome do Produto**
    /\d+\.\s+\*\*(.+?)\*\*/g,  // 1. **Nome do Produto**
    /\d+\.\s+(.+?):/g,  // 1. Nome do Produto:
  ];

  let matches = [];
  for (const pattern of patterns) {
    const found = [...text.matchAll(pattern)];
    if (found.length > 0) {
      matches = found;
      break;
    }
  }

  // Processar matches
  for (const match of matches) {
    const name = match[1].trim();
    
    // Extrair texto após o nome até o próximo produto
    const startIndex = text.indexOf(match[0]);
    const nextMatch = matches[matches.indexOf(match) + 1];
    const endIndex = nextMatch ? text.indexOf(nextMatch[0]) : text.length;
    const description = text.substring(startIndex, endIndex);

    // Extrair benefícios (linhas que mencionam características)
    const benefits = [];
    const lines = description.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && 
          (trimmed.includes('%') || 
           trimmed.includes('certific') || 
           trimmed.includes('sustent') ||
           trimmed.includes('recicl') ||
           trimmed.includes('energia'))) {
        benefits.push(trimmed.replace(/^[-•*]\s*/, ''));
      }
    }

    if (benefits.length === 0) {
      // Benefícios padrão
      benefits.push(`Produto ${name} com características sustentáveis`);
      benefits.push("Certificação ambiental verificável");
      benefits.push("Redução de impacto ambiental");
    }

    alternatives.push({
      name: name,
      benefits: benefits.slice(0, 4), // Máximo 4 benefícios
      searchTerms: [name.toLowerCase(), `${productType} sustentável`]
    });
  }

  // Se não encontrou nada, gerar fallback
  if (alternatives.length === 0) {
    alternatives.push({
      name: `${productType} com certificação ambiental`,
      benefits: [
        "Certificação EPEAT ou Energy Star",
        "Redução no consumo de energia",
        "Materiais recicláveis",
        "Programa de logística reversa"
      ],
      searchTerms: [`${productType} certificado`, `${productType} sustentável`]
    });
  }

  return {
    isSustainable: false,
    reason: `${productType} convencional - considere alternativas certificadas`,
    alternatives: alternatives.slice(0, 3) // Máximo 3 alternativas
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
          content: context?.role || "Você é um especialista em sustentabilidade e compras públicas."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 2000
    });
    
    const aiResponse = completion.choices[0].message.content;
    
    console.log("📄 Resposta da IA recebida");

    // Parsear texto para JSON
    const productType = productInfo?.type || 'produto';
    const parsedResponse = parseAITextToJSON(aiResponse, productType);

    console.log("✅ Resposta processada com sucesso");

    return res.status(200).json(parsedResponse);
    
  } catch (error) {
    console.error("❌ Erro no groq-proxy:", error);
    return res.status(500).json({
      error: "Erro interno do servidor",
      message: error.message,
    });
  }
};
const Groq = require("groq-sdk");
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
            ? `${context.role}. IMPORTANTE: Responda APENAS com JSON válido, sem texto adicional, sem markdown, sem explicações. Apenas o objeto JSON puro.`
            : "Você é um especialista em sustentabilidade e compras públicas. IMPORTANTE: Responda APENAS com JSON válido, sem texto adicional, sem markdown, sem explicações.",
        },
        {
          role: "user",
          content:
            prompt +
            "\n\nRESPONDA APENAS COM JSON VÁLIDO, SEM TEXTO ADICIONAL. NÃO USE ```json NEM MARKDOWN.",
        },
      ],
      temperature: 0,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    });

    const aiResponse = completion.choices[0].message.content;

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(aiResponse);
    } catch (parseError) {
      console.error("❌ Erro ao parsear JSON:", parseError);
      return res.status(500).json({
        error: "Erro ao processar resposta da IA",
        rawResponse: aiResponse,
      });
    }

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

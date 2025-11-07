// pages/api/health.js
export default function handler(req, res) {
  res.status(200).json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      tavily: !!process.env.TAVILY_API_KEY,
      groq: !!process.env.GROQ_API_KEY
    },
    version: '3.0.0'
  });
}
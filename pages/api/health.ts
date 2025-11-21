// pages/api/health.ts
import type { NextApiRequest, NextApiResponse } from 'next';

interface HealthResponse {
  success: boolean;
  status: string;
  timestamp: string;
  services: {
    tavily: boolean;
    groq: boolean;
  };
  version: string;
}

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<HealthResponse>
): void {
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
// Em pages/api/clear-cache.ts (criar novo arquivo)
import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from 'redis';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const redisClient = createClient({ url: redisUrl });
    
    await redisClient.connect();
    await redisClient.flushDb(); // Limpa todo o cache
    await redisClient.disconnect();

    return res.status(200).json({ 
      success: true, 
      message: 'Cache cleared successfully' 
    });
  } catch (error) {
    return res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
}
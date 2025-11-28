import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
    const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!upstashUrl || !upstashToken) {
      return res.status(500).json({ 
        success: false, 
        error: 'Upstash Redis not configured' 
      });
    }

    // ✅ Usar a REST API do Upstash para limpar o cache
    const response = await fetch(`${upstashUrl}/flushdb`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${upstashToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Upstash error: ${response.statusText}`);
    }

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
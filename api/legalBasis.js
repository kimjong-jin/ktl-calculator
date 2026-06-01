// GET /api/legalBasis?item=TU — 측정항목 법령근거·정도검사기준 조회
import { getLegalBasis, supportedItems } from '../src/lawMapping.js';

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const item = (req.query.item || '').toString().trim();
  if (!item) {
    return res.status(400).json({ error: 'item 파라미터가 필요합니다.', supported: supportedItems() });
  }

  try {
    const data = await getLegalBasis(item);
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '법령근거 조회에 실패했습니다.';
    return res.status(400).json({ error: msg });
  }
}

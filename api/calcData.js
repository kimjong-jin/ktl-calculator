/**
 * /api/calcData — 정도검사 계산 데이터 저장/불러오기 프록시
 * Mac Studio SQLite ↔ 계산기 클라이언트
 *
 * GET  /api/calcData?receiptNo=xxx&userName=yyy         → 불러오기
 * GET  /api/calcData?action=list&token=adminToken       → 목록 (관리자)
 * GET  /api/calcData?action=byReceipt&receiptNo=xxx&token=jwt → 접수번호만으로 불러오기 (관리자)
 * POST /api/calcData                                    → 저장
 * DELETE /api/calcData?receiptNo=xxx&userName=yyy&token → 삭제 (관리자)
 */
import { verifyToken } from '../src/authService.js';
import { revokeTokenByReceiptNo } from '../src/tokenStore.js';

const BASE          = (process.env.MAC_STUDIO_URL || process.env.LOCATION_SERVER_URL || '').replace(/\/$/, '');
const STUDIO_SECRET = process.env.STUDIO_SECRET || '';
const ADMIN_TOKEN   = process.env.AUTH_SECRET    || '';  // Vercel 환경변수 AUTH_SECRET 사용

function requireAdmin(req, res) {
  const token = req.query.token || req.headers['x-admin-token'] || '';
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    res.status(401).json({ error: '관리자 인증 필요' });
    return false;
  }
  return true;
}

function isAdminJwt(req) {
  const token = req.query.token || req.headers['x-admin-token'] || '';
  try {
    const result = verifyToken(token);
    return result.valid && result.role === 'admin';
  } catch { return false; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-admin-token');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!BASE) return res.status(503).json({ error: 'MAC_STUDIO_URL 환경변수가 설정되지 않았습니다.' });

  try {
    let url;
    const options = {
      method: req.method === 'DELETE' ? 'DELETE' : req.method,
      headers: { 'Content-Type': 'application/json', 'x-studio-secret': STUDIO_SECRET },
    };

    if (req.method === 'GET') {
      const { action, receiptNo, userName } = req.query;

      if (action === 'list') {
        if (!isAdminJwt(req) && !requireAdmin(req, res)) return;
        url = `${BASE}/api/calc/list`;
        options.headers['x-studio-secret'] = STUDIO_SECRET;

      } else if (action === 'byReceipt') {
        if (!isAdminJwt(req)) return res.status(401).json({ error: '관리자 JWT 인증 필요' });
        if (!receiptNo) return res.status(400).json({ error: 'receiptNo 필수' });
        // 목록에서 receiptNo로 찾은 뒤 해당 레코드 fetch
        const listRes = await fetch(`${BASE}/api/calc/list`, {
          headers: { 'x-studio-secret': STUDIO_SECRET },
          signal: AbortSignal.timeout(8000),
        });
        const listData = await listRes.json();
        const items = Array.isArray(listData) ? listData : (listData.items || []);
        const found = items.find(it => it.receiptNo === receiptNo || it.receipt_no === receiptNo);
        if (!found) return res.status(404).json({ error: '해당 접수번호의 저장 데이터가 없습니다.' });
        const foundUser = found.userName || found.user_name || '';
        const recRes = await fetch(
          `${BASE}/api/calc?receiptNo=${encodeURIComponent(receiptNo)}&userName=${encodeURIComponent(foundUser)}`,
          { headers: { 'x-studio-secret': STUDIO_SECRET }, signal: AbortSignal.timeout(8000) }
        );
        const recData = await recRes.json();
        return res.status(recRes.status).json({ ...recData, userName: foundUser });

      } else {
        if (!receiptNo || !userName)
          return res.status(400).json({ error: 'receiptNo, userName 필수' });
        url = `${BASE}/api/calc?receiptNo=${encodeURIComponent(receiptNo)}&userName=${encodeURIComponent(userName)}`;
      }

    } else if (req.method === 'POST') {
      const { receiptNo, userName } = req.body || {};
      if (!receiptNo || !userName)
        return res.status(400).json({ error: 'receiptNo, userName 필수' });
      url = `${BASE}/api/calc`;
      options.body = JSON.stringify(req.body);

    } else if (req.method === 'DELETE') {
      if (!isAdminJwt(req) && !requireAdmin(req, res)) return;
      const { receiptNo, userName } = req.query;
      if (!receiptNo) return res.status(400).json({ error: 'receiptNo 필수' });
      const qs = userName ? `?userName=${encodeURIComponent(userName)}` : '';
      url = `${BASE}/api/calc/${encodeURIComponent(receiptNo)}${qs}`;
      options.headers['x-studio-secret'] = STUDIO_SECRET;

    } else {
      return res.status(405).end();
    }

    const upstream = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
    const data = await upstream.json();

    // 담당자/접수번호 변경 시: 새 신원으로 저장 성공 후 옛 레코드 제자리 이전(삭제) — 중복 누적 방지.
    // 오용 방지: 접수번호 또는 담당자 중 하나는 공유될 때만(= 진짜 이름/접수 정정) 옛 행 삭제.
    if (req.method === 'POST' && upstream.ok) {
      const prev = req.body && req.body.prev;
      const nr = req.body.receiptNo, nu = req.body.userName;
      if (prev && prev.receiptNo && prev.userName &&
          (prev.receiptNo !== nr || prev.userName !== nu) &&
          (prev.receiptNo === nr || prev.userName === nu)) {
        fetch(`${BASE}/api/calc/${encodeURIComponent(prev.receiptNo)}?userName=${encodeURIComponent(prev.userName)}`,
          { method: 'DELETE', headers: { 'x-studio-secret': STUDIO_SECRET }, signal: AbortSignal.timeout(8000) }).catch(() => {});
      }
    }

    // 계산 데이터 삭제 성공 시 Blob 접속 토큰도 함께 무효화
    if (req.method === 'DELETE' && upstream.ok) {
      const { receiptNo } = req.query;
      revokeTokenByReceiptNo(receiptNo).catch(() => {});
    }


    return res.status(upstream.status).json(data);

  } catch (e) {
    return res.status(502).json({ error: `Mac Studio 연결 실패: ${e.message}` });
  }
}

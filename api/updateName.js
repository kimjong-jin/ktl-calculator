/**
 * /api/updateName — 사용자가 본인 이름(유지관리담당자) 정정 시 서버에 영속화.
 *   POST { name }  with Authorization: Bearer <세션 토큰>
 * 세션 토큰의 id = 접속 코드 tokenId → 해당 토큰의 applicantName 갱신.
 * 이걸 안 하면 이름 변경이 localStorage에만 남아 다음 로그인에 원래 이름이 다시 뜸.
 */
import { verifyToken } from '../src/authService.js';
import { updateApplicantName } from '../src/tokenStore.js';

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 1e4) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  const auth = (req.headers && req.headers['authorization']) || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const r = verifyToken(token);
  if (!r.valid || !r.id) return res.status(401).json({ error: '인증 필요' });

  const body = await readBody(req);
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 40) : '';
  if (!name) return res.status(400).json({ error: 'name 필수' });

  try {
    const syncRes = await updateApplicantName(r.id, name);
    if (!syncRes) return res.status(404).json({ error: '토큰을 찾을 수 없음' });

    // 접수번호와 구 사용자명이 존재하고 변경된 경우 Mac Studio DB 연동 업데이트 호출
    if (syncRes.receiptNo && syncRes.oldName && syncRes.oldName !== name) {
      const BASE = (process.env.MAC_STUDIO_URL || process.env.LOCATION_SERVER_URL || '').replace(/\/$/, '');
      const STUDIO_SECRET = process.env.STUDIO_SECRET || '';
      if (BASE) {
        const signal = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(5000) : undefined;
        fetch(`${BASE}/api/calc/rename`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-studio-secret': STUDIO_SECRET
          },
          body: JSON.stringify({
            receiptNo: syncRes.receiptNo,
            oldUserName: syncRes.oldName,
            newUserName: name
          }),
          signal
        }).catch(err => console.error('[updateName] Mac Studio rename fetch error:', err));
      }
    }

    return res.status(200).json({ ok: true, name });
  } catch (e) {
    return res.status(503).json({ error: '저장 실패' });
  }
}

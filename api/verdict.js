/**
 * /api/verdict — 정도검사 판정 API (계산 단일 출처).
 * precision.js(고시 기준값 = precision-criteria.json, 엑셀 sync) 기반 computeVerdict 를 노출한다.
 * 계산 로직은 계산기(이 저장소)에만 존재하며, parser.work 등 외부는 이 API를 호출해 판정만 받는다.
 * → 고시 개정 시 Version11 엑셀 → sync-excel → 여기 자동 반영. 호출측(parser)은 손 안 댐.
 *
 * POST { code, fields }                 → { ok, code, checks, pass, field }
 * POST { items: [{ code, fields }, …] } → { ok, results: [...] }   (한 접수번호 여러 항목)
 *   code   : TOC/TN/TP/SS/PH/DO/COD/TU/CL
 *   fields : calc_data.data.fields[tabId] 형태의 입력값 맵 (문자열/불린)
 *   pass   : 'ok'(적합) | 'bad'(부적합) | ''(미완성)  — 정도검사 종합
 *   field  : 현장적용계수 결과(있을 때), 정도검사 종합엔 미포함
 */
import { computeVerdict } from '../src/computeVerdict.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    if (Array.isArray(body.items)) {
      const results = body.items.map(it => {
        if (!it || !it.code) return { error: 'code 필요' };
        return computeVerdict(String(it.code).toUpperCase(), it.fields || {});
      });
      return res.status(200).json({ ok: true, results });
    }

    if (body.code) {
      const result = computeVerdict(String(body.code).toUpperCase(), body.fields || {});
      return res.status(200).json({ ok: true, ...result });
    }

    return res.status(400).json({ ok: false, error: 'code(항목) 또는 items 필요' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

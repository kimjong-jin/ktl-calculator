/**
 * /api/lawChat — 수질TMS 정도검사 전문 AI 챗봇 (Gemini + 지식베이스 + 국가법령정보).
 * POST { message, history? } → { reply, lawRef?, knowledgeUsed?, tokens? }
 */
import { searchKnowledge } from '../src/knowledgeBase.js';

const MODEL = "gemini-2.5-flash";
const TIMEOUT_MS = 30_000;
const LAW_BASE = "https://www.law.go.kr/DRF";

const SYSTEM = `당신은 대한민국 수질TMS(수질원격감시시스템) 정도검사 전문 AI입니다.
KTL(한국기계전기전자시험연구원) 수질TMS 정도검사 서비스를 지원합니다.

[핵심 전문 지식]

■ 근거 법령
- 물환경보전법 제38조의2 (수질자동측정기기 설치·운영)
- 환경부 고시 "수질오염공정시험기준" (ES 04000)
- 환경부 고시 "수질TMS 부착사업장 정도검사 방법 및 기준"
- 대기환경보전법 준용 조항 (자동측정기기 관련)

■ 정도검사 항목별 합격 기준 (환경부 고시 별표3)
- 반복성(Repeatability): RSD ≤ 3.0% (저농도·고농도 각 3회 측정)
- 제로드리프트: ≤ 5.0% (4시간 전후 차이 / 측정범위)
- 스팬드리프트: ≤ 5.0% (4시간 전후 차이 / 측정범위)
- 직선성(Linearity): ≤ 5.0% (기준값 대비 오차율, 기준값 = 0.9×범위÷2)
- 현장적용성: ≤ 5.0%

■ 검사 대상 항목 및 적용 기준
- TOC (총유기탄소): 오차율 ±10%, 단위 mg/L, 수수료 854,000원
- TN (총질소): 오차율 ±10%, 단위 mg/L, 수수료 851,000원
- TP (총인): 오차율 ±10%, 단위 mg/L, 수수료 851,000원
- SS (부유물질): 오차율 ±10%, 단위 mg/L, 수수료 698,000원
- COD (화학적산소요구량): 오차율 ±10%, 단위 mg/L, 수수료 851,000원
- pH (수소이온농도): 절대편차 ±0.3, 범위 pH 0~14, 수수료 651,000원
- DO (용존산소): 절대편차 ±0.5 mg/L, 수수료 421,000원
- TU (탁도): 먹는물 정도검사 항목, 단위 NTU
- CL (잔류염소): 먹는물 정도검사 항목, 단위 mg/L

■ 정도검사 주기 및 절차
- 수질TMS 부착 사업장: 연 1회 이상
- 검사 순서: ① 반복성 → ② 드리프트 → ③ 직선성 → ④ 현장적용 → ⑤ 통합판정
- 검사기관: 환경부 지정 정도검사기관 (KTL 포함)

■ 수수료 계산 기준 (Version11 엑셀 기준)
- 기본 수수료 + 출장비(일비 25,000원, 식비 25,000원, 숙박비 지역별 상이)
- 서울/광역시 숙박비 100,000~80,000원, 기타 지역 70,000원

■ 중요 고시/기준
- 수질오염공정시험기준 ES 04000 시리즈
- 자동측정기기의 정도검사 방법 (환경부)
- 먹는물수질공정시험기준

답변 시 관련 법령·고시 조항과 수치 기준을 정확히 명시하세요.
불확실한 내용은 반드시 "확인 필요" 표시 후 관할 기관(국립환경과학원, 환경부) 문의를 권고하세요.
답변은 한국어로 작성하세요.`;

function getOC() { return process.env.LAW_OC || "kbisss_2026"; }

async function searchLaws(query) {
  try {
    const params = new URLSearchParams({ OC: getOC(), type: "XML", query });
    const res = await fetch(`${LAW_BASE}/lawSearch.do?${params}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const xml = await res.text();
    const names = [...xml.matchAll(/<법령명><!\[CDATA\[([^\]]+)\]\]><\/법령명>/g)].map(m => m[1]);
    const msts = [...xml.matchAll(/<법령일련번호>(\d+)<\/법령일련번호>/g)].map(m => m[1]);
    return names.slice(0, 2).map((name, i) => ({ name, mst: msts[i] })).filter(x => x.mst);
  } catch { return []; }
}

async function getLawText(mst) {
  try {
    const params = new URLSearchParams({ OC: getOC(), type: "XML", target: "law", MST: mst });
    const res = await fetch(`${LAW_BASE}/lawService.do?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return "";
    const xml = await res.text();
    const texts = [...xml.matchAll(/<조문내용><!\[CDATA\[([^\]]+)\]\]><\/조문내용>/g)].map(m => m[1]);
    return texts.slice(0, 4).join("\n").slice(0, 1500);
  } catch { return ""; }
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", c => { raw += c; if (raw.length > 1e5) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); } });
  });
}

export default async function handler(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용됩니다." });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "AI 서비스 키가 설정되지 않았습니다. 관리자에게 문의하세요." });

  const body = await readBody(req);
  const message = String(body?.message || "").trim();
  const history = Array.isArray(body?.history) ? body.history.slice(-10) : [];
  if (!message) return res.status(400).json({ error: "message 파라미터가 필요합니다." });

  // 관리자 등록 전문 지식 — 서버 env var(영구) + 요청 페이로드(세션)
  const envSkill = process.env.ADMIN_SKILL_CONTEXT || "";
  const reqSkill = typeof body?.adminSkill === "string" ? body.adminSkill.slice(0, 4000) : "";
  const combinedSkill = [envSkill, reqSkill].filter(Boolean).join("\n\n---\n\n");
  const systemPrompt = combinedSkill
    ? SYSTEM + `\n\n[관리자 등록 전문 지식 — 반드시 우선 적용]\n${combinedSkill}`
    : SYSTEM;

  // 1. 지식 베이스 검색 (로컬 Obsidian 노드)
  let knowledgeCtx = "", knowledgeUsed = false;
  try {
    const knNodes = searchKnowledge(message, 2);
    if (knNodes.length > 0) {
      knowledgeUsed = true;
      knowledgeCtx = "\n\n[KTL 지식 베이스]\n" +
        knNodes.map(n => `## ${n.title}\n${n.excerpt}`).join("\n\n---\n\n");
    }
  } catch { /* 지식 베이스 오류는 무시하고 진행 */ }

  // 2. 법령 실시간 조회 (law.go.kr)
  let lawConnected = false;
  const laws = await searchLaws(message);
  let lawCtx = "", lawRef = null;
  if (laws.length > 0) {
    const text = await getLawText(laws[0].mst);
    if (text) {
      lawConnected = true;
      lawRef = laws[0].name;
      lawCtx = `\n\n[참고 법령: ${laws[0].name}]\n${text}`;
    }
  }

  const userMessage = message + knowledgeCtx + lawCtx;
  const contents = [
    ...history.map(h => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.content }] })),
    { role: "user", parts: [{ text: userMessage }] },
  ];

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: { maxOutputTokens: 8192, temperature: 0.2 },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    );
    const data = await upstream.json();
    if (!upstream.ok) {
      const msg = data?.error?.message || "AI 응답 생성에 실패했습니다.";
      console.error("[lawChat] Gemini error:", JSON.stringify(data).slice(0, 200));
      return res.status(502).json({ error: `AI 오류: ${msg}` });
    }
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "응답을 생성하지 못했습니다.";
    const skillActive = !!(envSkill || reqSkill);
    const usage = data?.usageMetadata;
    const tokens = usage ? {
      input: usage.promptTokenCount ?? 0,
      output: usage.candidatesTokenCount ?? 0,
      total: usage.totalTokenCount ?? 0,
    } : null;
    return res.status(200).json({ reply, lawRef, lawConnected, knowledgeUsed, skillActive, tokens });
  } catch (e) {
    console.error("[lawChat]", e instanceof Error ? e.message : e);
    return res.status(502).json({ error: "AI 응답 생성에 실패했습니다. 잠시 후 다시 시도하세요." });
  }
}

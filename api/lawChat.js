/**
 * /api/lawChat — 수질TMS 정도검사 전문 AI 챗봇 (Gemini + 지식베이스 + 국가법령정보).
 * POST { message, history? } → { reply, lawRef?, knowledgeUsed?, tokens? }
 */
import { searchKnowledge } from '../src/knowledgeBase.js';

const MODEL = "gemini-2.5-flash";
const TIMEOUT_MS = 30_000;
const LAW_BASE = "https://www.law.go.kr/DRF";

const SYSTEM = `당신은 KTL(한국산업기술시험원, Korea Testing Laboratory) 환경측정기기 전문 AI입니다.

[KTL 서비스 범위]
1. 정도검사: 수질TMS(TOC·TN·TP·SS·COD·DO·pH), 먹는물(TU·CL) — 설치 후 주기적 수검
2. 성능시험(형식승인): 기본모델·파생모델·동일모델 — 출시 전 1회
3. 간이측정기 성능인증: 수질(DO·pH), 먹는물(TU·CL), 대기, 소음, 실내공기질 — 등급 판정

[답변 원칙]
1. [KTL 지식 베이스] 섹션이 제공되면 반드시 해당 내용을 최우선 근거로 사용하세요.
2. 지식 베이스의 수치·기준은 고시 원문에서 추출한 것이므로 절대 임의로 변경하지 마세요.
3. 법령 조항을 인용할 때는 조문 번호까지 명시하세요 (예: 환경분야 시험검사법 제11조).
4. 불확실한 내용은 "확인 필요" 표시 후 국립환경과학원·환경부 문의를 권고하세요.
5. 답변은 한국어로 작성하세요.
6. 답변 말미에 "※ 본 답변은 참고용이며, 중요한 사항은 반드시 법령 원문을 확인하시기 바랍니다." 를 항상 포함하세요.

[핵심 법령 체계]
- 환경분야 시험·검사 등에 관한 법률 제9조: 형식승인 의무
- 환경분야 시험·검사 등에 관한 법률 제9조의3: 간이측정기 성능인증
- 환경분야 시험·검사 등에 관한 법률 제11조: 정도검사 수검 의무 (직접 근거)
- 물환경보전법 제38조의3: 수질자동측정기기 설치 의무
- 환경측정기기의 형식승인·정도검사 등에 관한 고시: 항목별 기준·방법·주기·수수료`;

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
  let knowledgeCtx = "", knowledgeUsed = false, knowledgeVersion = "";
  try {
    const knNodes = searchKnowledge(message, 3);
    if (knNodes.length > 0) {
      knowledgeUsed = true;
      // 노드에서 시행일 추출 (가장 최신 날짜)
      const dates = knNodes.flatMap(n =>
        [...(n.excerpt || "").matchAll(/시행[：:]\s*(\d{4}-\d{2}-\d{2})/g)].map(m => m[1])
      ).sort().reverse();
      if (dates.length > 0) knowledgeVersion = dates[0];
      const versionNote = knowledgeVersion
        ? `\n\n[지식 베이스 기준: ${knowledgeVersion} 시행 법령]`
        : "";
      knowledgeCtx = "\n\n[KTL 지식 베이스]" + versionNote + "\n" +
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
    return res.status(200).json({ reply, lawRef, lawConnected, knowledgeUsed, knowledgeVersion, skillActive, tokens });
  } catch (e) {
    console.error("[lawChat]", e instanceof Error ? e.message : e);
    return res.status(502).json({ error: "AI 응답 생성에 실패했습니다. 잠시 후 다시 시도하세요." });
  }
}

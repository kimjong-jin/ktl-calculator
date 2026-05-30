/**
 * /api/lawChat — AI 법령 해석 챗봇 (Gemini 2.5-flash + 국가법령정보 통합).
 * POST { message: string, history?: [{role, content}] }
 * → { reply: string, lawRef?: string }
 *
 * 처리 흐름: 사용자 질문 → law.go.kr 에서 관련 법령 검색 → 법령 원문을 컨텍스트로 추가
 *           → Gemini가 법령을 근거로 답변 생성.
 * 법령 검색 실패 시 Gemini 훈련 지식만으로 답변(graceful degradation).
 */

const MODEL = "gemini-2.5-flash";
const TIMEOUT_MS = 30_000;
const LAW_BASE = "https://www.law.go.kr/DRF";

const SYSTEM = `당신은 대한민국 계측·정도검사 관련 법령 전문가 AI입니다.
계량에 관한 법률, 계량기검정기술기준, 정도검사 관련 고시, 환경오염공정시험기준,
대기환경측정기기 형식승인·정도검사 세부기준 등에 정통합니다.
사용자 질문에 관련 법령 조문을 인용하며 명확·전문적으로 답변하세요.
불확실한 법령 해석은 반드시 그렇다고 명시하고 관할 기관 확인을 권고하세요.
답변은 한국어로 작성하고, 근거 법령(법령명·조문)을 가능하면 명시하세요.`;

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
  if (!apiKey) return res.status(500).json({ error: "AI 서비스가 비활성화되었습니다. (관리자 문의)" });

  const body = await readBody(req);
  const message = String(body?.message || "").trim();
  const history = Array.isArray(body?.history) ? body.history.slice(-10) : [];
  if (!message) return res.status(400).json({ error: "message 파라미터가 필요합니다." });

  const laws = await searchLaws(message);
  let lawCtx = "";
  let lawRef = null;
  if (laws.length > 0) {
    const text = await getLawText(laws[0].mst);
    if (text) {
      lawRef = laws[0].name;
      lawCtx = `\n\n[참고 법령: ${laws[0].name}]\n${text}`;
    }
  }

  const contents = [
    ...history.map(h => ({
      role: h.role === "assistant" ? "model" : "user",
      parts: [{ text: h.content }],
    })),
    { role: "user", parts: [{ text: message + lawCtx }] },
  ];

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents,
          generationConfig: { maxOutputTokens: 1024, temperature: 0.3 },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    );
    const data = await upstream.json();
    if (!upstream.ok) {
      console.error("[lawChat] Gemini error:", JSON.stringify(data).slice(0, 200));
      return res.status(502).json({ error: "AI 응답 생성에 실패했습니다." });
    }
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "응답을 생성하지 못했습니다.";
    return res.status(200).json({ reply, lawRef });
  } catch (e) {
    console.error("[lawChat]", e instanceof Error ? e.message : e);
    return res.status(502).json({ error: "AI 응답 생성에 실패했습니다." });
  }
}

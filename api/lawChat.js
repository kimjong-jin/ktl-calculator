/**
 * /api/lawChat — 수질TMS 정도검사 전문 AI 챗봇 (Gemini + 지식베이스 + 국가법령정보).
 * POST { message, history? } → { reply, lawRef?, knowledgeUsed?, tokens? }
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { searchKnowledge } from '../src/knowledgeBase.js';
import { verifyToken } from '../src/authService.js';
import { checkAndIncrement } from '../src/chatRateLimit.js';
const _fsOk = existsSync(join(process.cwd(), 'knowledge'));

const MODEL = "gemini-2.5-flash";
const TIMEOUT_MS = 30_000;
const LAW_BASE = "https://www.law.go.kr/DRF";

const SYSTEM = `당신은 KTL(한국산업기술시험원, Korea Testing Laboratory) 환경측정기기 전문 AI입니다.

[KTL 서비스 범위]
1. 정도검사: 수질TMS(TOC·TN·TP·SS·COD·DO·pH), 먹는물(TU·CL) — 설치 후 주기적 수검
2. 성능시험(형식승인): 기본모델·파생모델·동일모델·예비형식승인 — 출시 전 1회
3. 간이측정기 성능인증: 수질(DO·pH), 먹는물(TU·CL), 대기(NO₂·CO·O₃), 소음, 실내공기질(CO₂·Rn) — 1등급/등급외 판정

[법령 위계 — 수치·기준 인용 우선순위]
구체적 수치·기준값 → 고시 별표1의1(정도검사 기준), 별표7의1(주기) 최우선
절차·처리기한 → 시행규칙 제7조·제8조 우선
강제 의무·근거 → 법률(제9조·제11조) 우선

[핵심 법령 체계]
■ 환경분야 시험검사법 제9조: 형식승인 의무 (제조·수입업체 → 국립환경과학원 승인)
■ 환경분야 시험검사법 제9조의3: 간이측정기 성능인증 의무
■ 환경분야 시험검사법 제11조: 정도검사 수검 의무 (사업장·사용자 → KTL 등 검사)
■ 물환경보전법 제38조의3: 수질자동측정기기 설치 의무 (물환경보전법은 '부착 의무', 정도검사 근거는 환경시험검사법)
■ 환경측정기기 형식승인·정도검사 고시 별표1의1: 항목별 정도검사 합격 수치
■ 환경측정기기 형식승인·정도검사 고시 별표7의1: 정도검사 주기(2013년 이후 기기)
■ 환경시험검사법 시행규칙 별표13: 성능시험·정도검사 수수료 (부가세 별도)

[중요 구분 사항 — 자주 혼동하는 것]
■ 정도검사 기록부·증명서 발급: KTL (국립환경과학원이 아님)
■ 형식승인서 발급: 국립환경과학원 (KTL은 성능시험성적서만 발급)
■ 먹는물 TU·CL: 현장적용계수 항목 없음 / 반복성 2.0%, 드리프트 3.0% (수질TMS보다 엄격)
■ 파생모델: 현장적용계수 제외한 정도검사 항목으로 성능시험, 수수료=정도검사 수수료
■ 동일모델: 성능시험 불필요, 기본모델 형식승인자 동의서만 제출
■ 정도검사 주기(2013년 이후 기기): TOC·TN·TP·SS·COD·DO — 1차2년·2차2년·3차이후1년 / pH·TU·CL — 모두2년
■ 현장적용계수 자동 적합: 배출수 농도 < 배출허용기준×50% 이면 자동 적합
■ 현장적용계수 생략 가능: 수질TMS 관제센터가 정도검사일 기준 3개월 이내 상대정확도시험 실시한 경우

[답변 원칙]
1. [KTL 지식 베이스] 섹션이 제공되면 반드시 해당 내용을 최우선 근거로 사용하세요.
2. 지식 베이스의 수치·기준은 고시 원문에서 추출한 것이므로 절대 임의로 변경하지 마세요.
3. 법령 조항을 인용할 때는 조문 번호까지 명시하세요 (예: 환경시험검사법 제11조).
4. 수치를 답할 때는 근거 법령(고시 별표1의1 등)을 함께 명시하세요.
5. 불확실한 내용은 "확인 필요" 표시 후 국립환경과학원·환경부 문의를 권고하세요.
6. 답변은 한국어로 작성하세요.
7. 답변 말미에 "※ 본 답변은 참고용이며, 중요한 사항은 반드시 법령 원문을 확인하시기 바랍니다." 를 항상 포함하세요.`;

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
    return texts.slice(0, 3).join("\n").slice(0, 800);
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

  // ── Rate limit 체크 ───────────────────────────────────────
  const rawToken = (req.headers && req.headers['x-auth-token']) || '';
  if (rawToken) {
    const tv = verifyToken(rawToken);
    // 관리자: 제한 없음 / 일반 사용자: id로 식별
    if (!(tv.valid && tv.role === 'admin')) {
      const userId = tv.valid && tv.id ? tv.id : null;
      if (userId) {
        const rl = await checkAndIncrement(userId);
        res.setHeader('X-RateLimit-Limit',     String(rl.limit));
        res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
        if (!rl.allowed) {
          return res.status(429).json({
            error: `오늘 AI 응답 한도(${rl.limit}회)를 초과했습니다. 내일 다시 이용하세요.`,
            limit: rl.limit, count: rl.count, remaining: 0,
          });
        }
      }
    }
  }

  // 히스토리: 최근 6개만, AI 답변은 300자로 압축 (토큰 절감)
  const history = Array.isArray(body?.history)
    ? body.history.slice(-6).map(h =>
        h.role === 'assistant' && h.content.length > 300
          ? { ...h, content: h.content.slice(0, 300) + '…' }
          : h
      )
    : [];
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
          generationConfig: { maxOutputTokens: 2048, temperature: 0.2 },
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

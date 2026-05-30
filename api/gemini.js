// /api/gemini — Gemini generateContent 서버사이드 프록시.
// API 키는 절대 클라이언트에 노출하지 않고 서버 환경변수(GEMINI_API_KEY)로만 사용한다.

const MODEL = "gemini-2.5-flash";
const REQUEST_TIMEOUT_MS = 30_000;

export default async function handler(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[gemini] GEMINI_API_KEY 미설정");
    return res.status(500).json({ error: "AI 서비스가 일시적으로 비활성화되었습니다." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "잘못된 요청 본문입니다." }); }
  }
  if (!body || typeof body !== "object") return res.status(400).json({ error: "요청 본문이 필요합니다." });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (e) {
    console.error("[gemini] 호출 실패:", e instanceof Error ? e.message : e);
    return res.status(502).json({ error: "AI 응답 생성에 실패했습니다." });
  }
}

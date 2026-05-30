// /api/lawSearch — 국가법령정보(law.go.kr DRF) Open API 서버사이드 프록시.
//   검색: GET /api/lawSearch?target=law&query=대기환경보전법
//   본문: GET /api/lawSearch?target=law&mst=267581

const BASE_URL = "https://www.law.go.kr/DRF";
const REQUEST_TIMEOUT_MS = 10_000;

function getOC() { return process.env.LAW_OC || "kbisss_2026"; }

async function callLawApi(endpoint, params) {
  const search = new URLSearchParams({ OC: getOC(), type: "XML", ...params });
  const url = `${BASE_URL}/${endpoint}?${search.toString()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`law.go.kr responded ${res.status}`);
  return await res.text();
}

export default async function handler(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  const target = (req.query.target || "law").toString();
  const query = (req.query.query || req.query.q || "").toString();
  const mst = (req.query.mst || req.query.MST || "").toString();

  if (!query && !mst) return res.status(400).json({ error: "query 또는 mst 파라미터가 필요합니다." });

  try {
    const xml = mst
      ? await callLawApi("lawService.do", { target, MST: mst })
      : await callLawApi("lawSearch.do", { target, query });

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).send(xml);
  } catch (e) {
    console.error("[lawSearch] 외부 API 호출 실패:", e instanceof Error ? e.message : e);
    return res.status(502).json({ error: "법령 정보를 불러오지 못했습니다." });
  }
}

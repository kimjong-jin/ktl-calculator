// 지식 베이스 — knowledge/**/*.md Obsidian 스타일 연결 그래프
// 검색: TF-IDF 코사인 유사도(0.6) + 키워드 점수(0.4) 하이브리드
// 엣지 가중치: search-index.json의 사전 계산 코사인 유사도
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const KB_DIR    = join(__dir, '..', 'knowledge');
const INDEX_FILE = join(KB_DIR, 'search-index.json');

// ── TF-IDF 인덱스 로더 (지연 초기화) ───────────────────────────
let _index = null;
function loadIndex() {
  if (_index) return _index;
  if (!existsSync(INDEX_FILE)) return null;
  try {
    _index = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
  } catch { _index = null; }
  return _index;
}

// 검색 쿼리 → TF-IDF 벡터 변환 (인덱스의 IDF 사용)
const STOP = new Set([
  '의','을','를','이','가','은','는','에','로','으로','도','와','과','한',
  '하는','하여','에서','까지','부터','이나','나','만','서','이며','며',
  '또는','및','관한','따른','따라','위한','대한','있는','있다','없는',
  '없다','하다','한다','된다','되는','되어','것을','것이','것은',
]);

function queryVector(text, idf) {
  const cleaned = text.toLowerCase().replace(/[?？]/g, '');
  const tokens = cleaned
    .split(/[\s,\.\(\)\[\]\{\}:;\/\-\+=%]+/)
    .filter(t => t.length >= 2 && !STOP.has(t));

  const bigrams = [];
  for (const t of tokens) {
    if (t.length >= 4) {
      for (let i = 0; i < t.length - 1; i++) bigrams.push(t.slice(i, i + 2));
    }
  }

  const allTokens = [...tokens, ...bigrams];
  const freq = {};
  for (const t of allTokens) freq[t] = (freq[t] || 0) + 1;
  const maxF = Math.max(...Object.values(freq), 1);

  const vec = {};
  for (const [t, f] of Object.entries(freq)) {
    if (idf[t]) vec[t] = (f / maxF) * idf[t];
  }
  return vec;
}

// 코사인 유사도 (희소 벡터)
function cosine(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (const [t, va] of Object.entries(a)) {
    const vb = b[t] || 0;
    dot   += va * vb;
    normA += va * va;
  }
  for (const vb of Object.values(b)) normB += vb * vb;
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// 엣지 가중치 조회 (방향 무관)
function edgeWeight(fileA, fileB, edges) {
  if (!edges) return 0;
  return edges[[fileA, fileB].sort().join('|')] ?? 0;
}

// 서브폴더까지 재귀 탐색하여 모든 .md 파일 경로 반환
function getAllMdFiles(dir) {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue; // .obsidian 등 숨김 폴더 제외
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllMdFiles(fullPath));
    } else if (entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

let _nodeCache = null;

function loadNodes() {
  if (_nodeCache) return _nodeCache;
  _nodeCache = getAllMdFiles(KB_DIR).map(filePath => {
    const raw = readFileSync(filePath, 'utf8');
    const f = basename(filePath, '.md');
    const titleMatch = raw.match(/^#\s+(.+)/m);
    const tagsMatch  = raw.match(/^tags:\s*\[(.+)\]/m);
    const links = [...raw.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]);
    return {
      file:  f,
      title: titleMatch?.[1] ?? f,
      tags:  tagsMatch ? tagsMatch[1].split(',').map(t => t.trim()) : [],
      links,
      content: raw,
    };
  });
  return _nodeCache;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// 노드 → AI 전달용 발췌.
// 짧으면 통째로. 길면(대형 공정시험기준·법령 전체조문 등) "상단 소개글 + 질문 키워드가
// 몰린 단락들(문서 순서 유지)"을 동적 구성 → 답이 문서 중·후반에 있어도 잘리지 않게.
function excerpt(node, maxLen = 3000, terms = null) {
  const body = node.content.replace(/^---[\s\S]*?---\n/m, '');
  if (body.length <= maxLen) return body;
  if (!terms || !terms.length) return body.slice(0, maxLen); // 쿼리 없으면 기존처럼 앞부분

  // 단락 분리: 헤딩(#~######) 또는 빈 줄 기준
  const paras = body.split(/\n(?=#{1,6}\s)|\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const termRes = [...new Set(terms.map(t => t.toLowerCase()).filter(t => t.length > 1))]
    .map(t => new RegExp(escapeRe(t), 'g'));
  const scoredParas = paras.map((p, idx) => {
    const pl = p.toLowerCase();
    let s = 0;
    for (const re of termRes) { const m = pl.match(re); if (m) s += m.length; }
    return { p, idx, s };
  });

  const hits = scoredParas.filter(x => x.s > 0).sort((a, b) => b.s - a.s || a.idx - b.idx);
  if (!hits.length) return body.slice(0, maxLen); // 매칭 없으면 앞부분 폴백

  const intro = body.slice(0, Math.min(600, Math.floor(maxLen * 0.2))).trim();
  const budget = maxLen - intro.length - 24;
  const chosen = [];
  let used = 0;
  for (const h of hits) {
    if (used + h.p.length > budget && chosen.length) break;
    chosen.push(h);
    used += h.p.length + 4;
    if (used >= budget) break;
  }
  chosen.sort((a, b) => a.idx - b.idx); // 문서 원래 순서로 복원
  const parts = chosen.map(x => x.p).join('\n\n[…]\n\n');
  return `${intro}\n\n[…]\n\n${parts}`.slice(0, maxLen);
}

// 키워드 점수 — 태그·제목·파일명·본문 매칭 (하이브리드의 40%)
function keywordScore(node, terms) {
  let s = 0;
  for (const t of terms) {
    const tl = t.toLowerCase();
    if (node.title.toLowerCase().includes(tl))                          s += 12;
    if (node.tags.some(tag => tag.toLowerCase().includes(tl)))          s += 8;
    if (node.file.toLowerCase().includes(tl))                           s += 6;
    const hits = (node.content.toLowerCase().match(new RegExp(tl, 'g')) || []).length;
    s += Math.min(hits * 2, 24);
  }
  return s;
}

// 하이브리드 점수: TF-IDF 코사인(60%) + 키워드(40%)
function hybridScore(node, terms, qVec, indexDocs) {
  const kw = keywordScore(node, terms);

  if (!qVec || !indexDocs?.[node.file]) return kw;

  const docVec = indexDocs[node.file];
  const sim    = cosine(qVec, docVec); // 0~1

  // 키워드 점수 정규화 (최대 100점 기준)
  const kwNorm = Math.min(kw / 100, 1);

  return (kwNorm * 0.4 + sim * 0.6) * 100;
}

// Obsidian 링크 해석: 파일명 매칭 (대소문자·공백 무시)
function resolveLink(linkName, nodeMap) {
  const norm = s => s.toLowerCase().replace(/[\s-]/g, '');
  return nodeMap.get(norm(linkName)) ?? null;
}

// maxLinked: 상위 노드의 링크/역링크 중 포함할 최대 수 (기본 5)
// 항목명 한국어↔영문 동의어 (검색 정확도 향상)
const ITEM_SYNONYMS = {
  'toc': ['총유기탄소'], '총유기탄소': ['toc'],
  'tn': ['총질소'], '총질소': ['tn'],
  'tp': ['총인'], '총인': ['tp'],
  'ss': ['부유물질'], '부유물질': ['ss'],
  'cod': ['화학적산소요구량'], '화학적산소요구량': ['cod'],
  'do': ['용존산소'], '용존산소': ['do'],
  'ph': ['수소이온농도'], '수소이온농도': ['ph'],
  'bod': ['생물화학적산소요구량'], '생물화학적산소요구량': ['bod'],
  'tu': ['탁도'], '탁도': ['tu'],
  'cl': ['잔류염소'], '잔류염소': ['cl'],
  // 업무 용어 동의어
  '성능인증': ['형식승인', '간이측정기'],
  '드리프트': ['drift', '제로드리프트', '스팬드리프트'],
  '반복성': ['rsd', '정밀도'],
  '직선성': ['linearity', '선형성'],
  '현장적용계수': ['field', '상대정확도'],
  '수수료': ['비용', '금액', '요금'],
};

// 법적 근거를 묻는 질문(근거·조항·별표·고시·의무 등) → 법령 정본 노드를 상위로 끌어올림.
// 요약 노드가 정본 별표/조문을 눌러 "법적 근거"가 컨텍스트에서 빠지는 것 방지.
const LEGAL_INTENT = /(근거|조항|조문|법적|법률|법령|별표|고시|시행규칙|시행령|의무|위반|과태료|벌칙|제\s?\d+\s?조)/;
const isLegalNode = (f) => /^법령[-\s]/.test(f) || /별표/.test(f);
const LEGAL_BOOST = 1.6;

export function searchKnowledge(query, topK = 3, maxLinked = 5) {
  const nodes = loadNodes();
  if (!nodes.length) return [];

  const idx = loadIndex();
  const qVec = idx ? queryVector(query, idx.idf) : null;

  // 한국어 조사·어미 제거 후 검색
  const stripParticles = t => t
    .replace(/(이랑|으로|에서|까지|이가|이는|이를|이도|이만|이와|이과|이서|이에서|이에|이로)$/, '')
    .replace(/(랑|가|을|를|은|는|의|에|로|도|만|서|와|과|이)$/, '');

  // 동의어 확장 — 영문↔한국어 양방향
  const expandWithSynonyms = t => {
    const tl = t.toLowerCase();
    const syns = ITEM_SYNONYMS[tl] || [];
    return [t, ...syns];
  };

  const terms = query
    .replace(/[?？]/g, '')
    .split(/\s+/)
    .filter(t => t.length > 1)
    .flatMap(t => [t, stripParticles(t)])
    .flatMap(expandWithSynonyms)
    .filter((t, i, a) => t.length > 1 && a.indexOf(t) === i);

  const nodeMap  = new Map(nodes.map(n => [n.file.toLowerCase().replace(/[\s-]/g, ''), n]));
  const legalIntent = LEGAL_INTENT.test(query);
  const scoreMap = new Map(nodes.map(n => {
    let s = hybridScore(n, terms, qVec, idx?.docs);
    // 법적 근거 질문이면, 이미 매칭된 법령 정본 노드(별표/조문)를 부스트 → 요약과 함께 상위 노출
    if (legalIntent && s > 0 && isLegalNode(n.file)) s *= LEGAL_BOOST;
    return [n.file, s];
  }));

  const scored = nodes
    .map(n => ({ ...n, score: scoreMap.get(n.file) }))
    .filter(n => n.score > 0)
    .sort((a, b) => b.score - a.score);

  const top      = scored.slice(0, topK);
  const included = new Set(top.map(n => n.file));

  // 엣지 가중치 기반 연결 노드 수집
  const candidateMap = new Map();

  for (const node of top) {
    for (const linkName of node.links) {
      const target = resolveLink(linkName, nodeMap);
      if (!target || included.has(target.file)) continue;

      const w     = edgeWeight(node.file, target.file, idx?.edges);
      const score = (scoreMap.get(target.file) ?? 0) + w * 20; // 엣지 가중치 보너스
      const prev  = candidateMap.get(target.file);
      if (!prev || prev.score < score) {
        candidateMap.set(target.file, { node: target, score, via: node.file, edgeW: w });
      }
    }
  }

  const topFiles = new Set(top.map(n => n.file));
  for (const node of scored) {
    if (included.has(node.file) || candidateMap.has(node.file)) continue;
    const hasBacklink = node.links.some(l => {
      const t = resolveLink(l, nodeMap);
      return t && topFiles.has(t.file);
    });
    if (hasBacklink) {
      const w = edgeWeight(node.file, [...topFiles][0], idx?.edges);
      candidateMap.set(node.file, { node, score: node.score, via: '←backlink', edgeW: w });
    }
  }

  const linked = [...candidateMap.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxLinked);

  const result = [
    ...top,
    ...linked.map(c => ({ ...c.node, score: c.score, via: c.via, edgeW: c.edgeW })),
  ];

  return result.map(({ file, title, tags, links, score: s, via, edgeW }, i) => ({
    file,
    title,
    tags,
    links,
    via:   via   ?? null,
    edgeW: edgeW ?? null,
    excerpt: excerpt(nodes.find(n => n.file === file) ?? { content: '' }, i < topK ? 6000 : 2500, terms),
    score: Math.round(s * 100) / 100,
  }));
}

export function getKnowledgeNode(file) {
  const allFiles = getAllMdFiles(KB_DIR);
  const found = allFiles.find(f => basename(f, '.md') === file);
  if (!found) return null;
  const raw = readFileSync(found, 'utf8');
  return { file, content: raw };
}

export function listKnowledgeNodes() {
  const nodes = loadNodes();
  return nodes.map(({ file, title, tags, links }) => ({ file, title, tags, links }));
}

export function knowledgeStatus() {
  const nodes = loadNodes();
  const graph = nodes.map(n => ({
    file: n.file,
    title: n.title,
    links: n.links,
    linkedBy: nodes.filter(o => o.links.includes(n.file)).map(o => o.file),
  }));
  return {
    connected: nodes.length > 0,
    nodeCount: nodes.length,
    graph,
  };
}

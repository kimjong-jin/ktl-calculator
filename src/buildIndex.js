/**
 * 오프라인 검색 인덱스 빌더
 * knowledge/**\/*.md → knowledge/search-index.json
 *
 * 실행: node src/buildIndex.js
 *
 * 산출물:
 *  - idf: 전체 문서 역빈도 가중치
 *  - docs: 문서별 TF-IDF 희소 벡터
 *  - edges: [[링크]] 쌍 코사인 유사도 (엣지 가중치)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dir   = dirname(fileURLToPath(import.meta.url));
const KB_DIR  = join(__dir, '..', 'knowledge');
const OUT     = join(KB_DIR, 'search-index.json');

// ── 한국어 토크나이저 ────────────────────────────────────────────
const STOP = new Set([
  '의','을','를','이','가','은','는','에','로','으로','도','와','과','한','하는',
  '하여','에서','에서의','까지','부터','이나','나','만','도','서','이며','며',
  '또는','및','관한','관하여','따른','따라','위한','위하여','대한','대하여',
  '있는','있어','있다','없는','없어','없다','하다','한다','된다','되는','되어',
  '것을','것이','것은','것의','것에','그','이','저','여','를','을','에',
]);

function tokenize(text) {
  const cleaned = text
    .replace(/^---[\s\S]*?---\n/m, '')       // frontmatter 제거
    .replace(/```[\s\S]*?```/g, ' ')          // 코드블록 제거
    .replace(/[#*\[\]|`>_~!]/g, ' ')          // 마크다운 기호
    .replace(/https?:\/\/\S+/g, ' ')          // URL
    .replace(/[0-9]{4,}/g, ' ')               // 긴 숫자
    .toLowerCase();

  const tokens = cleaned
    .split(/[\s,\.\(\)\[\]\{\}:;\/\-\+=%]+/)
    .filter(t => t.length >= 2 && !STOP.has(t));

  // 문자 바이그램도 추가 (한국어 복합어 처리)
  const bigrams = [];
  for (const t of tokens) {
    if (t.length >= 4) {
      for (let i = 0; i < t.length - 1; i++) {
        bigrams.push(t.slice(i, i + 2));
      }
    }
  }

  return [...tokens, ...bigrams];
}

// ── TF 계산 ─────────────────────────────────────────────────────
function computeTF(tokens) {
  const freq = {};
  for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
  const maxF = Math.max(...Object.values(freq), 1);
  const tf = {};
  for (const [t, f] of Object.entries(freq)) tf[t] = f / maxF;
  return tf;
}

// ── 코사인 유사도 ────────────────────────────────────────────────
function cosine(a, b, vocab) {
  let dot = 0, normA = 0, normB = 0;
  for (const t of vocab) {
    const va = a[t] || 0;
    const vb = b[t] || 0;
    dot   += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── 파일 탐색 ───────────────────────────────────────────────────
function getAllMdFiles(dir) {
  if (!existsSync(dir)) return [];
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const fp = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...getAllMdFiles(fp));
    else if (entry.name.endsWith('.md')) result.push(fp);
  }
  return result;
}

// ── 메인 ────────────────────────────────────────────────────────
const files = getAllMdFiles(KB_DIR);
console.log(`\n${files.length}개 파일 인덱싱 중...\n`);

// 1단계: 전체 문서 토크나이징
const corpus = files.map(fp => {
  const file = basename(fp, '.md');
  const raw  = readFileSync(fp, 'utf8');
  const links = [...raw.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]);
  const tokens = tokenize(raw);
  const tf = computeTF(tokens);
  return { file, tf, links };
});

// 2단계: IDF 계산
const df = {};
for (const { tf } of corpus) {
  for (const t of Object.keys(tf)) df[t] = (df[t] || 0) + 1;
}
const N = corpus.length;
const idf = {};
for (const [t, d] of Object.entries(df)) {
  idf[t] = Math.log((N + 1) / (d + 1)) + 1; // smoothed
}

// 3단계: TF-IDF 희소 벡터 (상위 200개 term만 보관해 파일 크기 절감)
const docs = {};
for (const { file, tf } of corpus) {
  const tfidf = {};
  for (const [t, w] of Object.entries(tf)) {
    tfidf[t] = w * (idf[t] || 1);
  }
  const sorted = Object.entries(tfidf).sort((a, b) => b[1] - a[1]).slice(0, 200);
  docs[file] = Object.fromEntries(sorted);
}

// 4단계: [[링크]] 엣지 가중치 계산
const edges = {};
for (const { file, links } of corpus) {
  for (const link of links) {
    const normLink = link.toLowerCase().replace(/[\s-]/g, '');
    const target = corpus.find(c =>
      c.file.toLowerCase().replace(/[\s-]/g, '') === normLink
    );
    if (!target) continue;

    const key = [file, target.file].sort().join('|');
    if (edges[key] !== undefined) continue;

    const vocab = new Set([...Object.keys(docs[file]), ...Object.keys(docs[target.file])]);
    const sim = cosine(docs[file], docs[target.file], vocab);
    edges[key] = Math.round(sim * 1000) / 1000;
  }
}

// 저장
const index = { meta: { n: N, built: new Date().toISOString().slice(0, 10) }, idf, docs, edges };
writeFileSync(OUT, JSON.stringify(index));

const sizeKB = Math.round(readFileSync(OUT).length / 1024);
console.log(`완료: 문서 ${N}개 | 어휘 ${Object.keys(idf).length.toLocaleString()}개 | 엣지 ${Object.keys(edges).length}개 → search-index.json (${sizeKB}KB)\n`);

/**
 * 오프라인 임베딩 생성기
 * knowledge/**\/*.md → knowledge/embeddings.json
 *
 * 실행: GEMINI_API_KEY=... node src/genEmbeddings.js
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const KB_DIR  = join(__dir, '..', 'knowledge');
const OUT_FILE = join(KB_DIR, 'embeddings.json');

const EMBED_URL = 'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent';
const API_KEY   = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
const BATCH_SIZE = 5; // 동시 요청 수 (rate limit 고려)
const MAX_CHARS  = 8000; // 임베딩 텍스트 최대 길이

if (!API_KEY) {
  console.error('GEMINI_API_KEY 환경변수가 필요합니다.');
  process.exit(1);
}

function getAllMdFiles(dir) {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllMdFiles(fullPath));
    } else if (entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

async function embedText(text) {
  const res = await fetch(`${EMBED_URL}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/text-embedding-004',
      content: { parts: [{ text: text.slice(0, MAX_CHARS) }] },
      taskType: 'RETRIEVAL_DOCUMENT',
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embedding API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.embedding.values;
}

async function processBatch(batch) {
  return Promise.all(
    batch.map(async ({ file, text }) => {
      try {
        const vector = await embedText(text);
        process.stdout.write('.');
        return { file, vector };
      } catch (e) {
        console.error(`\n[오류] ${file}: ${e.message}`);
        return { file, vector: null };
      }
    })
  );
}

async function main() {
  const files = getAllMdFiles(KB_DIR);
  console.log(`\n총 ${files.length}개 파일 임베딩 시작...\n`);

  // 기존 임베딩 로드 (재실행 시 캐시 활용)
  let existing = {};
  if (existsSync(OUT_FILE)) {
    existing = JSON.parse(readFileSync(OUT_FILE, 'utf8'));
    console.log(`기존 임베딩 ${Object.keys(existing).length}개 캐시 로드\n`);
  }

  const items = files.map(fp => {
    const f = basename(fp, '.md');
    const text = readFileSync(fp, 'utf8');
    return { file: f, text };
  }).filter(({ file }) => !existing[file]); // 이미 있는 것 건너뜀

  console.log(`신규 생성: ${items.length}개`);

  const results = { ...existing };
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const batchResults = await processBatch(batch);
    for (const { file, vector } of batchResults) {
      if (vector) results[file] = vector;
    }
    // rate limit 방지
    if (i + BATCH_SIZE < items.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  writeFileSync(OUT_FILE, JSON.stringify(results, null, 0));
  const count = Object.keys(results).length;
  const sizeKB = Math.round(readFileSync(OUT_FILE).length / 1024);
  console.log(`\n\n완료: ${count}개 임베딩 → knowledge/embeddings.json (${sizeKB}KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });

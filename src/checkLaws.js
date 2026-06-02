/**
 * 법령 버전 체크 스크립트
 * 지식 창고의 법령 노드와 law.go.kr 현행 버전을 비교해 개정 여부를 감지합니다.
 *
 * 사용법: node src/checkLaws.js
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const KB_LAW_DIR = join(__dir, '..', 'knowledge', '법령');
const LAW_BASE = 'https://www.law.go.kr/DRF';
const OC = process.env.LAW_OC || 'kbisss_2026';

// 지식 창고 법령 노드에서 MST·시행일 추출
function parseKnowledgeNodes() {
  const nodes = [];
  if (!existsSync(KB_LAW_DIR)) return nodes;

  readdirSync(KB_LAW_DIR).filter(f => f.endsWith('.md')).forEach(f => {
    const content = readFileSync(join(KB_LAW_DIR, f), 'utf8');
    const titleMatch = content.match(/^#\s+(.+)/m);
    const mstMatches = [...content.matchAll(/MST[：:\s]+(\d+)/g)];
    const admIdMatches = [...content.matchAll(/행정규칙 ID[：:\s]+(\d+)/g)];
    const dateMatch = content.match(/시행[：:\s]+(\d{4}-\d{2}-\d{2})/);

    mstMatches.forEach(m => {
      nodes.push({
        file: f,
        title: titleMatch?.[1] ?? f,
        type: 'law',
        id: m[1],
        currentDate: dateMatch?.[1] ?? null,
      });
    });
    admIdMatches.forEach(m => {
      nodes.push({
        file: f,
        title: titleMatch?.[1] ?? f,
        type: 'admrul',
        id: m[1],
        currentDate: dateMatch?.[1] ?? null,
      });
    });
  });
  return nodes;
}

// law.go.kr에서 현행 시행일 조회
async function fetchLawDate(type, id) {
  try {
    const target = type === 'admrul' ? 'admrul' : 'law';
    const key = type === 'admrul' ? 'ID' : 'MST';
    const url = `${LAW_BASE}/lawService.do?OC=${OC}&target=${target}&${key}=${id}&type=XML`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const xml = await res.text();

    // 시행일자 추출
    const match = xml.match(/<시행일자>(\d{8})<\/시행일자>/)
      ?? xml.match(/<시행일자><!\[CDATA\[(\d{8})\]\]><\/시행일자>/);
    if (!match) return null;
    const d = match[1];
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  } catch {
    return null;
  }
}

// 메인 실행
async function main() {
  console.log('🔍 법령 버전 체크 시작...\n');

  const nodes = parseKnowledgeNodes();
  // 중복 제거 (같은 ID는 한 번만 체크)
  const unique = [...new Map(nodes.map(n => [n.id, n])).values()];

  let upToDate = 0, outdated = 0, unknown = 0;
  const results = [];

  for (const node of unique) {
    process.stdout.write(`  확인 중: ${node.title.slice(0, 30).padEnd(30)} `);
    const latestDate = await fetchLawDate(node.type, node.id);

    if (!latestDate) {
      console.log(`❓ API 조회 실패`);
      unknown++;
      results.push({ ...node, latestDate: null, status: 'unknown' });
      continue;
    }

    if (!node.currentDate) {
      console.log(`⚠️  지식 창고 날짜 미기재 (API: ${latestDate})`);
      unknown++;
      results.push({ ...node, latestDate, status: 'unknown' });
      continue;
    }

    if (latestDate > node.currentDate) {
      console.log(`🔴 개정됨! 지식창고: ${node.currentDate} → 현행: ${latestDate}`);
      outdated++;
      results.push({ ...node, latestDate, status: 'outdated' });
    } else {
      console.log(`✅ 최신 (${node.currentDate})`);
      upToDate++;
      results.push({ ...node, latestDate, status: 'ok' });
    }
  }

  console.log('\n══════════════════════════════════');
  console.log(`✅ 최신:   ${upToDate}개`);
  console.log(`🔴 개정됨: ${outdated}개`);
  console.log(`❓ 미확인: ${unknown}개`);

  if (outdated > 0) {
    console.log('\n⚠️  아래 법령이 개정되었습니다. 지식 창고 업데이트가 필요합니다:');
    results.filter(r => r.status === 'outdated').forEach(r => {
      console.log(`  - ${r.title} (${r.file})`);
      console.log(`    지식창고: ${r.currentDate}  →  현행: ${r.latestDate}`);
    });
  }

  console.log('══════════════════════════════════\n');
  process.exit(outdated > 0 ? 1 : 0);
}

main();

// 지식 베이스 — knowledge/**/*.md Obsidian 스타일 연결 그래프
// 검색 시 관련 노드 + [[링크]] 연결 노드까지 함께 반환
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const KB_DIR = join(__dir, '..', 'knowledge');

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

function loadNodes() {
  return getAllMdFiles(KB_DIR).map(filePath => {
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
}

// 노드 → AI 전달용 텍스트 (앞부분 위주)
function excerpt(node, maxLen = 3000) {
  return node.content.replace(/^---[\s\S]*?---\n/m, '').slice(0, maxLen);
}

// 관련도 점수 — 태그·제목·파일명·본문 매칭
function scoreNode(node, terms) {
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

// Obsidian 링크 해석: 파일명 매칭 (대소문자·공백 무시)
function resolveLink(linkName, nodeMap) {
  const norm = s => s.toLowerCase().replace(/[\s-]/g, '');
  return nodeMap.get(norm(linkName)) ?? null;
}

// maxLinked: 상위 노드의 링크/역링크 중 포함할 최대 수 (기본 5)
export function searchKnowledge(query, topK = 3, maxLinked = 5) {
  const nodes = loadNodes();
  if (!nodes.length) return [];

  // 한국어 조사·어미 제거 후 검색
  const stripParticles = t => t
    .replace(/(이랑|으로|에서|까지|이가|이는|이를|이도|이만|이와|이과|이서|이에서|이에|이로)$/, '')
    .replace(/(랑|가|을|를|은|는|의|에|로|도|만|서|와|과|이)$/, '');
  const terms = query
    .replace(/[?？]/g, '')
    .split(/\s+/)
    .filter(t => t.length > 1)
    .flatMap(t => [t, stripParticles(t)])
    .filter((t, i, a) => t.length > 1 && a.indexOf(t) === i);

  const nodeMap = new Map(nodes.map(n => [n.file.toLowerCase().replace(/[\s-]/g, ''), n]));
  const scoreMap = new Map(nodes.map(n => [n.file, scoreNode(n, terms)]));
  const scored = nodes
    .map(n => ({ ...n, score: scoreMap.get(n.file) }))
    .filter(n => n.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored.slice(0, topK);
  const included = new Set(top.map(n => n.file));

  // 후보 수집 — 순방향·역방향 링크를 합쳐서 관련도 순 정렬 후 maxLinked로 제한
  const candidateMap = new Map(); // file → { node, score, via }

  for (const node of top) {
    for (const linkName of node.links) {
      const target = resolveLink(linkName, nodeMap);
      if (!target || included.has(target.file)) continue;
      const score = scoreMap.get(target.file) ?? 0;
      const prev = candidateMap.get(target.file);
      if (!prev || prev.score < score) {
        candidateMap.set(target.file, { node: target, score, via: node.file });
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
      candidateMap.set(node.file, { node, score: node.score, via: '←backlink' });
    }
  }

  const linked = [...candidateMap.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxLinked);

  const result = [
    ...top,
    ...linked.map(c => ({ ...c.node, score: c.score, via: c.via })),
  ];

  return result.map(({ file, title, tags, links, score: s, via }, i) => ({
    file,
    title,
    tags,
    links,
    via: via ?? null,
    // top 노드 3000자, 링크 노드 1500자 (토큰 절감)
    excerpt: excerpt(nodes.find(n => n.file === file) ?? { content: '' }, i < topK ? 3000 : 1500),
    score: s,
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

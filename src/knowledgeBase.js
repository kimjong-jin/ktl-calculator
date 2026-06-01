// 지식 베이스 — knowledge/*.md Obsidian 스타일 연결 그래프
// 검색 시 관련 노드 + [[링크]] 연결 노드까지 함께 반환
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const KB_DIR = join(__dir, '..', 'knowledge');

function loadNodes() {
  if (!existsSync(KB_DIR)) return [];
  return readdirSync(KB_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const raw = readFileSync(join(KB_DIR, f), 'utf8');
      const titleMatch = raw.match(/^#\s+(.+)/m);
      const tagsMatch  = raw.match(/^tags:\s*\[(.+)\]/m);
      const links = [...raw.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]);
      return {
        file:  f.replace('.md', ''),
        title: titleMatch?.[1] ?? f.replace('.md', ''),
        tags:  tagsMatch ? tagsMatch[1].split(',').map(t => t.trim()) : [],
        links,
        content: raw,
      };
    });
}

// 노드 → AI 전달용 텍스트 (앞부분 위주, 최대 3000자)
function excerpt(node) {
  return node.content.replace(/^---[\s\S]*?---\n/m, '').slice(0, 3000);
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

export function searchKnowledge(query, topK = 3) {
  const nodes = loadNodes();
  if (!nodes.length) return [];

  const terms = query.replace(/[?？]/g, '').split(/\s+/).filter(t => t.length > 1);

  // 1단계: 점수 기반 상위 노드 선택
  const nodeMap = new Map(nodes.map(n => [n.file.toLowerCase().replace(/[\s-]/g, ''), n]));
  const scored = nodes
    .map(n => ({ ...n, score: scoreNode(n, terms) }))
    .filter(n => n.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored.slice(0, topK);

  // 2단계: 링크 해석 — top 노드들이 [[참조]]하는 노드도 포함
  const included = new Set(top.map(n => n.file));
  const linked = [];

  for (const node of top) {
    for (const linkName of node.links) {
      const target = resolveLink(linkName, nodeMap);
      if (target && !included.has(target.file)) {
        included.add(target.file);
        linked.push({ ...target, score: 0, via: node.file });
      }
    }
  }

  // 3단계: 역방향 링크 — top 노드를 [[참조]]하는 노드도 포함 (backlinks)
  const topFiles = new Set(top.map(n => n.file));
  for (const node of nodes) {
    if (included.has(node.file)) continue;
    const hasBacklink = node.links.some(l => {
      const t = resolveLink(l, nodeMap);
      return t && topFiles.has(t.file);
    });
    if (hasBacklink && scored.find(s => s.file === node.file)?.score > 0) {
      included.add(node.file);
      linked.push({ ...node, score: 0, via: '←backlink' });
    }
  }

  const result = [...top, ...linked];

  return result.map(({ file, title, tags, links, score: s, via }) => ({
    file,
    title,
    tags,
    links,
    via: via ?? null,
    excerpt: excerpt(nodes.find(n => n.file === file) ?? { content: '' }),
    score: s,
  }));
}

export function getKnowledgeNode(file) {
  const path = join(KB_DIR, `${file}.md`);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  return { file, content: raw };
}

export function listKnowledgeNodes() {
  const nodes = loadNodes();
  return nodes.map(({ file, title, tags, links }) => ({ file, title, tags, links }));
}

export function knowledgeStatus() {
  const nodes = loadNodes();
  // 링크 그래프 요약
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

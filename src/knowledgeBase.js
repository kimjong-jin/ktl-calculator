// 지식 베이스 — knowledge/*.md 파일 검색 (Obsidian 스타일 로컬 노드)
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
      const tagsMatch = raw.match(/^tags:\s*\[(.+)\]/m);
      const linksMatch = [...raw.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]);
      return {
        file: f.replace('.md', ''),
        title: titleMatch?.[1] ?? f.replace('.md', ''),
        tags: tagsMatch ? tagsMatch[1].split(',').map(t => t.trim()) : [],
        links: linksMatch,
        content: raw,
      };
    });
}

// 쿼리와 관련도 계산 (태그·제목·본문 키워드 매칭)
function score(node, terms) {
  let s = 0;
  for (const t of terms) {
    const tl = t.toLowerCase();
    if (node.title.toLowerCase().includes(tl)) s += 10;
    if (node.tags.some(tag => tag.toLowerCase().includes(tl))) s += 8;
    if (node.file.toLowerCase().includes(tl)) s += 6;
    const bodyMatches = (node.content.toLowerCase().match(new RegExp(tl, 'g')) || []).length;
    s += Math.min(bodyMatches * 2, 20);
  }
  return s;
}

export function searchKnowledge(query, topK = 3) {
  const nodes = loadNodes();
  if (!nodes.length) return [];
  const terms = query
    .replace(/[?？]/g, '')
    .split(/\s+/)
    .filter(t => t.length > 1);
  return nodes
    .map(n => ({ ...n, score: score(n, terms) }))
    .filter(n => n.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ file, title, tags, links, content, score: s }) => ({
      file, title, tags, links,
      excerpt: content.replace(/^---[\s\S]*?---\n/m, '').slice(0, 800),
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
  return {
    connected: nodes.length > 0,
    nodeCount: nodes.length,
    nodes: nodes.map(n => n.title),
  };
}

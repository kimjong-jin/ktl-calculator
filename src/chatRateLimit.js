/**
 * chatRateLimit.js — lawChat 일일 요청 제한 (Vercel Blob 기반)
 *
 * chat-limits.json : { default: 20, keys: { userId: limit } }
 * chat-usage.json  : { userId: { count: N, date: "YYYY-MM-DD" } }
 */
import { put, head } from '@vercel/blob';

const LIMITS_KEY = 'chat-limits.json';
const USAGE_KEY  = 'chat-usage.json';

async function readBlob(key) {
  try {
    const meta = await head(key).catch(() => null);
    if (!meta) return null;
    const url = meta.downloadUrl || meta.url;
    const token = process.env.BLOB_READ_WRITE_TOKEN || '';
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function writeBlob(key, data) {
  await put(key, JSON.stringify(data), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

/** 한도 설정 전체 조회 */
export async function getLimits() {
  return (await readBlob(LIMITS_KEY)) ?? { default: 50, keys: {} };
}

/**
 * 한도 설정 변경.
 * @param {string} userId  사용자 id (hex) 또는 'default'
 * @param {number|null} limit  null이면 해당 키 삭제 (기본값으로 복귀)
 */
export async function setLimit(userId, limit) {
  const cfg = await getLimits();
  if (userId === 'default') {
    cfg.default = Number(limit);
  } else {
    if (!cfg.keys) cfg.keys = {};
    if (limit === null) delete cfg.keys[userId];
    else cfg.keys[userId] = Number(limit);
  }
  await writeBlob(LIMITS_KEY, cfg);
  return cfg;
}

/** 전체 사용량 조회 */
export async function getUsage() {
  return (await readBlob(USAGE_KEY)) ?? {};
}

/** 특정 사용자 사용량 초기화 */
export async function resetUsage(userId) {
  const usage = await getUsage();
  delete usage[userId];
  await writeBlob(USAGE_KEY, usage);
}

const todayStr = () => new Date().toISOString().slice(0, 10);

/**
 * 사용량 확인 후 1 증가.
 * @param {string} userId
 * @returns {{ allowed: boolean, count: number, limit: number, remaining: number }}
 */
export async function checkAndIncrement(userId) {
  const [cfg, usage] = await Promise.all([getLimits(), getUsage()]);
  const limit = cfg.keys?.[userId] ?? cfg.default ?? 50;
  const entry = usage[userId];
  const date  = todayStr();
  const count = (entry?.date === date) ? entry.count : 0;

  if (count >= limit) {
    return { allowed: false, count, limit, remaining: 0 };
  }

  usage[userId] = { count: count + 1, date };
  await writeBlob(USAGE_KEY, usage);

  return { allowed: true, count: count + 1, limit, remaining: limit - (count + 1) };
}

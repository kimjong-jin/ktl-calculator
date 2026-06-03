/**
 * tokenStore.js — Vercel Blob 기반 접속 코드 저장소
 *
 * Blob 파일: access-codes.json
 * 형식: { "token_id": { exp: epoch초, label: "메모", issuedAt: epoch초 }, ... }
 *
 * 관리자가 삭제하면 해당 ID가 Blob에서 제거 → 즉시 로그인 불가.
 */
import { put, head, del } from '@vercel/blob';

const BLOB_KEY = 'access-codes.json';

/** Blob에서 코드 맵 읽기 (private 스토어) */
async function readCodes() {
  try {
    const meta = await head(BLOB_KEY).catch(() => null);
    if (!meta) return {};
    // private 스토어: downloadUrl (signed) 또는 BLOB 토큰으로 직접 fetch
    const url = meta.downloadUrl || meta.url;
    const token = process.env.BLOB_READ_WRITE_TOKEN || '';
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

/** 코드 맵을 Blob에 쓰기 */
async function writeCodes(map) {
  await put(BLOB_KEY, JSON.stringify(map), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

/** 새 토큰 ID 등록 */
export async function registerToken(tokenId, { exp, label = '' }) {
  const map = await readCodes();
  map[tokenId] = { exp, label, issuedAt: Math.floor(Date.now() / 1000) };
  await writeCodes(map);
}

/** 토큰 ID가 유효한지 확인 (Blob에 존재 + 만료 안 됨) */
export async function isTokenValid(tokenId) {
  if (!tokenId) return false;
  const map = await readCodes();
  const entry = map[tokenId];
  if (!entry) return false;  // 삭제됨
  if (Math.floor(Date.now() / 1000) >= entry.exp) return false;  // 만료됨
  return true;
}

/** 토큰 ID 즉시 무효화 (관리자 삭제) */
export async function revokeToken(tokenId) {
  const map = await readCodes();
  if (!map[tokenId]) return false;
  delete map[tokenId];
  await writeCodes(map);
  return true;
}

/** 전체 코드 목록 */
export async function listTokens() {
  return await readCodes();
}

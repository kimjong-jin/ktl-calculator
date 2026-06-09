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
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Cache-Control': 'no-cache, no-store',
        'Pragma': 'no-cache',
      },
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

/** 고객용 단순 비밀번호 생성 (6자, 혼동 없는 대문자+숫자) */
function genPw(map) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const used = new Set(Object.values(map).map(e => e.pw).filter(Boolean));
  let pw;
  do {
    pw = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (used.has(pw));
  return pw;
}

/** 새 토큰 ID 등록 — 단순 비밀번호 생성 후 반환 (발급 시 만료 항목 자동 정리) */
export async function registerToken(tokenId, { exp, label = '', applicantName = '', receiptNo = '', siteName = '' }) {
  const map = await readCodes();
  const now = Math.floor(Date.now() / 1000);
  for (const id of Object.keys(map)) {
    if (map[id].exp <= now) delete map[id];
  }
  const pw = genPw(map);
  map[tokenId] = { exp, label, applicantName, receiptNo, siteName, issuedAt: now, pw };
  await writeCodes(map);
  return { pw };
}

/** 단순 비밀번호로 토큰 엔트리 조회 */
export async function findTokenByPw(pw) {
  if (!pw || pw.length < 4) return null;
  const map = await readCodes();
  const now = Math.floor(Date.now() / 1000);
  for (const [tokenId, entry] of Object.entries(map)) {
    if (entry.pw === pw && entry.exp > now) {
      return {
        tokenId,
        exp: entry.exp,
        applicantName: entry.applicantName || '',
        receiptNo: entry.receiptNo || '',
        siteName: entry.siteName || '',
      };
    }
  }
  return null;
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

/** 접수번호로 토큰 즉시 무효화 (로컬 삭제 시 연동) */
export async function revokeTokenByReceiptNo(receiptNo) {
  if (!receiptNo) return false;
  const map = await readCodes();
  let revoked = false;
  for (const [tokenId, entry] of Object.entries(map)) {
    if (entry.receiptNo === receiptNo) {
      delete map[tokenId];
      revoked = true;
    }
  }
  if (revoked) await writeCodes(map);
  return revoked;
}

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

// 발급자(소유자) 식별: 이 시스템은 발급 '직원명'을 label 에 저장(issuer 필드는 비어있는 경우가 많음).
// 클라이언트(web/admin.js tokenIssuer)와 동일 규칙 — label 이 직원명이면 그것을, 아니면 issuer.
const STAFF_NAMES = ['김종진', '권민경', '김성대', '김수철', '정슬기', '강준', '정진욱'];
export function tokenIssuerOf(e) {
  if (e && e.label && STAFF_NAMES.includes(e.label)) return e.label;
  return (e && e.issuer) || '';
}

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

/** 새 토큰 ID 등록 — 단순 비밀번호 생성 후 반환 (발급 시 만료 항목 자동 정리)
 *  issuer: 발급한 관리자 본인 이름 (인증 토큰의 id). 발급자별 격리의 기준값. */
export async function registerToken(tokenId, { exp, label = '', applicantName = '', receiptNo = '', siteName = '', issuer = '' }) {
  const map = await readCodes();
  const now = Math.floor(Date.now() / 1000);
  for (const id of Object.keys(map)) {
    if (map[id].exp <= now) delete map[id];
  }
  const pw = genPw(map);
  map[tokenId] = { exp, label, applicantName, receiptNo, siteName, issuer, issuedAt: now, pw };
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

/** 코드 목록. issuer 지정 시 해당 발급자 항목만 반환(소유 기준 = issuer 만, label 은 메모라 매칭 금지).
 *  발급자 없는 레거시 토큰은 비-슈퍼관리자에 노출 안 됨 → 슈퍼관리자(issuer 미지정 호출)만 전체 조회. */
export async function listTokens(issuer) {
  const map = await readCodes();
  const now = Math.floor(Date.now() / 1000);
  let changed = false;
  for (const [id, e] of Object.entries(map)) {
    if (e.exp <= now) {
      delete map[id];
      changed = true;
    }
  }
  if (changed) {
    await writeCodes(map);
  }

  if (!issuer) return map;
  const out = {};
  for (const [id, e] of Object.entries(map)) {
    if (tokenIssuerOf(e) === issuer) out[id] = e;
  }
  return out;
}

/** 전체 토큰 삭제 */
export async function clearAllTokens() {
  await writeCodes({});
  return true;
}

/** 특정 발급자가 발급한 토큰만 일괄 삭제 (단일 쓰기) */
export async function clearTokensByIssuer(issuer) {
  if (!issuer) return 0;
  const map = await readCodes();
  let removed = 0;
  for (const [id, e] of Object.entries(map)) {
    if (tokenIssuerOf(e) === issuer) { delete map[id]; removed++; }
  }
  if (removed) await writeCodes(map);
  return removed;
}

/** 만료된 토큰을 일괄 제거 (issuer가 있으면 해당 issuer 것만) */
export async function clearExpiredTokens(issuer) {
  const map = await readCodes();
  const now = Math.floor(Date.now() / 1000);
  let removed = 0;
  for (const [id, e] of Object.entries(map)) {
    if (e.exp <= now) {
      if (!issuer || tokenIssuerOf(e) === issuer) {
        delete map[id];
        removed++;
      }
    }
  }
  if (removed > 0) {
    await writeCodes(map);
  }
  return removed;
}

/** 토큰의 신청자명(유지관리담당자) 갱신. 사용자가 이름 정정 시 서버 영속화. */
export async function updateApplicantName(tokenId, applicantName) {
  const map = await readCodes();
  const e = map[tokenId];
  if (!e) return null;
  const oldName = e.applicantName || '';
  const receiptNo = e.receiptNo || '';
  e.applicantName = String(applicantName || '').slice(0, 40);
  await writeCodes(map);
  return { oldName, receiptNo };
}

/** 업체가 계산기에서 입력·저장한 접수번호/현장명을 토큰에 역동기화 (비어있을 때만 채움) */
export async function syncReceiptInfo(tokenId, receiptNo, siteName) {
  if (!tokenId) return false;
  const map = await readCodes();
  const e = map[tokenId];
  if (!e) return false;
  let changed = false;
  if (receiptNo && !e.receiptNo) { e.receiptNo = String(receiptNo).slice(0, 30); changed = true; }
  if (siteName && !e.siteName) { e.siteName = String(siteName).slice(0, 60); changed = true; }
  if (changed) await writeCodes(map);
  return changed;
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

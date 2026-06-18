/**
 * 수질TMS 정도검사 UI — 엑셀 Version11_(2026).xlsx 전면 반영
 *
 * 항목별 폼 분기:
 *   TOC/TN/TP/SS : 기본형 (반복성 Z1/Z3/Z5, 드리프트 Z2~Z5, 직선성 M1~M3, 현장적용, 응답시간)
 *   COD          : 기본형 + 포도당변동성시험
 *   pH           : pH 전용 (반복성6회, 드리프트2개값, 직선성3점, 온도보상5온도, 현장적용)
 *   DO           : DO 전용 (반복성S, 드리프트4개값, 직선성max/min, 온도보상20/30℃, 응답시간)
 *   TU/CL        : 먹는물 (Z1~Z5, S1~S5, M, 응답시간) — 단순형
 */
import {
  PRECISION_CRITERIA,
  DO_SPAN_TABLE,
  repeatability, drift, linearity,
  phLinearity, doLinearity,
  phTemperatureComp, doTemperatureComp,
  codGlucoseVariability,
  fieldApplication,
} from '../src/precision.js';

const fmt = (n, d = 2) => (Number.isFinite(n) ? Number(n).toFixed(d) : '–');

const ITEMS = [
  { code: 'TOC', label: 'TOC — 총유기탄소' },
  { code: 'TN',  label: 'TN — 총질소' },
  { code: 'TP',  label: 'TP — 총인' },
  { code: 'SS',  label: 'SS — 부유물질' },
  { code: 'PH',  label: 'pH — 수소이온농도' },
  { code: 'DO',  label: 'DO — 용존산소' },
  { code: 'COD', label: 'COD — 화학적산소요구량' },
  { code: 'TU',  label: 'TU — 탁도' },
  { code: 'CL',  label: 'CL — 잔류염소' },
];

// 항목 그룹
const IS_BASIC = c => ['TOC','TN','TP','SS'].includes(c);
const IS_PH    = c => c === 'PH';
const IS_DO    = c => c === 'DO';
const IS_COD   = c => c === 'COD';
const IS_WATER = c => ['TU','CL'].includes(c); // 먹는물

// 항목별 저장 필드 목록
function getFields(code) {
  if (IS_PH(code)) return [
    'ph7a','ph4a','ph7b','ph4b','ph7c','ph4c',      // 반복성 (7,4,7,4,7,4)
    'phdi','phdf',                                    // 드리프트 초기/최종
    'phm4','phm7','phm10',                            // 직선성 (4,7,10)
    'pht10','pht15','pht20','pht25','pht30',          // 온도보상
    'phci1','phai1','phai2','phci2','phai3','phai4',  // 현장적용
    'resp','resp_limit',
  ];
  if (IS_DO(code)) return [
    'dos1','dos2','dos3',                             // 반복성 S×3 (25℃ 기준)
    'dozi','dozf','dosi','dosf',                      // 드리프트 Z초기/최종, S초기/최종
    'domax','domin',                                  // 직선성 max/min
    'dot20','dot30',                                  // 온도보상
    'resp','resp_limit',
  ];
  if (IS_WATER(code)) return [
    'range',
    'z1','z2','z3','z4','z5','z6','z7',
    's1','s2','s3','s4','s5','s6','s7',
    'm1','resp','resp_limit',
  ];
  // TOC/TN/TP/SS/COD (기본형)
  const base = [
    'range',
    'z1','z2','z3','z4',       // 드리프트
    's1','s2','s3','s4',       // 드리프트
    'z5','z6','z7',            // 반복성 별도 (z5 필수, z6/z7 선택)
    's5','s6','s7',            // 반복성 별도 (s5 필수, s6/s7 선택)
    'rep_extra',               // 별도측정(2·3차) 열림 체크 — 서버 저장으로 재접속 유지
    'm1','m2','m3',            // 직선성
    'ci1','ai1','ai2','ci2','ai3','ai4','fdis', // 현장적용
  ];
  if (code === 'TOC') base.push('resp', 'highvar'); // TOC만 응답시간 및 변동성 큰 시료
  if (IS_COD(code)) base.push('codmax','codmin'); // COD 포도당변동성
  return base;
}

// ── 탭 상태 ─────────────────────────────────────────────
let tabs = [];
let activeId = null;
let calcTimer = null;
let stored = {}; // switchTab에서 loadData(id)로 갱신 — ni(), zsCell()에서 사용
let adminInMemoryCache = {}; // 관리자 메모리 내 탭 데이터 캐시 (로컬 스토리지 방지)

// ── 저장/불러오기 상태 ──────────────────────────────────
let calcReceiptNo  = '';
let calcUserName   = '';
let calcSiteName   = '';
let autoSaveTimer  = null;
let isPrimaryUser  = false;   // 주 사용자(쓰기·저장). 토글 버튼으로 설정. 관리자는 항상 주 사용자.
let primaryTimer   = null;    // 주 사용자: 10초 자동 저장
let viewerTimer    = null;    // 확인용: 10초 자동 불러오기
try { isPrimaryUser = isAdmin() ? false : (localStorage.getItem('ktl-calc-primary') === '1'); } catch {}

function bundleState() {
  if (activeId) saveData(activeId);
  const fields = {};
  tabs.forEach(t => { fields[t.id] = loadData(t.id); });
  return { tabs: tabs.map(({id,code,label,pass}) => ({id,code,label,pass})), activeId, fields };
}

function restoreBundle(bundle) {
  // 보던 탭 유지: 현재 활성 탭의 라벨(예: TN-2)이 새 목록에도 있으면 그 탭을 유지.
  // (10초 자동 불러오기 때 주 사용자의 활성 탭으로 화면이 튀지 않도록)
  const isAdm = isAdmin();
  const prevTab = tabs.find(t => t.id === activeId);
  const prevLabel = prevTab ? prevTab.label : null;
  if (isAdm) {
    adminInMemoryCache = {};
  } else {
    tabs.forEach(t => { try { localStorage.removeItem(`ktl-pv-${t.id}`); } catch {} });
  }
  tabs = (bundle.tabs || []);
  const keep = prevLabel ? tabs.find(t => t.label === prevLabel) : null;
  activeId = keep ? keep.id : (bundle.activeId || (tabs.length ? tabs[0].id : null));
  Object.entries(bundle.fields || {}).forEach(([id, f]) => {
    if (isAdm) {
      adminInMemoryCache[id] = f;
    } else {
      try { localStorage.setItem(`ktl-pv-${id}`, JSON.stringify(f)); } catch {}
    }
  });
  saveMeta();
  renderTabs();
  if (activeId) switchTab(activeId);
  else renderEmpty();
}

function setSaveStatus(msg, type = 'ok') {
  const el = document.getElementById('pv-save-status');
  if (el) el.innerHTML = `<span class="pv-ss-${type}">${msg}</span>`;
}

async function saveToServer() {
  if (!calcReceiptNo || !calcUserName) {
    setSaveStatus('⚠️ 접수번호와 사용자 이름을 입력하세요.', 'warn'); return;
  }
  setSaveStatus('💾 저장 중…', 'loading');
  const bundle = bundleState();
  try {
    const res = await fetch('/api/calcData', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiptNo: calcReceiptNo, userName: calcUserName, siteName: calcSiteName, data: bundle, ttlDays: 10 }),
    });
    if (!res.ok) throw new Error((await res.json()).error || '서버 오류');
    const { expiresAt } = await res.json();
    const exp = new Date(expiresAt).toLocaleDateString('ko-KR', {month:'numeric',day:'numeric'});
    const time = new Date().toLocaleTimeString('ko-KR', {hour:'2-digit',minute:'2-digit'});
    setSaveStatus(`✅ 서버 저장됨 ${time} (만료: ${exp})`);
    if (!isAdmin()) {
      try { localStorage.setItem('ktl-calc-last-save', JSON.stringify({receiptNo:calcReceiptNo,userName:calcUserName,at:Date.now()})); } catch {}
      try { localStorage.removeItem(`ktl-calc-offline-${calcReceiptNo}-${calcUserName}`); } catch {}  // 성공 → 대기분 제거
    }
  } catch (e) {
    if (isAdmin()) {
      setSaveStatus(`❌ 서버 저장 실패: ${e.message}`, 'error');
    } else {
      // 오프라인 폴백: 서버 미도달 → 이 PC에만 임시 저장 + 재전송 대기열에 메타와 함께 보관
      try {
        localStorage.setItem(`ktl-calc-offline-${calcReceiptNo}-${calcUserName}`,
          JSON.stringify({ receiptNo: calcReceiptNo, userName: calcUserName, siteName: calcSiteName, bundle, at: Date.now() }));
      } catch {}
      // ⚠️ 성공처럼 보이지 않게 빨간 경고로 (고객 착각 방지)
      setSaveStatus('⚠️ 서버 저장 실패 — 인터넷 확인 후 [저장] 다시 눌러주세요 (현재 이 PC에만 임시 저장됨)', 'error');
    }
  }
}

// 오프라인 중 저장 실패분을 서버에 자동 재전송 (재연결/로드 시). 성공하면 대기분 삭제.
async function retryOfflineSaves() {
  const keys = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('ktl-calc-offline-')) keys.push(k); } } catch {}
  for (const k of keys) {
    let p; try { p = JSON.parse(localStorage.getItem(k)); } catch { continue; }
    if (!p || !p.receiptNo || !p.userName || !p.bundle) continue;   // 구형식(메타 없음)은 자동재전송 대상 아님
    try {
      const res = await fetch('/api/calcData', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiptNo: p.receiptNo, userName: p.userName, siteName: p.siteName || '', data: p.bundle, ttlDays: 10 }),
      });
      if (res.ok) {
        try { localStorage.removeItem(k); } catch {}
        if (p.receiptNo === calcReceiptNo && p.userName === calcUserName)
          setSaveStatus('✅ 미전송분 서버 자동 저장 완료', 'ok');
      }
    } catch { /* 여전히 오프라인 → 다음 기회에 */ }
  }
}
if (typeof window !== 'undefined') window.addEventListener('online', retryOfflineSaves);

function isAdmin() {
  try {
    const token = localStorage.getItem('ktl-auth') || '';
    if (!token.includes('.')) return false;
    const decoded = JSON.parse(atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
    return decoded.role === 'admin';
  } catch { return false; }
}

async function loadFromServer() {
  if (!calcReceiptNo) {
    setSaveStatus('⚠️ 접수번호를 입력하세요.', 'warn'); return;
  }
  // 관리자이고 사용자명이 없으면 접수번호만으로 검색
  if (isAdmin() && !calcUserName) {
    setSaveStatus('🔄 불러오는 중…', 'loading');
    try {
      const token = encodeURIComponent(localStorage.getItem('ktl-auth') || '');
      const res = await fetch(`/api/calcData?action=byReceipt&receiptNo=${encodeURIComponent(calcReceiptNo)}&token=${token}`);
      if (res.status === 404) { setSaveStatus('❌ 해당 접수번호의 저장 데이터가 없습니다.', 'error'); return; }
      if (!res.ok) throw new Error((await res.json()).error || '서버 오류');
      const { data, userName: foundUser, siteName: foundSite, updatedAt } = await res.json();
      if (foundUser) {
        calcUserName = foundUser;
        const userEl = document.getElementById('pv-user-name');
        if (userEl) { userEl.value = foundUser; userEl.dispatchEvent(new Event('input')); }
        if (!isAdmin()) {
          try { localStorage.setItem('ktl-calc-username', foundUser); } catch {}
        }
      }
      if (foundSite) {
        calcSiteName = foundSite;
        const siteEl = document.getElementById('pv-site-name');
        if (siteEl) { siteEl.value = foundSite; siteEl.dispatchEvent(new Event('input')); }
        if (!isAdmin()) {
          try { localStorage.setItem('ktl-site-name', foundSite); } catch {}
        }
      }
      restoreBundle(data);
      const time = new Date(updatedAt).toLocaleString('ko-KR', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
      setSaveStatus(`✅ 불러오기 완료 — ${foundUser} (${time})`);
    } catch (e) {
      setSaveStatus(`❌ 불러오기 실패: ${e.message}`, 'error');
    }
    return;
  }
  if (!calcUserName) {
    setSaveStatus('⚠️ 접수번호와 사용자 이름을 입력하세요.', 'warn'); return;
  }
  setSaveStatus('🔄 불러오는 중…', 'loading');
  try {
    const res = await fetch(`/api/calcData?receiptNo=${encodeURIComponent(calcReceiptNo)}&userName=${encodeURIComponent(calcUserName)}`);
    if (res.status === 404) {
      // 오프라인 폴백 확인
      const local = localStorage.getItem(`ktl-calc-offline-${calcReceiptNo}-${calcUserName}`);
      if (local) {
        let parsed; try { parsed = JSON.parse(local); } catch { parsed = null; }
        const b = parsed && (parsed.bundle || (parsed.tabs ? parsed : null));   // 신/구 포맷 모두
        if (b) {
          restoreBundle(b);
          setSaveStatus('⚠️ 이 PC의 임시 데이터 복원 — 아직 서버 미저장! [저장] 눌러주세요', 'error');
        } else {
          setSaveStatus('❌ 저장된 데이터가 없습니다.', 'error');
        }
      } else {
        setSaveStatus('❌ 저장된 데이터가 없습니다.', 'error');
      }
      return;
    }
    if (!res.ok) throw new Error((await res.json()).error || '서버 오류');
    const { data, siteName: loadedSite, updatedAt } = await res.json();
    restoreBundle(data);
    if (loadedSite) {
      calcSiteName = loadedSite;
      const siteEl = document.getElementById('pv-site-name');
      if (siteEl) { siteEl.value = loadedSite; siteEl.dispatchEvent(new Event('input')); }
      if (!isAdmin()) {
        try { localStorage.setItem('ktl-site-name', loadedSite); } catch {}
      }
    }
    const time = new Date(updatedAt).toLocaleString('ko-KR', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
    setSaveStatus(`✅ 불러오기 완료 (마지막 저장: ${time})`);
  } catch (e) {
    setSaveStatus(`❌ 불러오기 실패: ${e.message}`, 'error');
  }
}

function scheduleAutoSave() {
  if (isAdmin()) return;
  if (!calcReceiptNo || !calcUserName) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(saveToServer, 30_000);
}

// ── 접속자 권한 모드 ────────────────────────────────────────
// 주 사용자/관리자: 읽기·쓰기·저장·불러오기 + 10초 자동 저장.
// 확인용(제2 접속자): 읽기·불러오기만(쓰기·저장 불가) + 10초 자동 불러오기.
function isPrimary() { return isPrimaryUser; }   // 누구나 버튼 누르면 주 사용자(관리자 특례 없음)
function applyAccessMode() {
  const primary = isPrimary();
  // 측정 입력칸 잠금(확인용은 쓰기 불가). 접수번호/사용자/현장명은 form-area 밖이라 불러오기용으로 유지.
  const fa = document.getElementById('pv-form-area');
  if (fa) fa.querySelectorAll('input, select, textarea, button').forEach(el => { el.disabled = !primary; });
  const saveBtn = document.getElementById('pv-save-btn');
  if (saveBtn) saveBtn.style.display = primary ? '' : 'none';
  // 10초 인터벌 재설정 (중복 방지)
  clearInterval(primaryTimer); clearInterval(viewerTimer);
  if (primary && !isAdmin()) {
    primaryTimer = setInterval(() => { if (calcReceiptNo && calcUserName) saveToServer(); }, 60_000);  // 쓰기: 1분 자동저장
  } else if (!primary && !isAdmin()) {
    viewerTimer = setInterval(() => { if (calcReceiptNo) loadFromServer(); }, 10_000);                 // 읽기: 10초 자동 불러오기
  }
  const btn = document.getElementById('pv-primary-btn');
  if (btn) {
    btn.textContent = primary ? '주사용자 종료' : '주사용자 전환';   // 동작 기준 라벨
    btn.classList.toggle('pv-primary-on', primary);
    btn.classList.toggle('btn--primary', primary);     // 활성: 채움 강조
    btn.classList.toggle('btn--ghost', !primary);      // 비활성: 흐림
    btn.title = primary
      ? '주 사용자 활성 — 쓰기·저장·10초 자동저장. 다시 누르면 해제(읽기 전용).'
      : '읽기 전용 상태. 눌러서 주 사용자 활성화(쓰기·저장).';
  }
}

function saveMeta() {
  if (isAdmin()) return;
  try { localStorage.setItem('ktl-tabs', JSON.stringify(tabs.map(({id,code,label,pass,subNo})=>({id,code,label,pass,subNo})))); } catch {}
  try { localStorage.setItem('ktl-tab-active', activeId||''); } catch {}
}
function loadMeta() {
  if (isAdmin()) {
    tabs = [];
    activeId = null;
    return;
  }
  try { const r = localStorage.getItem('ktl-tabs'); if (r) tabs = JSON.parse(r); } catch {}
  try { activeId = localStorage.getItem('ktl-tab-active') || null; } catch {}
  // 구버전 탭(subNo 없음) 마이그레이션
  tabs.forEach((t, i) => {
    if (!t.subNo) t.subNo = i + 1;
    if (!t.label || !t.label.includes('-')) t.label = makeLabel(t.code, t.subNo);
  });
}

// 다음 subNo 계산 (전체 탭 통틀어 순번)
function nextSubNo() {
  return tabs.length === 0 ? 1 : Math.max(...tabs.map(t => t.subNo || 0)) + 1;
}
// 성적서/탭 툴팁용 접수번호 — 접수번호 + 탭 순번 (예: 25-000000-01-2).
// 한 접수번호 아래 여러 항목(TOC-1, TN-2…)을 구분하려 성적서엔 순번을 붙임.
// (입력칸 placeholder 는 순번 없는 26-031078-01 예시를 따로 사용)
function fullReceiptNo(tab) {
  return calcReceiptNo ? `${calcReceiptNo}-${tab.subNo}` : `(${tab.label})`;
}

// ── 음성 입력: 말한 내용 → 숫자 문자열 ──────────────────────────
// "44.1234", "사십사 점 일이삼사", "영 점 육삼사", "공점육삼사", "마이너스 0.5" 등 처리.
// 정밀도 유지 위해 숫자 '문자열'을 반환(없으면 null).
function _korChunkToDigits(chunk) {
  // 소수점 오른쪽처럼 자리수를 그대로 이어붙이는 변환 (일이삼사 → 1234)
  const d = { 영:0, 공:0, 일:1, 이:2, 삼:3, 사:4, 오:5, 육:6, 륙:6, 칠:7, 팔:8, 구:9 };
  let out = '';
  for (const ch of chunk) {
    if (/\d/.test(ch)) out += ch;
    else if (ch in d) out += d[ch];
  }
  return out;
}
function _korChunkToInt(chunk) {
  // 정수부: 십/백/천/만 복합수 처리 (사십사 → 44). 단위 없으면 자리이어붙이기.
  if (/^\d+$/.test(chunk)) return chunk;
  if (!/[십백천만]/.test(chunk)) return _korChunkToDigits(chunk);
  const d = { 영:0, 공:0, 일:1, 이:2, 삼:3, 사:4, 오:5, 육:6, 륙:6, 칠:7, 팔:8, 구:9 };
  const u = { 십:10, 백:100, 천:1000 };
  let total = 0, cur = 0;
  for (const ch of chunk) {
    if (/\d/.test(ch)) cur = cur * 10 + Number(ch);
    else if (ch in d) cur = d[ch];
    else if (ch in u) { cur = (cur || 1) * u[ch]; total += cur; cur = 0; }
    else if (ch === '만') { total = (total + cur) * 10000; cur = 0; }
  }
  return String(total + cur);
}
function parseSpokenNumber(raw) {
  if (!raw) return null;
  let t = String(raw).toLowerCase().trim();
  // 전각 숫자(０-９) → 반각
  t = t.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const neg = /^(마이너스|minus|negative|-)/.test(t);
  t = t.replace(/^(마이너스|minus|negative|-)\s*/, '');
  // 계산기엔 콤마가 없다 → 콤마/구분점 변형은 전부 소수점으로
  t = t.replace(/[,，、]/g, '.');
  t = t.replace(/(소수점|점|쩜|콤마|포인트|point|dot)/g, '.');
  t = t.replace(/[．。·・]/g, '.');  // ．。·・ → .
  t = t.replace(/\s+/g, '');
  if (!t) return null;
  const parts = t.split('.');
  const intStr = _korChunkToInt(parts[0] || '0');
  let s = (intStr === '' ? '0' : intStr);
  if (parts.length > 1) {
    const dec = parts.slice(1).map(_korChunkToDigits).join('');
    if (dec !== '') s += '.' + dec;
  }
  if (!/\d/.test(s)) return null;
  if (!Number.isFinite(Number(s))) return null;
  return (neg ? '-' : '') + s;
}

// ── 🎙️ 음성 입력: 포커스된 칸 추적 + 헤더 마이크 핸들러 (모듈 1회 등록) ──
// init() 재실행과 무관하게 동작하도록 document 전역 + 모듈 변수로 둔다.
let lastVoiceTarget = null;
let lastVoiceMode = null;   // 'number' | 'text'
if (typeof document !== 'undefined') {
  document.addEventListener('focusin', e => {
    const el = e.target;
    if (!el || el.tagName !== 'INPUT') return;
    if (el.type === 'number' && el.closest('#pv-form-area')) {
      lastVoiceTarget = el; lastVoiceMode = 'number';          // 측정값 → 숫자
    } else if (el.id === 'pv-user-name' || el.id === 'pv-site-name') {
      lastVoiceTarget = el; lastVoiceMode = 'text';            // 사용자/현장명 → 텍스트
    }
    // 접수번호(pv-receipt-no)는 형식 코드라 음성 제외
  });
}
// chat.js 헤더 마이크가 호출. 포커스된 칸을 채우면 true. transcripts: 후보 배열|문자열.
if (typeof window !== 'undefined') {
  window.__pvVoiceFill = function(transcripts) {
    const target = lastVoiceTarget;
    if (!target || !document.body.contains(target)) return false;
    const arr = Array.isArray(transcripts) ? transcripts : [transcripts];
    let value = null;
    if (lastVoiceMode === 'text') {
      value = (arr[0] || '').trim().replace(/[.。·・\s]+$/, '').trim();   // 이름/현장명: 그대로
      if (!value) return false;
    } else {
      const cands = [];
      for (const tr of arr) {
        const n = parseSpokenNumber(tr);
        if (n !== null) cands.push({ n, hasDot: /[.,，．。·・]|점|쩜|콤마|포인트|point|dot/.test(tr) });
      }
      const dotted = cands.find(c => c.hasDot);   // 소수점 포함 후보 우선
      value = dotted ? dotted.n : (cands[0] ? cands[0].n : null);
      if (value === null) return false;
    }
    target.value = value;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.classList.add('pv-field-highlight');
    setTimeout(() => target.classList.remove('pv-field-highlight'), 1000);
    const lbl = (target.closest('label')?.textContent
      || (target.id === 'pv-user-name' ? '사용자' : target.id === 'pv-site-name' ? '현장명' : '입력칸')).trim().slice(0, 12);
    if (typeof setSaveStatus === 'function') setSaveStatus(`✅ 음성 입력: ${lbl} = ${value}`, 'ok');
    return true;
  };
}
function saveData(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  const fields = getFields(tab.code);
  const s = {};
  fields.forEach(f => {
    const el = document.getElementById(`pv_${f}`);
    if (el) {
      if (el.type === 'checkbox') {
        s[f] = el.checked;
      } else {
        s[f] = el.value;
      }
    }
  });
  // 파이프라인 순서 문자열도 저장 (getFields에 포함되지 않으므로 별도 처리)
  if (stored['seq'] !== undefined) s['seq'] = stored['seq'];
  if (isAdmin()) {
    adminInMemoryCache[id] = s;
  } else {
    try { localStorage.setItem(`ktl-pv-${id}`, JSON.stringify(s)); } catch {}
  }
}
function loadData(id) {
  if (isAdmin()) {
    return adminInMemoryCache[id] || {};
  }
  try { const r = localStorage.getItem(`ktl-pv-${id}`); return r ? JSON.parse(r) : {}; } catch { return {}; }
}

function makeLabel(code, subNo) {
  return `${code}-${subNo}`;
}
// 측정범위가 비어 있으면 입력 팝업 (계산의 전제값). range 없는 폼(pH/DO)은 스킵.
function promptRangeIfEmpty() {
  const rangeEl = document.getElementById('pv_range');
  if (!rangeEl) return;
  const v = rangeEl.value;
  if (v != null && String(v).trim() !== '' && Number(v) !== 0) return;   // 이미 입력됨
  if (document.getElementById('pv-range-modal')) return;                  // 중복 방지

  const ov = document.createElement('div');
  ov.id = 'pv-range-modal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999';
  const box = document.createElement('div');
  box.style.cssText = 'background:#1e293b;border-radius:14px;padding:24px;min-width:280px;max-width:340px;width:90%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.5)';
  box.innerHTML = `
    <div style="font-size:17px;font-weight:700;color:#f1f5f9;margin-bottom:6px">📏 측정범위 입력</div>
    <div style="font-size:13px;color:#94a3b8;margin-bottom:14px">계산을 위해 측정범위를 먼저 입력하세요.</div>
    <input id="pv-range-modal-input" type="number" step="any" inputmode="decimal" placeholder="예: 10"
      style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#f1f5f9;font-size:16px;text-align:center;margin-bottom:14px" />
    <div style="display:flex;gap:8px">
      <button id="pv-range-modal-skip" type="button" style="flex:1;padding:10px;border-radius:8px;border:none;background:#334155;color:#cbd5e1;font-size:14px;cursor:pointer">나중에</button>
      <button id="pv-range-modal-ok" type="button" style="flex:2;padding:10px;border-radius:8px;border:none;background:#0ea5e9;color:#fff;font-size:15px;font-weight:600;cursor:pointer">확인</button>
    </div>`;
  ov.appendChild(box);
  document.body.appendChild(ov);
  const input = box.querySelector('#pv-range-modal-input');
  input.focus();
  const close = () => { try { document.body.removeChild(ov); } catch {} };
  const apply = () => {
    const val = input.value.trim();
    if (val === '' || Number(val) === 0) { input.focus(); return; }
    rangeEl.value = val;
    rangeEl.dispatchEvent(new Event('input', { bubbles: true }));
    close();
  };
  box.querySelector('#pv-range-modal-ok').onclick = apply;
  box.querySelector('#pv-range-modal-skip').onclick = close;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') apply(); });
}

function addTab(code) {
  const subNo = nextSubNo();
  const id = `tab_${Date.now()}_${Math.random().toString(36).slice(2,5)}`;
  tabs.push({ id, code, label: makeLabel(code, subNo), pass: null, subNo });
  saveMeta();
  renderTabs();
  switchTab(id);
  promptRangeIfEmpty();   // 새 항목인데 측정범위 없으면 입력 유도
}
function removeTab(id) {
  if (tabs.length === 1) {
    if (isAdmin()) {
      delete adminInMemoryCache[id];
    }
    tabs = []; activeId = null; saveMeta(); renderTabs(); renderEmpty(); return;
  }
  if (isAdmin()) {
    delete adminInMemoryCache[id];
  } else {
    try { localStorage.removeItem(`ktl-pv-${id}`); } catch {}
  }
  const idx = tabs.findIndex(t => t.id === id);
  tabs.splice(idx, 1);
  if (activeId === id) activeId = tabs[Math.max(0, idx-1)].id;
  saveMeta();
  renderTabs();
  switchTab(activeId);
}

// ── 계산 ─────────────────────────────────────────────────
function g(id) { return parseFloat(document.getElementById(`pv_${id}`)?.value) || 0; }
function gv(id) { return parseFloat(document.getElementById(`pv_${id}`)?.value); } // NaN 허용

function badge(label, pass) {
  if (pass === null || pass === undefined) return `<div class="pv-badge pv-badge--na">— ${label}</div>`;
  return pass
    ? `<div class="pv-badge pv-badge--ok">✅ ${label} 적합</div>`
    : `<div class="pv-badge pv-badge--bad">❌ ${label} 부적합</div>`;
}
function row(k, v) { return `<div class="pv-line"><span>${k}</span><b>${v}</b></div>`; }

// 심플 1줄 게이지
function gauge(val, limit, label, lowerIsBetter = true) {
  if (!val && val !== 0) return '';
  // 엑셀: ROUND(val, 1) <= limit 기준
  const r1val = Math.round(val * 10) / 10;
  const pass = lowerIsBetter ? r1val <= limit : r1val >= limit;
  const cls = pass ? 'ok' : 'bad';
  const pct = Math.min((r1val / (limit * 2)) * 100, 100);
  return `<div class="pv-sg">
    <span class="pv-sg__label">${label}</span>
    <span class="pv-sg__val pv-sg__val--${cls}">${r1val.toFixed(1)}%</span>
    <div class="pv-sg__bar"><div class="pv-sg__fill pv-sg__fill--${cls}" style="width:${pct}%"></div></div>
    <span class="pv-sg__limit">기준 ${limit}%</span>
    <span class="pv-sg__icon">${pass ? '✅' : '❌'}</span>
  </div>`;
}

// 반복성 Z/S 카드 2열
function repCards(rep, zVals, sVals) {
  function card(label, cls, data, vals) {
    const p = data.pass;
    const pc = p === null || p === undefined ? 'na' : p ? 'ok' : 'bad';
    const icon = p === null || p === undefined ? '' : p ? '✅' : '❌';
    const verdict = p === null || p === undefined ? '—' : p ? '적합' : '부적합';
    const valsHtml = vals && vals.length
      ? `<div class="pv-rep-card__vals">${vals.map(v=>fmt(v,3)).join(', ')}</div>`
      : '';
    return `<div class="pv-rep-card pv-rep-card--${cls}">
      <div class="pv-rep-card__label">${label}</div>
      ${valsHtml}
      <div class="pv-rep-card__mean">평균 <b>${isNaN(data.mean) ? '—' : fmt(data.mean, 3)}</b></div>
      <div class="pv-rep-card__rsd pv-rep-card__rsd--${pc}">${isNaN(data.rsd) ? '측정값 부족' : (Math.round(data.rsd*10)/10).toFixed(1)+'%'}</div>
      <div class="pv-rep-card__limit">기준 RSD ≤ ${rep.limit}%</div>
      <div class="pv-rep-card__verdict pv-rep-card__verdict--${pc}">${icon} ${verdict}</div>
    </div>`;
  }
  // zVals===null 이면 Z카드 숨김 (DO 등 Span 전용 항목)
  const zCard = zVals !== null ? card('Z 제로', 'z', rep.zero, zVals) : '';
  const sCard = card('S 스팬', 's', rep.span, sVals);
  const single = !zCard;
  return `<div class="pv-rep-cards${single?' pv-rep-cards--single':''}">${zCard}${sCard}</div>`;
}

// 결과 테이블 단일열 행 (직선성 등 소형 테이블용)
function rt2(label, zVal, sVal, zPass, sPass, unit='') {
  if (zPass !== undefined && sPass !== undefined && zPass !== null && sPass !== null) {
    return `<tr class="verdict"><td>${label}</td>
      <td><span class="val--${zPass?'ok':'bad'}">${zPass?'적합':'부적합'}</span></td>
      <td><span class="val--${sPass?'ok':'bad'}">${sPass?'적합':'부적합'}</span></td></tr>`;
  }
  const zStr = (zVal===null||isNaN(zVal)) ? '—' : fmt(zVal,3)+unit;
  const sStr = (sVal===null||isNaN(sVal)) ? '—' : fmt(sVal,3)+unit;
  return `<tr><td>${label}</td><td>${zStr}</td><td>${sStr}</td></tr>`;
}

// 결과 테이블 단일열 행
function rt1(label, val, pass, unit='') {
  const valStr = (val===null||isNaN(val)) ? '—' : fmt(val,3)+unit;
  if (pass !== undefined && pass !== null) {
    return `<tr><td>${label}</td><td colspan="2"><span class="val--${pass?'ok':'bad'}">${pass?'적합':'부적합'}</span></td></tr>`;
  }
  return `<tr><td>${label}</td><td colspan="2">${valStr}</td></tr>`;
}

// ── 계산: 기본형 (TOC/TN/TP/SS/COD) ─────────────────────
// Z6/Z7 모두 입력 시 [Z5,Z6,Z7] 사용, 그 외 4콤보 자동선택 (Z6만 입력은 무시)
function pickRepVals(z5, z6, z7, initVals, finVals) {
  if (isNaN(z5)) return [];
  const z6ok = !isNaN(z6), z7ok = !isNaN(z7);
  if (z6ok && z7ok) return [z5, z6, z7];
  const iv = initVals.filter(v=>!isNaN(v)), fv = finVals.filter(v=>!isNaN(v));
  if (!iv.length || !fv.length) return [z5];
  let best = {s:-1, a:null, b:null};
  for (const a of iv) for (const b of fv) {
    const m=(z5+a+b)/3, s=Math.sqrt(((z5-m)**2+(a-m)**2+(b-m)**2)/2);
    if (s > best.s) best = {s, a, b};
  }
  return [z5, best.a, best.b];
}

// pickRepVals와 동일한 로직으로 어떤 필드가 선택됐는지 레이블까지 반환
function pickRepWithLabels(refVal, refLabel, extVals, extLabels, initPairs, finPairs) {
  // extVals = [z6,z7] or [s6,s7], extLabels = ['Z6','Z7'] etc.
  if (!Number.isFinite(refVal)) return null;
  const z6ok = Number.isFinite(extVals[0]);
  const z7ok = Number.isFinite(extVals[1]);
  if (z6ok && z7ok) {
    return [
      {label: refLabel,        val: refVal},
      {label: extLabels[0],    val: extVals[0]},
      {label: extLabels[1],    val: extVals[1]},
    ];
  }
  const iv = initPairs.filter(p => !isNaN(p.val));
  const fv = finPairs.filter(p => !isNaN(p.val));
  if (!iv.length || !fv.length) return [{label: refLabel, val: refVal}];
  let best = {s: -1, a: null, b: null};
  for (const a of iv) for (const b of fv) {
    const m = (refVal + a.val + b.val) / 3;
    const s = Math.sqrt(((refVal-m)**2 + (a.val-m)**2 + (b.val-m)**2) / 2);
    if (s > best.s) best = {s, a, b};
  }
  return [
    {label: refLabel, val: refVal},
    {label: best.a.label, val: best.a.val},
    {label: best.b.label, val: best.b.val},
  ];
}

function calcBasic(tab) {
  const range = g('range');
  if (!range) return;

  const zRepVals = pickRepVals(gv('z5'),gv('z6'),gv('z7'),[gv('z1'),gv('z2')],[gv('z3'),gv('z4')]);
  const sRepVals = pickRepVals(gv('s5'),gv('s6'),gv('s7'),[gv('s1'),gv('s2')],[gv('s3'),gv('s4')]);
  const rep = repeatability(zRepVals, sRepVals, range);
  document.getElementById('pv-res-rep').innerHTML = repCards(rep, zRepVals, sRepVals);

  // 드리프트: 초기[Z1,Z2] → 최종[Z3,Z4] / 초기[S1,S2] → 최종[S3,S4]
  const dr = drift(range, [gv('z1'),gv('z2')], [gv('z3'),gv('z4')], [gv('s1'),gv('s2')], [gv('s3'),gv('s4')]);
  document.getElementById('pv-res-drift').innerHTML =
    gauge(dr.zeroDrift, PRECISION_CRITERIA.zeroDrift, '제로드리프트') +
    gauge(dr.spanDrift, PRECISION_CRITERIA.spanDrift, '스팬드리프트');

  // 직선성: M1,M2,M3
  const lin = linearity(range, [gv('m1'),gv('m2'),gv('m3')]);
  document.getElementById('pv-res-lin').innerHTML =
    `<div class="pv-lines">
      ${row('기준값', fmt(lin.ref,3))}
      ${row('평균', fmt(lin.avg,3))}
      ${row('오차', `${fmt(lin.error,1)}%`)}
    </div>` +
    gauge(lin.error, PRECISION_CRITERIA.linearity, '직선성');

  // 측정범위 검사: 초과 체크 + 표준용액 0값 체크 (0은 측정 불가 → 부적합, 제로용액 z1~z7은 제외)
  const nonZeroFields = ['s1','s2','s3','s4','s5','s6','s7','m1','m2','m3'];
  const zeroEntered = nonZeroFields.filter(id => { const v=gv(id); return !isNaN(v) && v===0; });
  const allMeasured = [gv('s1'),gv('s2'),gv('s3'),gv('s4'),gv('s5'),gv('m1'),gv('m2'),gv('m3')].filter(v=>v>0);
  const rangeExceeded = allMeasured.some(v => v > range);
  const rangeBlock = document.getElementById('pv-res-range-block');
  const rangeEl = document.getElementById('pv-res-range');
  if (rangeEl && rangeBlock) {
    let html = '';
    if (zeroEntered.length > 0) {
      html += `<div class="pv-lines">${row('0값 입력', zeroEntered.map(id=>id.toUpperCase()).join(', '))}</div>
        <div class="pv-badges">${badge('표준용액 0값 — 측정 오류 확인 필요', false)}</div>`;
    }
    if (rangeExceeded) {
      const exceeded = allMeasured.filter(v => v > range);
      html += `<div class="pv-lines">${row('측정범위', fmt(range,3))} ${row('초과 값', exceeded.map(v=>fmt(v,3)).join(', '))}</div>
        <div class="pv-badges">${badge(`측정값이 측정범위(${range})를 초과함`, false)}</div>`;
    }
    if (!html) {
      html = `<div class="pv-badges">${badge(`모든 측정값 ≤ 측정범위(${range})`, true)}</div>`;
    }
    rangeEl.innerHTML = html;
    rangeBlock.hidden = false;
  }
  const rangePass = !rangeExceeded && zeroEntered.length === 0;

  // 현장적용계수
  const ci1=gv('ci1'),ci2=gv('ci2'),ai1=gv('ai1'),ai2=gv('ai2'),ai3=gv('ai3'),ai4=gv('ai4');
  let fieldPass = null;
  const fieldBlock = document.getElementById('pv-res-field-block');
  if (!isNaN(ci1)||!isNaN(ci2)||!isNaN(ai1)||!isNaN(ai2)||!isNaN(ai3)||!isNaN(ai4)) {
    const highVar = !!document.getElementById('pv_highvar')?.checked;
    const fRes = fieldApplication(tab.code, [ai1,ai2,ai3,ai4], [ci1,ci2], {discharge:gv('fdis'), highVariability:highVar});
    document.getElementById('pv-res-field').innerHTML =
      `<div class="pv-lines">
        ${row('수분석 평균 (Ai)', fmt(fRes.labMean,3))}
        ${row('현장측정 평균 (Ci)', fmt(fRes.siteMean,3))}
        ${fRes.highVariability
          ? row('변동성 큰 시료', `오차율 ${fmt(fRes.meanRate,1)}% (≤15%) AND 절대오차 ${fmt(fRes.meanFi,3)} mg/L (≤0.5)`)
          : fRes.useDischarge
            ? row('Fi/배출기준', `${fmt(fRes.dischargeRate,1)}% (기준 ≤15%)`)
            : fRes.useRate
              ? row('오차율 (Fi/Ai)', `${fmt(fRes.meanRate,1)}% (기준 ≤${fRes.limit}%)`)
              : row('절대오차 (Fi)', `${fmt(fRes.meanFi,3)} mg/L (기준 ≤${fRes.limit} mg/L)`)}
      </div><div class="pv-badges">${badge(`${tab.code} 현장적용계수`, fRes.pass)}</div>`;
    fieldPass = fRes.pass;
    if (fieldBlock) fieldBlock.hidden = false;
  } else {
    if (fieldBlock) fieldBlock.hidden = true;
  }

  // 응답시간 (TOC 전용) - 기준 ≤ 15분
  let respPass = null;
  if (tab.code === 'TOC') {
    const resp = g('resp');
    const respLimit = 15; // 분(min) 단위
    const respBlock = document.getElementById('pv-res-resp-block');
    if (resp) {
      respPass = resp <= respLimit;
      document.getElementById('pv-res-resp').innerHTML =
        `<div class="pv-lines">
          ${row('측정값 (T90)', `${fmt(resp,1)}분`)}
          ${row('기준', '≤ 15분')}
        </div><div class="pv-badges">${badge(`응답시간 ≤ 15분`, respPass)}</div>`;
      if (respBlock) respBlock.hidden = false;
    } else {
      if (respBlock) respBlock.hidden = true;
    }
  }

  // COD 포도당변동성
  let glucPass = null;
  if (IS_COD(tab.code)) {
    const codmax=g('codmax'), codmin=g('codmin');
    const glucBlock = document.getElementById('pv-res-gluc-block');
    if (codmax || codmin) {
      const gRes = codGlucoseVariability(codmax, codmin, g('range'));
      document.getElementById('pv-res-gluc').innerHTML =
        `<div class="pv-lines">
          ${row('최댓값', fmt(codmax,3))} ${row('최솟값', fmt(codmin,3))}
          ${row('변동범위', `${fmt(codmax-codmin,3)}`)} ${row('오차', `${fmt(gRes.error)}%`)}
        </div><div class="pv-badges">
          ${badge(`포도당변동성 ≤ ${PRECISION_CRITERIA.codGlucose}%`, gRes.pass)}
        </div>`;
      glucPass = gRes.pass;
      if (glucBlock) glucBlock.hidden = false;
    } else {
      if (glucBlock) glucBlock.hidden = true;
    }
  }

  const requiredPasses = [rep.zero.pass, rep.span.pass, dr.zeroPass, dr.spanPass, lin.pass];
  if (tab.code === 'TOC') requiredPasses.push(respPass);
  if (IS_COD(tab.code)) requiredPasses.push(glucPass);

  const optionalPasses = [fieldPass];

  updateFinal(tab, requiredPasses, optionalPasses, rangePass);
}

// ── 계산: pH ─────────────────────────────────────────────
function calcPH(tab) {
  const z7 = [gv('ph7a'),gv('ph7b'),gv('ph7c')];
  const z4 = [gv('ph4a'),gv('ph4b'),gv('ph4c')];
  const rep = repeatability(z7, z4);
  document.getElementById('pv-res-rep').innerHTML = repCards({
    zero: { mean: rep.zero.mean, rsd: rep.zero.rsd, pass: rep.zero.pass },
    span: { mean: rep.span.mean, rsd: rep.span.rsd, pass: rep.span.pass },
    limit: rep.limit,
  });

  const dr = drift(14, [gv('phdi')], [gv('phdf')], [gv('phdi')], [gv('phdf')]);
  document.getElementById('pv-res-drift').innerHTML =
    `<div class="pv-lines">
      ${row('초기', fmt(gv('phdi'),3))}
      ${row('2시간후', fmt(gv('phdf'),3))}
    </div>` +
    gauge(dr.zeroDrift, PRECISION_CRITERIA.zeroDrift, '드리프트');

  const lin = phLinearity([gv('phm4'),gv('phm7'),gv('phm10')]);
  document.getElementById('pv-res-lin').innerHTML =
    `<div class="pv-lines">
      ${row('pH4 측정', fmt(gv('phm4'),2))}
      ${row('pH7 측정', fmt(gv('phm7'),2))}
      ${row('pH10 측정', fmt(gv('phm10'),2))}
      ${row('max-min', fmt(lin.max-lin.min,3))} ${row('오차/범위', `${fmt(lin.error, 1)}%`)}
    </div><div class="pv-badges">
      ${badge(`직선성 ≤ ${PRECISION_CRITERIA.linearity}%`, lin.pass)}
    </div>`;

  const temps = {t10:gv('pht10'),t15:gv('pht15'),t20:gv('pht20'),t25:gv('pht25'),t30:gv('pht30')};
  const tc = phTemperatureComp(temps);
  const tcBlock = document.getElementById('pv-res-tc-block');
  let tcPass = null;
  if (Object.values(temps).some(v=>!isNaN(v))) {
    document.getElementById('pv-res-tc').innerHTML =
      `<div class="pv-lines">
        ${row('10℃', fmt(temps.t10,2))} ${row('15℃', fmt(temps.t15,2))} ${row('20℃', fmt(temps.t20,2))}
        ${row('25℃', fmt(temps.t25,2))} ${row('30℃', fmt(temps.t30,2))}
        ${row('max', fmt(tc.max,2))} ${row('min', fmt(tc.min,2))} ${row('max-min', fmt(tc.range,3))}
      </div><div class="pv-badges">
        ${badge(`온도보상 max-min ≤ ${PRECISION_CRITERIA.phTempComp}`, tc.pass)}
      </div>`;
    tcPass = tc.pass;
    if (tcBlock) tcBlock.hidden = false;
  } else {
    if (tcBlock) tcBlock.hidden = true;
  }

  const ci1=gv('phci1'),ci2=gv('phci2'),ai1=gv('phai1'),ai2=gv('phai2'),ai3=gv('phai3'),ai4=gv('phai4');
  let fieldPass = null;
  const fieldBlock = document.getElementById('pv-res-field-block');
  if (!isNaN(ci1)||!isNaN(ci2)||!isNaN(ai1)||!isNaN(ai2)||!isNaN(ai3)||!isNaN(ai4)) {
    const fRes = fieldApplication('PH', [ai1,ai2,ai3,ai4], [ci1,ci2]);
    document.getElementById('pv-res-field').innerHTML =
      `<div class="pv-lines">
        ${row('수분석 평균 (Ai)', fmt(fRes.labMean,2))}
        ${row('현장측정 평균 (Ci)', fmt(fRes.siteMean,2))}
        ${row('허용오차', `±${fmt(fRes.limit,2)}`)}
      </div><div class="pv-badges">${badge('pH 현장적용계수', fRes.pass)}</div>`;
    fieldPass = fRes.pass;
    if (fieldBlock) fieldBlock.hidden = false;
  } else {
    if (fieldBlock) fieldBlock.hidden = true;
  }

  const requiredPasses = [rep.zero.pass, rep.span.pass, dr.zeroPass, lin.pass, tcPass];
  const optionalPasses = [fieldPass];
  updateFinal(tab, requiredPasses, optionalPasses);
}

// ── 계산: DO ─────────────────────────────────────────────
function calcDO(tab) {
  const range = 20;

  const sRepVals = [gv('dos1'),gv('dos2'),gv('dos3')].filter(v=>!isNaN(v));
  const rep = repeatability([], sRepVals, range);
  document.getElementById('pv-res-rep').innerHTML = repCards(
    { zero: rep.zero, span: rep.span, limit: rep.limit },
    null,                       // Z카드 숨김 — DO는 Span(S) 기준
    sRepVals
  );

  const dr = drift(range, [gv('dozi')], [gv('dozf')], [gv('dosi')], [gv('dosf')]);
  document.getElementById('pv-res-drift').innerHTML =
    `<div class="pv-lines">
      ${row('Z초기', fmt(gv('dozi'),3))} ${row('Z2시간', fmt(gv('dozf'),3))}
      ${row('S초기', fmt(gv('dosi'),3))} ${row('S2시간', fmt(gv('dosf'),3))}
    </div>` +
    gauge(dr.zeroDrift, PRECISION_CRITERIA.zeroDrift, '제로드리프트') +
    gauge(dr.spanDrift, PRECISION_CRITERIA.spanDrift, '스팬드리프트');

  const lin = doLinearity(gv('domax'), gv('domin'), range);
  document.getElementById('pv-res-lin').innerHTML =
    `<div class="pv-lines">
      ${row('최댓값', fmt(gv('domax'),3))} ${row('최솟값', fmt(gv('domin'),3))}
      ${row('max-min/범위', `${fmt(lin.error, 1)}%`)}
    </div><div class="pv-badges">
      ${badge(`직선성 ≤ ${PRECISION_CRITERIA.linearity}%`, lin.pass)}
    </div>`;

  const m20=gv('dot20'), m30=gv('dot30');
  let tcPass = null;
  const tcBlock = document.getElementById('pv-res-tc-block');
  if (!isNaN(m20) || !isNaN(m30)) {
    const tc = doTemperatureComp(m20, m30);
    document.getElementById('pv-res-tc').innerHTML =
      `<div class="pv-lines">
        ${row('20℃ 측정', fmt(m20,3))} ${row('기준 (9.092)', fmt(DO_SPAN_TABLE[20],3))} ${row('편차', `${fmt(tc.t20.dev,3)} mg/L`)}
        ${row('30℃ 측정', fmt(m30,3))} ${row('기준 (7.559)', fmt(DO_SPAN_TABLE[30],3))} ${row('편차', `${fmt(tc.t30.dev,3)} mg/L`)}
        ${row('최대 편차', `${fmt(tc.maxDev,2)} mg/L (기준 ≤ ${tc.limit})`)}
      </div><div class="pv-badges">
        ${badge(`DO 온도보상 |편차| ≤ ${tc.limit} mg/L`, tc.pass)}
      </div>`;
    tcPass = tc.pass;
    if (tcBlock) tcBlock.hidden = false;
  } else {
    if (tcBlock) tcBlock.hidden = true;
  }

  const resp = gv('resp');
  const respLimit = 120;
  let respPass = null;
  const respBlock = document.getElementById('pv-res-resp-block');
  if (!isNaN(resp)) {
    respPass = resp <= respLimit;
    document.getElementById('pv-res-resp').innerHTML =
      `<div class="pv-lines">
        ${row('측정값 (T90)', `${fmt(resp,0)}초`)} ${row('기준', '≤ 120초')}
        </div><div class="pv-badges">${badge('응답시간 ≤ 120초', respPass)}</div>`;
    if (respBlock) respBlock.hidden = false;
  } else {
    if (respBlock) respBlock.hidden = true;
  }

  const requiredPasses = [rep.span.pass, dr.zeroPass, dr.spanPass, lin.pass, tcPass, respPass];
  updateFinal(tab, requiredPasses);
}

// ── 계산: 먹는물 (TU/CL) ────────────────────────────────
function calcWater(tab) {
  const range = g('range');
  if (!range) return;

  // 반복성: 4콤보 pickRepVals (TMS와 동일 엑셀 로직) — TU/CL 기준 2.0%
  const zRepVals = pickRepVals(gv('z5'),gv('z6'),gv('z7'),[gv('z1'),gv('z2')],[gv('z3'),gv('z4')]);
  const sRepVals = pickRepVals(gv('s5'),gv('s6'),gv('s7'),[gv('s1'),gv('s2')],[gv('s3'),gv('s4')]);
  const rep = repeatability(zRepVals, sRepVals, range, 2.0);
  document.getElementById('pv-res-rep').innerHTML = repCards(rep, zRepVals, sRepVals);

  // 드리프트: TU/CL 기준 ≤ 3% (TMS는 5%)
  const WATER_DRIFT_LIMIT = 3;
  const dr = drift(range, [gv('z1'),gv('z2')], [gv('z3'),gv('z4')], [gv('s1'),gv('s2')], [gv('s3'),gv('s4')], { zero: WATER_DRIFT_LIMIT, span: WATER_DRIFT_LIMIT });
  document.getElementById('pv-res-drift').innerHTML =
    gauge(dr.zeroDrift, WATER_DRIFT_LIMIT, '제로드리프트') +
    gauge(dr.spanDrift, WATER_DRIFT_LIMIT, '스팬드리프트');

  // 직선성: 기준값 = S1/2 (TMS는 range×0.45)
  const linRef = gv('s1') > 0 ? gv('s1') / 2 : undefined;
  const lin = linearity(range, [gv('m1')], linRef);
  document.getElementById('pv-res-lin').innerHTML =
    `<div class="pv-lines">
      ${row('기준값 (S1÷2)', fmt(lin.ref,3))} ${row('주입농도 M', fmt(gv('m1'),3))} ${row('오차', `${fmt(lin.error, 1)}%`)}
    </div><div class="pv-badges">
      ${badge(`직선성 ≤ ${PRECISION_CRITERIA.linearity}%`, lin.pass)}
    </div>`;
  
  const respSkip = document.getElementById('pv_resp_skip')?.checked;
  const resp = gv('resp');
  const s1val = gv('s1');
  const respLimit = s1val ? s1val * 0.5 : null;
  const respBlock = document.getElementById('pv-res-resp-block');
  let respPass = null;
  if (respSkip) {
    if (respBlock) respBlock.hidden = true;
  } else if (!isNaN(resp) && respLimit !== null) {
    respPass = resp >= respLimit;
    document.getElementById('pv-res-resp').innerHTML =
      `<div class="pv-lines">${row('측정값', `${fmt(resp,2)}`)}
        ${row('기준 (S1×0.5)', `≥ ${fmt(respLimit,2)}`)}</div>
       <div class="pv-badges">${badge(`응답값 ≥ S1×0.5`, respPass)}</div>`;
    if (respBlock) respBlock.hidden = false;
  } else {
    if (respBlock) respBlock.hidden = true;
  }
  // 측정범위 초과 체크: S값, M값이 range를 초과하면 부적합
  const allMeasured = [gv('s1'),gv('s2'),gv('s3'),gv('s4'),gv('s5'),gv('m1'),gv('m2'),gv('m3')].filter(v=>v>0);
  const rangeExceeded = allMeasured.some(v => v > range);
  if (rangeExceeded) {
    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = '⚠️ 측정범위(' + range + ')를 초과한 값이 있습니다. 측정범위를 확인하세요.';
    document.getElementById('pv-res-rep')?.before(note);
  }
  const requiredPasses = [
    rep.zero.pass,
    rep.span.pass,
    dr.zeroPass,
    dr.spanPass,
    lin.pass,
    rangeExceeded ? false : true
  ];
  if (!respSkip) {
    requiredPasses.push(respPass);
  }
  updateFinal(tab, requiredPasses);
}

function updateFinal(tab, passes) {
  // 필수항목 판정:
  //  - 하나라도 부적합(false) → 부적합
  //  - 부적합은 없지만 미입력(null) 필수항목이 있으면 → 미완성('') = '적합' 아님
  //  - 모든 필수항목이 입력되고 전부 통과 → 적합
  // (기존 버그: null을 걸러낸 뒤 '입력된 것만 통과'면 적합 → 미들 하나만 넣어도 전항목적합 표시)
  const hasFail    = passes.some(p => p === false);
  const hasMissing = passes.some(p => p === null || p === undefined);
  let tabState = '';
  if (hasFail) {
    tabState = 'bad';
  } else if (hasMissing) {
    tabState = '';            // 측정값 부족 → 미완성 (적합으로 보지 않음)
  } else if (passes.length > 0) {
    tabState = 'ok';          // 전 필수항목 입력 완료 + 전부 적합
  }

  document.getElementById('pv-final').innerHTML =
    `<div class="pv-final-banner pv-final-banner--${tabState || 'none'}">
      ${tabState === 'ok' ? '✅ 전 항목 적합' : tabState === 'bad' ? '❌ 부적합 항목 있음' : 'ℹ️ 데이터 입력 필요'}
    </div>`;
  document.getElementById('pv-results').hidden = false;
  tab.pass = tabState;
  saveMeta();
  const btn = document.querySelector(`.pv-item-tab[data-id="${tab.id}"]`);
  if (btn) btn.dataset.pass = tab.pass;
  loadLegalBasis(tab.code);
}

// 법령근거 API 호출 — 1일 캐시(서버), 클라이언트도 탭당 1회 fetch
const _legalCache = new Map();
async function loadLegalBasis(code) {
  const el = document.getElementById('pv-legal-content');
  if (!el) return;

  if (_legalCache.has(code)) {
    renderLegal(el, _legalCache.get(code));
    return;
  }

  el.innerHTML = '<div class="pv-legal-loading">법령 조회 중…</div>';
  try {
    const res = await fetch(`/api/legalBasis?item=${code}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    _legalCache.set(code, d);
    renderLegal(el, d);
  } catch {
    el.innerHTML = '<div class="pv-legal-err">법령 조회 실패 — 네트워크를 확인하세요</div>';
  }
}

function renderLegal(el, d) {
  const criteriaHtml = d.정도검사기준
    ? Object.entries(d.정도검사기준)
        .map(([k, v]) => `<div class="pv-legal-criterion"><span class="pv-legal-key">${k}</span><b class="pv-legal-val">${v}</b></div>`)
        .join('')
    : '<span class="pv-legal-na">기준값 정보 없음</span>';

  const refsHtml = d.법령근거
    .map(l => `<a class="pv-legal-ref" href="${l.링크}" target="_blank" rel="noopener noreferrer">${l.법령명}<span class="pv-legal-ref__org"> · ${l.소관기관}</span></a>`)
    .join('');

  el.innerHTML = `
    <div class="pv-legal-meta">
      <span>분야 <b>${d.분야}</b></span>
      <span>기기명 <b>${d.기기명}</b></span>
      <span>정도검사주기 <b>${d.정도검사주기}</b></span>
    </div>
    <div class="pv-legal-criteria">${criteriaHtml}</div>
    <div class="pv-legal-refs">${refsHtml}</div>
    <div class="pv-legal-source">출처: ${d.출처} · ${d.조회일시} 기준</div>`;
}

// ── Z5/S5 힌트: 4콤보 STDEV최대 조합 + std/range ≤ limit% 통과 범위 수치계산 (수학적 폐형식 해공식) ──
function computeRepZ5Range(initVals, finVals, range, limit = 3) {
  const iv = initVals.filter(v => !isNaN(v));
  const fv = finVals.filter(v => !isNaN(v));
  if (!iv.length || !fv.length || !(range > 0)) return { lo: NaN, hi: NaN, passable: false, impossible: false };

  // 엑셀 ROUND(rsd, 1) <= limit 판정을 고려한 허용 최대 std 계산 (rsd < limit + 0.05)
  const limitWithRound = limit + 0.0499;
  const sMax = range * (limitWithRound / 100);
  const sMaxSq = sMax * sMax;

  let overallLo = -Infinity;
  let overallHi = Infinity;

  for (const a of iv) {
    for (const b of fv) {
      const d = a - b;
      const dSqTerm = 0.25 * d * d;
      const insideSqrt = sMaxSq - dSqTerm;
      if (insideSqrt < 0) {
        // 이미 2점 간의 편차가 너무 커서 어떤 Z5를 대입해도 기준을 만족할 수 없음
        return { lo: NaN, hi: NaN, passable: false, impossible: true };
      }
      const w = Math.sqrt(3 * insideSqrt);
      const c = (a + b) / 2;
      const lo = c - w;
      const hi = c + w;

      if (lo > overallLo) overallLo = lo;
      if (hi < overallHi) overallHi = hi;
    }
  }

  // 0 ~ range 범위로 제한
  overallLo = Math.max(0, overallLo);
  overallHi = Math.min(range, overallHi);

  if (overallLo > overallHi) {
    return { lo: NaN, hi: NaN, passable: false, impossible: true };
  }

  return { lo: overallLo, hi: overallHi, passable: true, impossible: false };
}

// ── 인라인 힌트 바 ───────────────────────────────────────────
function setHint(id, lo, hi, cur) {
  const el = document.getElementById(`pv_hint_${id}`);
  if (!el) return;
  if (isNaN(lo) || isNaN(hi)) { el.className = 'pv-zs-range-hint'; el.textContent = ''; return; }
  // 보수적 표시: 하한 올림(ceil), 상한 내림(floor) — 경계값 부동소수점 오차 방지
  const loDisp = Math.ceil(lo * 1000) / 1000;
  const hiDisp = Math.floor(hi * 1000) / 1000;
  const f = v => Number(v).toFixed(3).replace(/\.?0+$/, '');
  const inRange = !isNaN(cur) && cur >= loDisp && cur <= hiDisp;
  const outRange = !isNaN(cur) && (cur < loDisp || cur > hiDisp);
  el.className = 'pv-zs-range-hint' +
    (inRange ? ' pv-zs-range-hint--ok' : outRange ? ' pv-zs-range-hint--ng' : '');
  el.textContent = `${f(loDisp)} ~ ${f(hiDisp)}`;
}

// 통과 불가 참고점 — 어떤 값을 넣어도 부적합
function setHintRef(id, ref, cur, impossible = false) {
  const el = document.getElementById(`pv_hint_${id}`);
  if (!el) return;
  // 음수 입력 = 명백히 잘못된 값 → 빨간 오류 표시
  if (!isNaN(cur) && cur < 0) {
    el.className = 'pv-zs-range-hint pv-zs-range-hint--ng';
    el.textContent = '⚠ 음수 불가';
    return;
  }
  if (impossible) {
    el.className = 'pv-zs-range-hint pv-zs-range-hint--ng';
    el.textContent = '어떤값도 부적합';
    return;
  }
  if (isNaN(ref)) { el.className = 'pv-zs-range-hint'; el.textContent = ''; return; }
  el.className = 'pv-zs-range-hint pv-zs-range-hint--ng';
  el.textContent = '어떤값도 부적합';
}

// 직선성 M 힌트 (기준값 ref ± 5%)
function setLinHint(id, ref, cur) {
  const el = document.getElementById(`pv_hint_${id}`);
  if (!el) return;
  if (isNaN(ref)) { el.className = 'pv-lin-hint'; el.textContent = ''; return; }
  const f = v => Number(v).toFixed(2).replace(/\.?0+$/, '');
  const lo = ref * 0.95, hi = ref * 1.05;
  const inRange = !isNaN(cur) && cur >= lo && cur <= hi;
  const outRange = !isNaN(cur) && (cur < lo || cur > hi);
  el.className = 'pv-lin-hint' +
    (inRange ? ' pv-lin-hint--ok' : outRange ? ' pv-lin-hint--ng' : '');
  el.textContent = `목표 ${f(lo)} ~ ${f(hi)}`;
}

function updateInlineHints(code) {
  const range = g('range');

  // ── 기본형: TOC/TN/TP/SS/COD & 먹는물: TU/CL ──────────────────────────────
  if (IS_BASIC(code) || IS_COD(code) || IS_WATER(code)) {
    const isWater = IS_WATER(code);
    const repLimit = isWater ? 2.0 : 3.0;
    const driftLimit = isWater ? 3.0 : 5.0;

    const clear = ids => ids.forEach(id => setHint(id, NaN, NaN, NaN));
    if (!range) { clear(['z2','z3','z4','z5','z6','z7','s2','s3','s4','s5','s6','s7']); return; }

    const z1=gv('z1'), z2=gv('z2'), z3=gv('z3'), z4=gv('z4');
    const s1=gv('s1'), s2=gv('s2'), s3=gv('s3'), s4=gv('s4');
    const z5=gv('z5'), s5=gv('s5');

    const ziMean = !isNaN(z1) && !isNaN(z2) ? (z1+z2)/2 : z1;  // 초기구간 평균
    const siMean = !isNaN(s1) && !isNaN(s2) ? (s1+s2)/2 : s1;

    // 힌트 범위를 [0, range]로 클램프 — 음수·범위초과 표시 방지
    const clamp = (v, r) => isNaN(v) ? NaN : Math.max(0, Math.min(r, v));
    const sh = (id, lo, hi, cur) => setHint(id, clamp(lo, range), clamp(hi, range), cur);

    // Z2/S2: Z1/S1 기준 ±4% (기존 TU/CL 초기구간 힌트 유지용, 기본형은 Z2 힌트 없음)
    if (isWater) {
      const repT = v => v * 0.04;
      sh('z2', !isNaN(z1) ? z1-repT(z1) : NaN, !isNaN(z1) ? z1+repT(z1) : NaN, z2);
      sh('s2', !isNaN(s1) ? s1-repT(s1) : NaN, !isNaN(s1) ? s1+repT(s1) : NaN, s2);
    } else {
      setHint('z2', NaN, NaN, z2);
      setHint('s2', NaN, NaN, s2);
    }

    // Z3/Z4: 엑셀 기준 ROUND(drift,1) <= driftLimit 통과 범위
    // drift 경계: |mean(Z3,Z4)-ziMean|/range*100 < driftLimit + 0.05
    const driftMax = range * ((driftLimit + 0.0499) / 100);
    const z3Lo = !isNaN(ziMean) ? (!isNaN(z4) ? 2*(ziMean-driftMax)-z4 : ziMean-driftMax) : NaN;
    const z3Hi = !isNaN(ziMean) ? (!isNaN(z4) ? 2*(ziMean+driftMax)-z4 : ziMean+driftMax) : NaN;
    const z4Lo = !isNaN(ziMean) ? (!isNaN(z3) ? 2*(ziMean-driftMax)-z3 : ziMean-driftMax) : NaN;
    const z4Hi = !isNaN(ziMean) ? (!isNaN(z3) ? 2*(ziMean+driftMax)-z3 : ziMean+driftMax) : NaN;
    sh('z3', z3Lo, z3Hi, z3);
    sh('z4', z4Lo, z4Hi, z4);

    const s3Lo = !isNaN(siMean) ? (!isNaN(s4) ? 2*(siMean-driftMax)-s4 : siMean-driftMax) : NaN;
    const s3Hi = !isNaN(siMean) ? (!isNaN(s4) ? 2*(siMean+driftMax)-s4 : siMean+driftMax) : NaN;
    const s4Lo = !isNaN(siMean) ? (!isNaN(s3) ? 2*(siMean-driftMax)-s3 : siMean-driftMax) : NaN;
    const s4Hi = !isNaN(siMean) ? (!isNaN(s3) ? 2*(siMean+driftMax)-s3 : siMean+driftMax) : NaN;
    sh('s3', s3Lo, s3Hi, s3);
    sh('s4', s4Lo, s4Hi, s4);

    // Z5/S5 통과범위 힌트:
    //  - Z6/Z7(S6/S7) 둘 다 입력 → 별도측정 방식([Z5,Z6,Z7]) 기준으로 Z5 통과범위 계산
    //  - 아니면 → 드리프트 유도 4콤보(Z1~Z4) 기준
    const z6=gv('z6'), z7=gv('z7'), s6=gv('s6'), s7=gv('s7');
    const z6z7 = !isNaN(z6) && !isNaN(z7);
    const s6s7 = !isNaN(s6) && !isNaN(s7);
    const z5r = z6z7 ? computeRepZ5Range([z6],[z7], range, repLimit) : computeRepZ5Range([z1,z2],[z3,z4], range, repLimit);
    const s5r = s6s7 ? computeRepZ5Range([s6],[s7], range, repLimit) : computeRepZ5Range([s1,s2],[s3,s4], range, repLimit);
    if (z5r.passable) setHint('z5', z5r.lo, z5r.hi, z5);
    else setHintRef('z5', z5r.lo, z5, z5r.impossible);
    if (s5r.passable) setHint('s5', s5r.lo, s5r.hi, s5);
    else setHintRef('s5', s5r.lo, s5, s5r.impossible);

    // Z6/Z7: Z5 기준값 ± range × repLimit% × √3
    const repAbs = range * (repLimit / 100) * Math.sqrt(3);
    if (!isNaN(z5)) {
      sh('z6', z5-repAbs, z5+repAbs, z6);
      sh('z7', z5-repAbs, z5+repAbs, z7);
    } else {
      setHint('z6', NaN, NaN, z6);
      setHint('z7', NaN, NaN, z7);
    }
    if (!isNaN(s5)) {
      sh('s6', s5-repAbs, s5+repAbs, s6);
      sh('s7', s5-repAbs, s5+repAbs, s7);
    } else {
      setHint('s6', NaN, NaN, s6);
      setHint('s7', NaN, NaN, s7);
    }

    // 드리프트·반복성·직선성 요약바
    updateDriftSummary(range);
    updateRepSummary(range, repLimit);
    updateLinSummary(range, isWater ? gv('s1') : undefined);
    return;
  }
}

function updateLinSummary(range, s1ForWater) {
  const el = document.getElementById('pv_lin_summary');
  if (!el) return;
  if (!range) { el.className = 'pv-lin-summary'; el.innerHTML = ''; return; }
  const ref = (s1ForWater > 0) ? s1ForWater / 2 : range * 0.45;
  const f = v => Number(v).toFixed(2);
  const lo = ref * 0.95, hi = ref * 1.05;
  const vals = [gv('m1'), gv('m2'), gv('m3')].filter(v => !isNaN(v));

  // 측정범위만 들어와도 기준값·목표는 바로 표시 (range로 계산됨). 측정값 들어오면 평균·적합 추가.
  if (vals.length === 0) {
    el.className = 'pv-lin-summary';
    el.innerHTML =
      `<span class="pv-lin-summary__label">기준값 ${f(ref)}</span>` +
      `<span class="pv-lin-summary__sep">·</span>` +
      `<span class="pv-lin-summary__range">목표 ${f(lo)} ~ ${f(hi)}</span>`;
    return;
  }

  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const error = Math.abs((avg - ref) / ref * 100);
  const pass = error <= 5.0;
  el.className = 'pv-lin-summary pv-lin-summary--' + (pass ? 'ok' : 'ng');
  el.innerHTML =
    `<span class="pv-lin-summary__label">평균 ${f(avg)}</span>` +
    `<span class="pv-lin-summary__sep">·</span>` +
    `<span class="pv-lin-summary__range">목표 ${f(lo)} ~ ${f(hi)}</span>` +
    `<span class="pv-lin-summary__sep">·</span>` +
    `<span class="pv-lin-summary__status">${pass ? '✓ 적합' : '✗ ' + f(error) + '%'}</span>`;
}

function updateDriftSummary(range) {
  const el = document.getElementById('pv_drift_summary');
  if (!el) return;
  const f2 = v => Number(v).toFixed(2);
  const z1=gv('z1'),z2=gv('z2'),z3=gv('z3'),z4=gv('z4');
  const s1=gv('s1'),s2=gv('s2'),s3=gv('s3'),s4=gv('s4');
  const hasZ = [z1,z2,z3,z4].every(v=>!isNaN(v)&&v>0);
  const hasS = [s1,s2,s3,s4].every(v=>!isNaN(v)&&v>0);
  if (!range || (!hasZ && !hasS)) { el.className='pv-lin-summary'; el.innerHTML=''; return; }
  const zd = hasZ ? Math.abs(((z3+z4)/2 - (z1+z2)/2) / range * 100) : null;
  const sd = hasS ? Math.abs(((s3+s4)/2 - (s1+s2)/2) / range * 100) : null;
  const limit = 5;
  // 엑셀: ROUND(drift, 1) <= 5 기준
  const r1 = v => Math.round(v * 10) / 10;
  const zPass = zd !== null ? r1(zd) <= limit : null;
  const sPass = sd !== null ? r1(sd) <= limit : null;
  const allPass = [zPass,sPass].filter(v=>v!==null).every(Boolean);
  const parts = [];
  if (zd !== null) parts.push(`Z ${r1(zd).toFixed(1)}%`);
  if (sd !== null) parts.push(`S ${r1(sd).toFixed(1)}%`);
  parts.push(`기준 ≤${limit}%`);
  el.className = 'pv-lin-summary pv-lin-summary--' + (allPass ? 'ok' : 'ng');
  el.innerHTML = parts.map((t,i) => i<parts.length-1
    ? `<span class="pv-lin-summary__label">${t}</span><span class="pv-lin-summary__sep">·</span>`
    : `<span class="pv-lin-summary__status">${allPass?'✓':''} ${t} ${allPass?'적합':'부적합'}</span>`
  ).join('');
}

function updateRepSummary(range, repLimit = 3) {
  const el = document.getElementById('pv_rep_summary');
  if (!el) return;
  const zVals = pickRepVals(gv('z5'),gv('z6'),gv('z7'),[gv('z1'),gv('z2')],[gv('z3'),gv('z4')]);
  const sVals = pickRepVals(gv('s5'),gv('s6'),gv('s7'),[gv('s1'),gv('s2')],[gv('s3'),gv('s4')]);

  // 통과 불가 여부 확인 (힌트가 참고 상태 = 어떤 S5를 넣어도 부적합)
  const z6 = gv('z6'), z7 = gv('z7'), s6 = gv('s6'), s7 = gv('s7');
  const z6z7 = !isNaN(z6) && !isNaN(z7);
  const s6s7 = !isNaN(s6) && !isNaN(s7);
  const zr = z6z7 ? computeRepZ5Range([z6],[z7], range, repLimit) : computeRepZ5Range([gv('z1'),gv('z2')],[gv('z3'),gv('z4')], range, repLimit);
  const sr = s6s7 ? computeRepZ5Range([s6],[s7], range, repLimit) : computeRepZ5Range([gv('s1'),gv('s2')],[gv('s3'),gv('s4')], range, repLimit);
  const zImpossible = range > 0 && zr.impossible;
  const sImpossible = range > 0 && sr.impossible;
  // 음수 입력도 부적합
  const z5v = gv('z5'), s5v = gv('s5');
  const zNeg = !isNaN(z5v) && z5v < 0;
  const sNeg = !isNaN(s5v) && s5v < 0;

  const hasZ = zVals.length >= 2 || zImpossible || zNeg;
  const hasS = sVals.length >= 2 || sImpossible || sNeg;
  if (!range || (!hasZ && !hasS)) { el.className='pv-lin-summary'; el.innerHTML=''; return; }

  const stdDiv = (vals, r) => {
    if (vals.length < 2) return null;
    const m = vals.reduce((a,b)=>a+b,0)/vals.length;
    const s = Math.sqrt(vals.reduce((a,v)=>a+(v-m)**2,0)/(vals.length-1));
    return r > 0 ? s/r*100 : s/m*100;
  };
  const zRsd = stdDiv(zVals, range), sRsd = stdDiv(sVals, range);
  const limit = repLimit;
  const r1 = v => Math.round(v * 10) / 10;
  // 통과불가 또는 음수 → 강제 부적합
  const zPass = (zImpossible || zNeg) ? false : (zRsd !== null ? r1(zRsd) <= limit : null);
  const sPass = (sImpossible || sNeg) ? false : (sRsd !== null ? r1(sRsd) <= limit : null);
  const allPass = [zPass,sPass].filter(v=>v!==null).every(Boolean);
  const parts = [];
  if (hasZ) parts.push(`Z ${(zImpossible||zNeg) ? '부적합' : (zRsd!==null ? r1(zRsd).toFixed(1)+'%' : '')}`);
  if (hasS) parts.push(`S ${(sImpossible||sNeg) ? '부적합' : (sRsd!==null ? r1(sRsd).toFixed(1)+'%' : '')}`);
  parts.push(`기준 ≤${limit}%`);
  el.className = 'pv-lin-summary pv-lin-summary--' + (allPass ? 'ok' : 'ng');
  el.innerHTML = parts.map((t,i) => i<parts.length-1
    ? `<span class="pv-lin-summary__label">${t}</span><span class="pv-lin-summary__sep">·</span>`
    : `<span class="pv-lin-summary__status">${allPass?'✓':''} ${t} ${allPass?'적합':'부적합'}</span>`
  ).join('');
}

// ── 실시간 입력 가이드 (비활성: 인라인 힌트로 대체) ──────────
function updateGuide(code) {
  const el = document.getElementById('pv-input-guide');
  if (el) el.hidden = true;
  return;
  if (!['TOC','TN','TP','SS','COD','TU','CL'].includes(code)) { el.hidden = true; return; }

  const range = g('range');
  if (!range) { el.hidden = true; return; }

  const driftTol = range * 0.05;
  const fmtR = (v) => isNaN(v) ? '—' : fmt(v, 3);

  // Z 값
  const z1=gv('z1'), z2=gv('z2'), z3=gv('z3'), z4=gv('z4');
  const s1=gv('s1'), s2=gv('s2'), s3=gv('s3'), s4=gv('s4');

  const mean = (...vs) => { const f=vs.filter(v=>!isNaN(v)); return f.length?f.reduce((a,b)=>a+b,0)/f.length:NaN; };

  const ziMean = mean(z1, z2);
  const siMean = mean(s1, s2);
  const zRepMean = NaN; // 반복성 별도 측정 입력 전까지 미표시
  const sRepMean = NaN;

  function rangeHtml(base, tol, label, cls='') {
    if (isNaN(base)) return '';
    const lo = base - tol, hi = base + tol;
    return `<div class="pv-guide-row">
      <span class="pv-guide-row__label">${label}</span>
      <span class="pv-guide-row__range${cls ? ' '+cls : ''}">${fmtR(lo)} ~ ${fmtR(hi)}</span>
    </div>`;
  }

  const rows = [];

  // 드리프트 허용 편차 (제목줄에 표시)

  // Z 가이드
  const zRows = [
    rangeHtml(ziMean, driftTol, 'Z 최종구간 평균(Z3,Z4) 목표', 'pv-guide-row__range--ok'),
    !isNaN(zRepMean) ? rangeHtml(zRepMean, zRepMean*0.03, 'Z 반복성 목표(±3%)') : '',
  ].filter(Boolean);
  if (zRows.length) {
    rows.push(`<div class="pv-guide-group">
      <div class="pv-guide-group__hd pv-guide-group__hd--z">🔵 Z (제로) 목표범위</div>
      ${zRows.join('')}
    </div>`);
  }

  // S 가이드
  const sRows = [
    rangeHtml(siMean, driftTol, 'S 최종구간 평균(S3,S4) 목표', 'pv-guide-row__range--ok'),
    !isNaN(sRepMean) ? rangeHtml(sRepMean, sRepMean*0.03, 'S 반복성 목표(±3%)') : '',
  ].filter(Boolean);
  if (sRows.length) {
    rows.push(`<div class="pv-guide-group">
      <div class="pv-guide-group__hd pv-guide-group__hd--s">🟢 S (스팬) 목표범위</div>
      ${sRows.join('')}
    </div>`);
  }

  // 2줄 심플 요약
  const zLine = [
    !isNaN(ziMean) ? `Z3·Z4 평균: ${fmtR(ziMean-driftTol)}~${fmtR(ziMean+driftTol)}` : null,
    !isNaN(zRepMean) ? `Z 반복성: ${fmtR(zRepMean*0.97)}~${fmtR(zRepMean*1.03)}` : null,
  ].filter(Boolean).join('  |  ');
  const sLine = [
    !isNaN(siMean) ? `S3·S4 평균: ${fmtR(siMean-driftTol)}~${fmtR(siMean+driftTol)}` : null,
    !isNaN(sRepMean) ? `S 반복성: ${fmtR(sRepMean*0.97)}~${fmtR(sRepMean*1.03)}` : null,
  ].filter(Boolean).join('  |  ');

  el.innerHTML = `<div class="pv-guide-title">적합 목표범위 — 범위 ${fmtR(range)} / 드리프트 허용 ±${fmtR(driftTol)}</div>
    ${zLine ? `<div class="pv-guide-row"><span class="pv-guide-row__label pv-guide-group__hd--z">🔵 Z</span><span>${zLine}</span></div>` : ''}
    ${sLine ? `<div class="pv-guide-row"><span class="pv-guide-row__label pv-guide-group__hd--s">🟢 S</span><span>${sLine}</span></div>` : ''}`;
  el.hidden = !(zLine || sLine);
}

function calculate(tabId) {

  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;
  if (IS_PH(tab.code))    { calcPH(tab);    return; }
  if (IS_DO(tab.code))    { calcDO(tab);     return; }
  if (IS_WATER(tab.code)) { calcWater(tab);  return; }
  calcBasic(tab);
}

// ── 탭 전환 ───────────────────────────────────────────────
function alignMeasureInputs(formArea) {
  const inputs = [...formArea.querySelectorAll('.pv-measure-input')];
  // 채워진 값들 중 최대 소수 자리 감지
  let maxDp = 0;
  inputs.forEach(el => {
    const v = el.value.trim();
    if (!v || !v.includes('.')) return;
    const dp = v.split('.')[1].length;
    if (dp > maxDp) maxDp = dp;
  });
  if (maxDp === 0) return;
  // 전체 정렬
  inputs.forEach(el => {
    const v = el.value.trim();
    if (!v) return;
    const n = parseFloat(v);
    if (Number.isFinite(n)) el.value = n.toFixed(maxDp);
  });
}

function isRepExtraOpen(code) {
  if (IS_PH(code) || IS_DO(code)) return false;
  const seqStr = stored['seq'];
  let hasExtraInSeq = false;
  if (seqStr && seqStr.trim() !== '') {
    const normalizedStr = seqStr.toUpperCase().replace(/\s+/g, '');
    if (seqStr.includes(',') || /[0-9]/.test(seqStr)) {
      const tokens = seqStr.split(/[\s,]+/).map(t => t.trim().toLowerCase()).filter(Boolean);
      if (tokens.some(t => ['z6', 's6', 'z7', 's7'].includes(t))) {
        hasExtraInSeq = true;
      }
    } else {
      const zCount = (normalizedStr.match(/Z/g) || []).length;
      const sCount = (normalizedStr.match(/S/g) || []).length;
      // Z 또는 S가 2개 또는 3개인 경우 (단독 반복성 2·3차), 또는 6개 이상인 경우 (드리프트 + 반복성 2·3차)
      if (zCount === 2 || zCount === 3 || zCount >= 6 || sCount === 2 || sCount === 3 || sCount >= 6) {
        hasExtraInSeq = true;
      }
    }
  }
  return stored['rep_extra'] === true
    || hasExtraInSeq
    || ['z6','s6','z7','s7'].some(k => { const v = stored[k]; return v != null && String(v).trim() !== '' && Number(v) !== 0; });
}

function getDefaultPipelineSteps(code) {
  const repExtraOpen = isRepExtraOpen(code);

  if (IS_PH(code)) {
    return [
      { id: 'ph7a', type: 'z', label: '반 저1' },
      { id: 'ph4a', type: 's', label: '반 고1' },
      { id: 'ph7b', type: 'z', label: '반 저2' },
      { id: 'ph4b', type: 's', label: '반 고2' },
      { id: 'ph7c', type: 'z', label: '반 저3' },
      { id: 'ph4c', type: 's', label: '반 고3' },
      { id: 'phdi', type: 'z', label: '드 초기' },
      { id: 'phdf', type: 'z', label: '드 최종' },
      { id: 'phm4', type: 'm', label: '직 pH4' },
      { id: 'phm7', type: 'm', label: '직 pH7' },
      { id: 'phm10', type: 'm', label: '직 pH10' },
      { id: 'pht10', type: 'other', label: '온도 10℃' },
      { id: 'pht15', type: 'other', label: '온도 15℃' },
      { id: 'pht20', type: 'other', label: '온도 20℃' },
      { id: 'pht25', type: 'other', label: '온도 25℃' },
      { id: 'pht30', type: 'other', label: '온도 30℃' },
      { id: 'phci1', type: 'other', label: '현장 Ci1' },
      { id: 'phai1', type: 'other', label: '수분 Ai1' },
      { id: 'phai2', type: 'other', label: '수분 Ai2' },
      { id: 'phci2', type: 'other', label: '현장 Ci2' },
      { id: 'phai3', type: 'other', label: '수분 Ai3' },
      { id: 'phai4', type: 'other', label: '수분 Ai4' }
    ];
  }

  if (IS_DO(code)) {
    return [
      { id: 'dos1', type: 's', label: '반 S1' },
      { id: 'dos2', type: 's', label: '반 S2' },
      { id: 'dos3', type: 's', label: '반 S3' },
      { id: 'dozi', type: 'z', label: '드 Z초기' },
      { id: 'dosi', type: 's', label: '드 S초기' },
      { id: 'dozf', type: 'z', label: '드 Z최종' },
      { id: 'dosf', type: 's', label: '드 S최종' },
      { id: 'domax', type: 'm', label: '직 Max' },
      { id: 'domin', type: 'm', label: '직 Min' },
      { id: 'dot20', type: 'other', label: '온도 20℃' },
      { id: 'dot30', type: 'other', label: '온도 30℃' },
      { id: 'resp', type: 'other', label: '응답(초)' }
    ];
  }

  const isWater = IS_WATER(code);
  const steps = [
    { id: 'z1', type: 'z', label: '드 Z1' },
    { id: 's1', type: 's', label: '드 S1' },
    { id: 'z2', type: 'z', label: '드 Z2' },
    { id: 's2', type: 's', label: '드 S2' },
    { id: 'z3', type: 'z', label: '드 Z3' },
    { id: 's3', type: 's', label: '드 S3' },
    { id: 'z4', type: 'z', label: '드 Z4' },
    { id: 's4', type: 's', label: '드 S4' },
    { id: 'z5', type: 'z', label: '반 Z5' },
    { id: 's5', type: 's', label: '반 S5' }
  ];

  if (repExtraOpen) {
    steps.push(
      { id: 'z6', type: 'z', label: '반 Z6' },
      { id: 's6', type: 's', label: '반 S6' },
      { id: 'z7', type: 'z', label: '반 Z7' },
      { id: 's7', type: 's', label: '반 S7' }
    );
  }

  if (isWater) {
    steps.push({ id: 'm1', type: 'm', label: '직 M' });
    const isRespSkip = stored['resp_skip'] === true;
    if (!isRespSkip) {
      steps.push({ id: 'resp', type: 'other', label: '응답(초)' });
    }
  } else {
    steps.push(
      { id: 'm1', type: 'm', label: '직 M1' },
      { id: 'm2', type: 'm', label: '직 M2' },
      { id: 'm3', type: 'm', label: '직 M3' }
    );
    if (code === 'COD') {
      steps.push(
        { id: 'codmax', type: 'other', label: '변동 Max' },
        { id: 'codmin', type: 'other', label: '변동 Min' }
      );
    }
    if (code === 'TOC') {
      steps.push({ id: 'resp', type: 'other', label: '응답(분)' });
    }
    // Field factor at the end
    steps.push(
      { id: 'ci1', type: 'other', label: '현장 Ci1' },
      { id: 'ai1', type: 'other', label: '수분 Ai1' },
      { id: 'ai2', type: 'other', label: '수분 Ai2' },
      { id: 'ci2', type: 'other', label: '현장 Ci2' },
      { id: 'ai3', type: 'other', label: '수분 Ai3' },
      { id: 'ai4', type: 'other', label: '수분 Ai4' }
    );
  }

  return steps;
}

function sortStepsChronologically(steps, code) {
  let refOrder = [];
  if (IS_PH(code)) {
    refOrder = [
      'phdi',
      'ph7a', 'ph7b', 'ph7c',
      'phm4', 'phm7', 'phm10',
      'phdf',
      'ph4a', 'ph4b', 'ph4c'
    ];
  } else if (IS_DO(code)) {
    refOrder = [
      'dozi', 'dosi',
      'dos1', 'dos2', 'dos3',
      'dozf', 'dosf'
    ];
  } else {
    refOrder = [
      'z1', 's1', 'z2', 's2',
      'z5', 's5', 'z6', 's6', 'z7', 's7',
      'z3', 's3', 'z4', 's4'
    ];
  }

  return [...steps].sort((a, b) => {
    const idxA = refOrder.indexOf(a.id);
    const idxB = refOrder.indexOf(b.id);
    if (idxA === -1 && idxB === -1) return 0;
    if (idxA === -1) return 1;
    if (idxB === -1) return -1;
    return idxA - idxB;
  });
}

function parseSequenceString(code, seqStr) {
  if (!seqStr || seqStr.trim() === '') return null;
  const defaultSteps = getDefaultPipelineSteps(code);
  const normalizedStr = seqStr.toUpperCase().replace(/\s+/g, '');
  
  if (seqStr.includes(',') || /[0-9]/.test(seqStr)) {
    const tokens = seqStr.split(/[\s,]+/).map(t => t.trim().toLowerCase()).filter(Boolean);
    const ordered = [];
    tokens.forEach(tok => {
      const match = defaultSteps.find(s => s.id === tok);
      if (match && !ordered.some(o => o.id === match.id)) {
        ordered.push(match);
      }
    });
    return ordered;
  }

  const ordered = [];
  
  // Z와 S의 전체 개수 파악
  let zTotal = 0;
  let sTotal = 0;
  for (let i = 0; i < normalizedStr.length; i++) {
    if (normalizedStr[i] === 'Z') zTotal++;
    if (normalizedStr[i] === 'S') sTotal++;
  }

  // Z, S 단계 목록 필터
  const allZSteps = defaultSteps.filter(s => s.type === 'z');
  const allSSteps = defaultSteps.filter(s => s.type === 's');

  // 개수에 따른 분기 매핑: pH/DO가 아니고 Z/S 개수가 3개 이하이면 바로 반복성(Z5~)으로 간주
  const isPhOrDo = IS_PH(code) || IS_DO(code);
  const zSteps = (!isPhOrDo && zTotal > 0 && zTotal <= 3)
    ? allZSteps.filter(s => ['z5', 'z6', 'z7'].includes(s.id))
    : allZSteps;
  const sSteps = (!isPhOrDo && sTotal > 0 && sTotal <= 3)
    ? allSSteps.filter(s => ['s5', 's6', 's7'].includes(s.id))
    : allSSteps;

  const mSteps = defaultSteps.filter(s => s.type === 'm');
  const rSteps = defaultSteps.filter(s => s.id === 'resp');
  const fSteps = defaultSteps.filter(s => ['ci1', 'ai1', 'ai2', 'ci2', 'ai3', 'ai4', 'phci1', 'phai1', 'phai2', 'phci2', 'phai3', 'phai4'].includes(s.id));

  let zIdx = 0, sIdx = 0, mIdx = 0, rIdx = 0, fIdx = 0;

  for (let i = 0; i < normalizedStr.length; i++) {
    const char = normalizedStr[i];
    if (char === 'Z' && zIdx < zSteps.length) {
      ordered.push(zSteps[zIdx++]);
    } else if (char === 'S' && sIdx < sSteps.length) {
      ordered.push(sSteps[sIdx++]);
    } else if (char === 'M' && mIdx < mSteps.length) {
      ordered.push(mSteps[mIdx++]);
    } else if ((char === 'R' || char === 'T') && rIdx < rSteps.length) {
      ordered.push(rSteps[rIdx++]);
    } else if (char === 'F' && fIdx < fSteps.length) {
      ordered.push(fSteps[fIdx++]);
    }
  }

  return ordered;
}

function getPipelineSteps(code) {
  const seqStr = stored['seq'];
  if (seqStr && seqStr.trim() !== '') {
    return parseSequenceString(code, seqStr);
  }
  return getDefaultPipelineSteps(code);
}

function sortSeriesBySequence(code, seriesIds) {
  const steps = getPipelineSteps(code);
  const orderedIds = [];
  steps.forEach(s => {
    if (seriesIds.includes(s.id)) {
      orderedIds.push(s.id);
    }
  });
  seriesIds.forEach(id => {
    if (!orderedIds.includes(id)) {
      orderedIds.push(id);
    }
  });
  return orderedIds;
}

function updatePipeline(code) {
  const track = document.getElementById('pv-pipeline-track');
  if (!track) return;

  // 진행 순서 입력이 없으면 파이프라인 버블을 표시하지 않음
  const seqStr = stored['seq'];
  if (!seqStr || seqStr.trim() === '') {
    track.innerHTML = '';
    track.style.display = 'none';
    return;
  }

  const steps = getPipelineSteps(code);
  if (!steps || steps.length === 0) {
    track.innerHTML = '';
    track.style.display = 'none';
    return;
  }
  track.style.display = 'flex';

  const activeElId = document.activeElement ? document.activeElement.id : '';

  track.innerHTML = steps.map(step => {
    const el = document.getElementById(`pv_${step.id}`);
    const isFilled = el && el.value.trim() !== '';
    const val = isFilled ? el.value.trim() : '';
    const isActive = activeElId === `pv_${step.id}`;
    
    let displayVal = '';
    if (isFilled) {
      const numVal = parseFloat(val);
      displayVal = isNaN(numVal) ? val : (Number.isInteger(numVal) ? numVal : parseFloat(numVal.toFixed(3)));
    }

    return `
      <div class="pv-pipeline-bubble type-${step.type} ${isFilled ? 'is-filled' : ''} ${isActive ? 'is-active' : ''}" 
           data-id="${step.id}" 
           title="${step.label}: ${isFilled ? val : '미입력'}">
        <span class="pv-pipeline-label">${step.label}</span>
        ${isFilled ? `<span class="pv-pipeline-value">${displayVal}</span>` : ''}
      </div>
    `;
  }).join('');

  track.querySelectorAll('.pv-pipeline-bubble').forEach(btn => {
    btn.addEventListener('click', () => {
      const fieldId = btn.dataset.id;
      const input = document.getElementById(`pv_${fieldId}`);
      if (input) {
        input.focus();
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  });
}

function ensureGraphModal() {
  let modal = document.getElementById('pv-graph-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'pv-graph-modal';
    modal.className = 'pv-modal';
    modal.innerHTML = `
      <div class="pv-modal-card">
        <div class="pv-modal-header">
          <h3 class="pv-modal-title">📈 측정 트렌드 그래프</h3>
          <button class="pv-modal-close" id="pv-graph-modal-close" type="button">✕</button>
        </div>
        <div class="pv-modal-body" id="pv-graph-modal-body">
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#pv-graph-modal-close').addEventListener('click', () => {
      modal.classList.remove('is-open');
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('is-open');
      }
    });
  }
  return modal;
}

function drawSVGLineChart(title, series, xLabels, options = {}) {
  const allVals = [];
  series.forEach(s => {
    s.values.forEach(v => {
      if (v !== null && v !== undefined && !isNaN(v)) allVals.push(v);
    });
  });
  if (options.bands) {
    options.bands.forEach(b => {
      if (!isNaN(b.y1)) allVals.push(b.y1);
      if (!isNaN(b.y2)) allVals.push(b.y2);
    });
  }
  if (options.refLines) {
    options.refLines.forEach(l => {
      if (!isNaN(l.y)) allVals.push(l.y);
    });
  }

  if (allVals.length === 0) {
    return `
      <div class="pv-chart-container">
        <div class="pv-chart-title">${title}</div>
        <div class="pv-chart-svg-wrap" style="display:flex; align-items:center; justify-content:center;">
          <div class="pv-chart-no-data" style="position:static; transform:none;">입력 데이터가 부족하여 그래프를 그릴 수 없습니다.</div>
        </div>
      </div>
    `;
  }

  let minVal = Math.min(...allVals);
  let maxVal = Math.max(...allVals);
  if (minVal === maxVal) {
    minVal -= 1;
    maxVal += 1;
  } else {
    const margin = (maxVal - minVal) * 0.15;
    minVal -= margin;
    maxVal += margin;
  }

  const width = 500;
  const height = 220;
  const paddingLeft = 50;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 40;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const getX = (idx) => paddingLeft + (idx / (xLabels.length - 1 || 1)) * chartWidth;
  const getY = (val) => paddingTop + chartHeight - ((val - minVal) / (maxVal - minVal || 1)) * chartHeight;

  let gridHtml = '';
  const numGridLines = 4;
  for (let i = 0; i <= numGridLines; i++) {
    const yVal = minVal + (i / numGridLines) * (maxVal - minVal);
    const yPos = getY(yVal);
    gridHtml += `
      <line class="pv-chart-grid" x1="${paddingLeft}" y1="${yPos}" x2="${width - paddingRight}" y2="${yPos}" />
      <text class="pv-chart-text" x="${paddingLeft - 8}" y="${yPos + 4}" text-anchor="end">${yVal.toFixed(2)}</text>
    `;
  }

  xLabels.forEach((label, idx) => {
    const xPos = getX(idx);
    gridHtml += `
      <line class="pv-chart-grid" x1="${xPos}" y1="${paddingTop}" x2="${xPos}" y2="${paddingTop + chartHeight}" />
      <text class="pv-chart-text" x="${xPos}" y="${paddingTop + chartHeight + 18}" text-anchor="middle">${label}</text>
    `;
  });

  let bandsHtml = '';
  if (options.bands) {
    options.bands.forEach(b => {
      if (isNaN(b.y1) || isNaN(b.y2)) return;
      const y1Pos = getY(Math.max(b.y1, minVal));
      const y2Pos = getY(Math.min(b.y2, maxVal));
      const rectHeight = Math.abs(y1Pos - y2Pos);
      const rectY = Math.min(y1Pos, y2Pos);
      bandsHtml += `
        <rect class="${b.class || 'pv-chart-band-drift'}" x="${paddingLeft}" y="${rectY}" width="${chartWidth}" height="${rectHeight}" />
      `;
    });
  }

  let refLinesHtml = '';
  if (options.refLines) {
    options.refLines.forEach(l => {
      if (isNaN(l.y)) return;
      const yPos = getY(l.y);
      refLinesHtml += `
        <line class="${l.class || 'pv-chart-line-ref'}" x1="${paddingLeft}" y1="${yPos}" x2="${width - paddingRight}" y2="${yPos}" />
        <text class="pv-chart-text" x="${width - paddingRight - 4}" y="${yPos - 4}" text-anchor="end" style="font-weight:bold">${l.label || ''}</text>
      `;
    });
  }

  let pathsHtml = '';
  series.forEach(s => {
    let pathD = '';
    let dotsHtml = '';
    s.values.forEach((v, idx) => {
      if (v === null || v === undefined || isNaN(v)) return;
      const xPos = getX(idx);
      const yPos = getY(v);
      if (pathD === '') {
        pathD = `M ${xPos} ${yPos}`;
      } else {
        pathD += ` L ${xPos} ${yPos}`;
      }
      dotsHtml += `
        <circle class="${s.dotClass}" cx="${xPos}" cy="${yPos}" r="4" />
        <text class="pv-chart-text" x="${xPos}" y="${yPos - 8}" text-anchor="middle" style="font-weight:600">${v.toFixed(2)}</text>
      `;
    });

    if (pathD !== '') {
      pathsHtml += `
        <path class="${s.colorClass}" d="${pathD}" />
        ${dotsHtml}
      `;
    }
  });

  return `
    <div class="pv-chart-container">
      <div class="pv-chart-title">${title}</div>
      <div class="pv-chart-svg-wrap">
        <svg viewBox="0 0 ${width} ${height}">
          ${bandsHtml}
          ${gridHtml}
          ${refLinesHtml}
          ${pathsHtml}
          <line class="pv-chart-axis" x1="${paddingLeft}" y1="${paddingTop}" x2="${paddingLeft}" y2="${paddingTop + chartHeight}" />
          <line class="pv-chart-axis" x1="${paddingLeft}" y1="${paddingTop + chartHeight}" x2="${width - paddingRight}" y2="${paddingTop + chartHeight}" />
        </svg>
      </div>
    </div>
  `;
}

function renderGraphsInModal(code) {
  const body = document.getElementById('pv-graph-modal-body');
  if (!body) return;

  body.innerHTML = '';

  // 시퀀스 입력이 있으면 그 순서로, 없으면 기본 순서로 전체 데이터 표시
  const seqStr = stored['seq'];
  const allSteps = (seqStr && seqStr.trim() !== '')
    ? getPipelineSteps(code)
    : getDefaultPipelineSteps(code);

  const labelMap = {
    z1: 'Z1', z2: 'Z2', z3: 'Z3', z4: 'Z4', z5: 'Z5', z6: 'Z6', z7: 'Z7',
    s1: 'S1', s2: 'S2', s3: 'S3', s4: 'S4', s5: 'S5', s6: 'S6', s7: 'S7',
    m1: 'M1', m2: 'M2', m3: 'M3',
    ph7a: '반저1', ph4a: '반고1', ph7b: '반저2', ph4b: '반고2', ph7c: '반저3', ph4c: '반고3',
    phdi: '초기', phdf: '최종',
    phm4: 'pH4', phm7: 'pH7', phm10: 'pH10',
    pht10: '10℃', pht15: '15℃', pht20: '20℃', pht25: '25℃', pht30: '30℃',
    dos1: 'S1', dos2: 'S2', dos3: 'S3',
    dozi: 'Z초기', dosi: 'S초기', dozf: 'Z최종', dosf: 'S최종',
    domax: 'Max', domin: 'Min',
    dot20: '20℃', dot30: '30℃',
    ci1: 'Ci1', ai1: 'Ai1', ai2: 'Ai2', ci2: 'Ci2', ai3: 'Ai3', ai4: 'Ai4',
    phci1: 'Ci1', phai1: 'Ai1', phai2: 'Ai2', phci2: 'Ci2', phai3: 'Ai3', phai4: 'Ai4',
    resp: '응답', codmax: 'CODmax', codmin: 'CODmin',
    range: '범위', fdis: '배출',
  };

  // 값이 입력된 스텝만 필터
  const dataSteps = [];
  allSteps.forEach(step => {
    const el = document.getElementById(`pv_${step.id}`);
    const val = el ? parseFloat(el.value) : NaN;
    if (!isNaN(val)) {
      dataSteps.push({ ...step, val, label: labelMap[step.id] || step.label });
    }
  });

  if (dataSteps.length === 0) {
    body.innerHTML = `
      <div class="pv-chart-container">
        <div class="pv-chart-title">📊 전체 측정 트렌드</div>
        <div class="pv-chart-svg-wrap" style="display:flex;align-items:center;justify-content:center;">
          <div class="pv-chart-no-data" style="position:static;transform:none;">입력된 데이터가 없습니다.</div>
        </div>
      </div>`;
    return;
  }

  // SVG 전체 그래프 직접 그리기 — 모든 값을 한 차트에 색상별로
  const xLabels = dataSteps.map(s => s.label);
  const typeColorMap = {
    z:     { line: '#3b82f6', dot: '#3b82f6', name: 'Zero' },
    s:     { line: '#10b981', dot: '#10b981', name: 'Span' },
    m:     { line: '#8b5cf6', dot: '#8b5cf6', name: 'Linearity' },
    other: { line: '#6366f1', dot: '#6366f1', name: '기타' },
  };

  const allVals = dataSteps.map(s => s.val);
  let minVal = Math.min(...allVals);
  let maxVal = Math.max(...allVals);
  if (minVal === maxVal) { minVal -= 1; maxVal += 1; }
  else { const margin = (maxVal - minVal) * 0.15; minVal -= margin; maxVal += margin; }

  const n = dataSteps.length;
  const width = Math.max(500, n * 52);
  const height = 260;
  const pL = 55, pR = 20, pT = 28, pB = 50;
  const cW = width - pL - pR;
  const cH = height - pT - pB;

  const getX = i => pL + (i / (n - 1 || 1)) * cW;
  const getY = v => pT + cH - ((v - minVal) / (maxVal - minVal || 1)) * cH;

  // 그리드
  let gridHtml = '';
  for (let i = 0; i <= 4; i++) {
    const yVal = minVal + (i / 4) * (maxVal - minVal);
    const yPos = getY(yVal);
    gridHtml += `<line class="pv-chart-grid" x1="${pL}" y1="${yPos}" x2="${width - pR}" y2="${yPos}" />`;
    gridHtml += `<text class="pv-chart-text" x="${pL - 8}" y="${yPos + 4}" text-anchor="end">${yVal.toFixed(1)}</text>`;
  }

  // X축 레이블
  dataSteps.forEach((s, i) => {
    const xPos = getX(i);
    const tc = typeColorMap[s.type] || typeColorMap.other;
    gridHtml += `<text class="pv-chart-text" x="${xPos}" y="${pT + cH + 16}" text-anchor="middle" fill="${tc.dot}" style="font-weight:600;font-size:9px">${s.label}</text>`;
  });

  // 타입별 경로 + 도트 생성
  const typeGroups = {};
  dataSteps.forEach((s, i) => {
    const t = s.type || 'other';
    if (!typeGroups[t]) typeGroups[t] = [];
    typeGroups[t].push({ idx: i, val: s.val, label: s.label });
  });

  let pathsHtml = '';
  Object.entries(typeGroups).forEach(([type, points]) => {
    const tc = typeColorMap[type] || typeColorMap.other;

    // 같은 타입의 점들을 선으로 연결
    let pathD = '';
    let dotsHtml = '';
    points.forEach(p => {
      const xPos = getX(p.idx);
      const yPos = getY(p.val);
      if (pathD === '') pathD = `M ${xPos} ${yPos}`;
      else pathD += ` L ${xPos} ${yPos}`;

      dotsHtml += `<circle cx="${xPos}" cy="${yPos}" r="4.5" fill="${tc.dot}" stroke="white" stroke-width="1.5" />`;
      dotsHtml += `<text class="pv-chart-text" x="${xPos}" y="${yPos - 9}" text-anchor="middle" fill="${tc.dot}" style="font-weight:700;font-size:9px">${p.val.toFixed(2)}</text>`;
    });

    if (pathD) {
      pathsHtml += `<path d="${pathD}" fill="none" stroke="${tc.line}" stroke-width="2" stroke-opacity="0.5" />`;
      pathsHtml += dotsHtml;
    }
  });

  // 범례
  const legendItems = Object.entries(typeGroups).map(([type]) => {
    const tc = typeColorMap[type] || typeColorMap.other;
    return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;color:${tc.dot};font-weight:600"><span style="width:8px;height:8px;border-radius:50%;background:${tc.dot};display:inline-block"></span>${tc.name}</span>`;
  }).join('&nbsp;&nbsp;');

  const chartHTML = `
    <div class="pv-chart-container">
      <div class="pv-chart-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
        <span>📊 전체 측정 트렌드 (${dataSteps.length}개 항목)</span>
        <span>${legendItems}</span>
      </div>
      <div class="pv-chart-svg-wrap" style="overflow-x:auto">
        <svg viewBox="0 0 ${width} ${height}" style="min-width:${width}px">
          ${gridHtml}
          ${pathsHtml}
          <line class="pv-chart-axis" x1="${pL}" y1="${pT}" x2="${pL}" y2="${pT + cH}" />
          <line class="pv-chart-axis" x1="${pL}" y1="${pT + cH}" x2="${width - pR}" y2="${pT + cH}" />
        </svg>
      </div>
    </div>
  `;

  body.innerHTML = chartHTML;
}

function setupPipelineAndGraph(tab) {
  const formCard = document.querySelector('.pv-form-card');
  if (!formCard) return;

  const existingPipeline = formCard.querySelector('.pv-pipeline-section');
  if (existingPipeline) existingPipeline.remove();

  const seqVal = stored['seq'] || '';

  // 항목별 다른 placeholder 예시
  let seqPlaceholder = '예: ZZSSZSZZSSMMM';
  if (IS_PH(tab.code)) {
    seqPlaceholder = '예: ph7a,ph4a,phdi,phdf,phm4';
  } else if (IS_DO(tab.code)) {
    seqPlaceholder = '예: dos1,dozi,dosi,dozf,dosf';
  } else if (IS_WATER(tab.code)) {
    seqPlaceholder = '예: ZZSSZSZZSSM';
  }

  const pipelineHTML = `
    <div class="pv-pipeline-section">
      <div class="pv-pipeline-header">
        <span class="pv-pipeline-title">📊 입력 진행도 파이프라인</span>
        <div class="pv-pipeline-controls">
          <div class="pv-pipeline-seq-wrap">
            <span>🔄 진행 순서:</span>
            <input type="text" class="pv-pipeline-seq-input" id="pv-pipeline-seq" placeholder="${seqPlaceholder}" value="${seqVal}" />
          </div>
          <button type="button" class="pv-graph-btn" id="pv-open-graph-btn">📈 그래프</button>
        </div>
      </div>
      <div class="pv-pipeline-track" id="pv-pipeline-track"></div>
    </div>
  `;
  formCard.insertAdjacentHTML('afterbegin', pipelineHTML);

  updatePipeline(tab.code);

  const openGraphBtn = document.getElementById('pv-open-graph-btn');
  if (openGraphBtn) {
    openGraphBtn.addEventListener('click', () => {
      const modal = ensureGraphModal();
      modal.classList.add('is-open');
      renderGraphsInModal(tab.code);
    });
  }

  const seqInput = document.getElementById('pv-pipeline-seq');
  if (seqInput) {
    seqInput.addEventListener('input', () => {
      stored['seq'] = seqInput.value;

      // Real-time UI updates for rep_extra checkbox and rows
      const hasExtra = isRepExtraOpen(tab.code);
      const checkbox = document.getElementById('pv_rep_extra');
      const rows = document.getElementById('pv-rep-extra-rows');
      if (checkbox) {
        checkbox.checked = hasExtra;
      }
      if (rows) {
        rows.style.display = hasExtra ? '' : 'none';
      }

      saveData(tab.id);
      updatePipeline(tab.code);
      const modal = document.getElementById('pv-graph-modal');
      if (modal && modal.classList.contains('is-open')) {
        renderGraphsInModal(tab.code);
      }
    });
  }

  const formArea = document.getElementById('pv-form-area');
  if (formArea) {
    formArea.querySelectorAll('input').forEach(input => {
      input.addEventListener('focus', () => {
        const fieldId = input.id.replace('pv_', '');
        document.querySelectorAll('.pv-pipeline-bubble').forEach(bubble => {
          bubble.classList.toggle('is-active', bubble.dataset.id === fieldId);
        });
      });
      input.addEventListener('blur', () => {
        const fieldId = input.id.replace('pv_', '');
        const bubble = document.querySelector(`.pv-pipeline-bubble[data-id="${fieldId}"]`);
        if (bubble) bubble.classList.remove('is-active');
      });
    });
  }
}

function switchTab(id) {
  if (activeId && activeId !== id) saveData(activeId);
  activeId = id;
  saveMeta();

  document.querySelectorAll('.pv-item-tab').forEach(b =>
    b.classList.toggle('is-active', b.dataset.id === id));

  const tab = tabs.find(t => t.id === id);
  const formArea = document.getElementById('pv-form-area');
  if (!formArea || !tab) return;
  
  stored = loadData(id);
  formArea.innerHTML = buildForm(tab.code);

  // 측정값 입력칸: type="number" → type="text", 소수 자리 자동 정렬
  const INTEGER_FIELDS = new Set(['range', 'fdis', 'resp']);
  formArea.querySelectorAll('input.field__control[type="number"], input.pv-zs-input[type="number"]').forEach(el => {
    const fieldId = (el.id || '').replace('pv_', '');
    if (INTEGER_FIELDS.has(fieldId)) return;
    el.type = 'text';
    el.inputMode = 'decimal';
    el.classList.add('pv-measure-input');
  });
  alignMeasureInputs(formArea);

  setupPipelineAndGraph(tab);

  const fields = getFields(tab.code);
  fields.forEach(f => {
    document.getElementById(`pv_${f}`)?.addEventListener('input', () => {
      saveData(id);
      updateGuide(tab.code);
      updateInlineHints(tab.code);
      if (g('range')) updateLinSummary(g('range'), IS_WATER(tab.code) ? gv('s1') : undefined);
      updatePipeline(tab.code);
      const modal = document.getElementById('pv-graph-modal');
      if (modal && modal.classList.contains('is-open')) {
        renderGraphsInModal(tab.code);
      }
      clearTimeout(calcTimer);
      calcTimer = setTimeout(() => calculate(id), 300);
    });
  });
  // TOC 변동성 체크박스: 변경 시 재계산
  document.getElementById('pv_highvar')?.addEventListener('change', () => {
    saveData(id);
    clearTimeout(calcTimer);
    calcTimer = setTimeout(() => calculate(id), 50);
  });
  // 반복성 '별도 측정' 체크박스: 2·3차 입력칸 열고/닫고 + 상태 저장(서버 동기화)
  document.getElementById('pv_rep_extra')?.addEventListener('change', (e) => {
    const rows = document.getElementById('pv-rep-extra-rows');
    if (rows) rows.style.display = e.target.checked ? '' : 'none';
    saveData(id);
    setupPipelineAndGraph(tab);
    scheduleAutoSave();
    clearTimeout(calcTimer);
    calcTimer = setTimeout(() => calculate(id), 50);
  });
  updateGuide(tab.code);
  updateInlineHints(tab.code);
  if (g('range')) updateLinSummary(g('range'), IS_WATER(tab.code) ? gv('s1') : undefined);

  if (IS_DO(tab.code) || hasData(tab.code)) calculate(id);
  applyAccessMode();   // 새로 렌더된 입력칸에 권한(잠금) 재적용
}

function hasData(code) {
  if (IS_PH(code)) return g('ph7a') || g('ph4a');
  if (IS_DO(code)) return g('dos1');
  return g('range');
}

// ── 탭 바 렌더 ──────────────────────────────────────────
function renderTabs() {
  const bar = document.getElementById('pv-tab-list');
  if (!bar) return;
  bar.innerHTML = tabs.map(t => {
    const full = fullReceiptNo(t);
    return `
    <div class="pv-tab-item">
      <button class="pv-item-tab${t.id===activeId?' is-active':''}"
        data-id="${t.id}" data-pass="${t.pass||''}" type="button"
        title="${full}">${t.label}</button>
      <button class="pv-tab-del" data-id="${t.id}" type="button" title="삭제">×</button>
    </div>`;
  }).join('');
  bar.querySelectorAll('.pv-item-tab').forEach(b =>
    b.addEventListener('click', () => switchTab(b.dataset.id)));
  bar.querySelectorAll('.pv-tab-del').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); removeTab(b.dataset.id); }));
}

function renderEmpty() {
  const formArea = document.getElementById('pv-form-area');
  if (formArea) formArea.innerHTML =
    `<div class="card pv-empty-state">
      <p>+ 추가를 눌러 검사 항목을 선택하세요</p>
      <p class="micro">TOC, TN, TP, SS, pH, DO, COD, TU, CL 중 선택</p>
    </div>`;
}

// ── 폼 HTML ──────────────────────────────────────────────
function ni(id, label, placeholder='0') {
  const val = stored[id] ?? '';
  return `<label class="field"><span class="field__label">${label}</span>
    <input id="pv_${id}" class="field__control" type="number" step="any" inputmode="decimal" placeholder="${placeholder}" value="${val}"/></label>`;
}

function zsCell(id, num, type) {
  const val = stored[id] ?? '';
  const cls = type === 'z' ? 'z' : 's';
  // Z1/Z2/S1/S2 = 드리프트 초기 기준값, Z5/S5 = 반복성 기준값
  const hintHtml = (num === '1' || num === '2')
    ? `<span class="pv-zs-range-hint pv-zs-range-hint--ref">기준값</span>`
    : `<span class="pv-zs-range-hint" id="pv_hint_${id}"></span>`;
  return `<div class="pv-zs-cell pv-zs-cell--${cls}">
    <span class="pv-zs-badge pv-zs-badge--${cls}">${type.toUpperCase()}${num}</span>
    <div class="pv-zs-input-wrap">
      <input class="field__control pv-zs-input" id="pv_${id}" type="number" step="any" placeholder="0" value="${val}" />
      ${hintHtml}
    </div>
  </div>`;
}

function buildForm(code) {
  if (IS_PH(code))    return buildFormPH();
  if (IS_DO(code))    return buildFormDO();
  if (IS_WATER(code)) return buildFormWater(code);
  return buildFormBasic(code);
}

// ── 폼: 기본형 (TOC/TN/TP/SS/COD) ───────────────────────
function buildFormBasic(code) {
  const isToc = code === 'TOC';
  // 별도측정(2·3차) 열림 상태: 체크 저장됐거나, 기존 Z6/S6/Z7/S7 값이 있으면 열어둔다.
  const repExtraOpen = isRepExtraOpen(code);
  let headerSection = '';
  if (isToc) {
    headerSection = `
  <div class="pv-section">
    <h3 class="pv-section__title">📏 측정범위 · ⏱️ 응답시간 · 📋 배출기준</h3>
    <div class="pv-grid3">${ni('range','측정범위')}${ni('resp','응답시간(분, ≤15)')}${ni('fdis','배출기준 mg/L (없으면 0)')}</div>
    <label class="pv-highvar" style="margin-top:8px">
      <input type="checkbox" id="pv_highvar" ${stored['highvar'] === true ? 'checked' : ''}>
      <span>변동성이 큰 시료 — 15% 이하 <b>AND</b> 절대오차 0.5 mg/L 이하 둘 다 만족 (법)</span>
    </label>
  </div>`;
  } else {
    headerSection = `
  <div class="pv-section">
    <h3 class="pv-section__title">📏 측정범위</h3>
    <div class="pv-row1">${ni('range','')}</div>
  </div>`;
  }

  return `
<div class="card pv-form-card">
  ${headerSection}

  <div class="pv-section">
    <h3 class="pv-section__title">📉 드리프트 <span class="pv-hint">|평균(Z3,Z4)−평균(Z1,Z2)| / 범위 ≤ 5%</span></h3>
    <div class="pv-zs-table">
      <div class="pv-zs-section-label">초기구간</div>
      <div class="pv-zs-row">${zsCell('z1','1','z')}${zsCell('s1','1','s')}</div>
      <div class="pv-zs-row">${zsCell('z2','2','z')}${zsCell('s2','2','s')}</div>
      <div class="pv-zs-section-label pv-zs-section-label--sep">최종구간 (4시간 후)</div>
      <div class="pv-zs-row">${zsCell('z3','3','z')}${zsCell('s3','3','s')}</div>
      <div class="pv-zs-row">${zsCell('z4','4','z')}${zsCell('s4','4','s')}</div>
    </div>
    <div id="pv_drift_summary" class="pv-lin-summary"></div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">🔁 반복성 <span class="pv-hint">1차 필수 · 2·3차는 '별도 측정' 체크 시 입력</span></h3>
    <div class="pv-zs-table">
      <div class="pv-zs-section-label">1차 (필수)</div>
      <div class="pv-zs-row">${zsCell('z5','5','z')}${zsCell('s5','5','s')}</div>
    </div>
    <label class="pv-highvar" style="margin-top:8px">
      <input type="checkbox" id="pv_rep_extra" ${repExtraOpen ? 'checked' : ''}>
      <span>반복성 별도 측정 (2·3차 Z6·S6·Z7·S7 입력)</span>
    </label>
    <div id="pv-rep-extra-rows" class="pv-zs-table" style="margin-top:6px;${repExtraOpen ? '' : 'display:none'}">
      <div class="pv-zs-section-label pv-zs-section-label--sep">2·3차 (둘 다 입력해야 적용)</div>
      <div class="pv-zs-row">${zsCell('z6','6','z')}${zsCell('s6','6','s')}</div>
      <div class="pv-zs-row">${zsCell('z7','7','z')}${zsCell('s7','7','s')}</div>
    </div>
    <div id="pv_rep_summary" class="pv-lin-summary"></div>
  </div>

  <div id="pv-input-guide" class="pv-guide-panel" hidden></div>

  <div class="pv-section">
    <h3 class="pv-section__title">📈 직선성 <span class="pv-hint">평균값 오차 ≤ 5%</span></h3>
    <div class="pv-lin-wrap">
      <div class="pv-lin-header">
        <span>M1</span><span>M2</span><span>M3</span>
      </div>
      <div class="pv-lin-inputs">
        <div class="pv-lin-cell">${ni('m1','')}</div>
        <div class="pv-lin-cell">${ni('m2','')}</div>
        <div class="pv-lin-cell">${ni('m3','')}</div>
      </div>
      <div id="pv_lin_summary" class="pv-lin-summary"></div>
    </div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">🧪 현장적용계수 <span class="pv-hint">(선택)</span></h3>
    <div class="pv-field-rounds">
      <div class="pv-field-round">
        <div class="pv-field-round__label"><span class="pv-field-round__badge">1</span>측정 1회차</div>
        <div class="pv-field-round__inputs">
          ${ni('ci1','현장값 Ci₁')}${ni('ai1','수분석 Ai₁')}${ni('ai2','수분석 Ai₂')}
        </div>
      </div>
      <div class="pv-field-round">
        <div class="pv-field-round__label"><span class="pv-field-round__badge">2</span>측정 2회차</div>
        <div class="pv-field-round__inputs">
          ${ni('ci2','현장값 Ci₂')}${ni('ai3','수분석 Ai₃')}${ni('ai4','수분석 Ai₄')}
        </div>
      </div>
    </div>
  </div>

  ${code==='COD' ? `
  <div class="pv-section">
    <h3 class="pv-section__title">🍬 포도당변동성 <span class="pv-hint">(선택)</span></h3>
    <div class="pv-grid2">${ni('codmax','최댓값')}${ni('codmin','최솟값')}</div>
  </div>` : ''}
</div>

${buildResultsPanel(code)}`;
}

// ── 폼: pH ───────────────────────────────────────────────
function buildFormPH() {
  return `
<div class="card pv-form-card">
  <div class="pv-section">
    <h3 class="pv-section__title">🔁 반복성
      <span class="pv-hint">pH7·pH4 각 3회 측정 (RSD ≤ 3%)</span>
    </h3>
    <div class="pv-zs-table">
      <div class="pv-zs-header"><span></span><span>pH 7 (저농도)</span><span>pH 4 (고농도)</span></div>
      <div class="pv-zs-row"><span class="pv-zs-label">1회</span>${ni('ph7a','pH7 ①')}${ni('ph4a','pH4 ①')}</div>
      <div class="pv-zs-row"><span class="pv-zs-label">2회</span>${ni('ph7b','pH7 ②')}${ni('ph4b','pH4 ②')}</div>
      <div class="pv-zs-row"><span class="pv-zs-label">3회</span>${ni('ph7c','pH7 ③')}${ni('ph4c','pH4 ③')}</div>
    </div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">📉 드리프트
      <span class="pv-hint">초기 → 2시간 후, |차|/14×100 ≤ 5%</span>
    </h3>
    <div class="pv-grid2">${ni('phdi','시험 초기')}${ni('phdf','2시간 후')}</div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">📈 직선성
      <span class="pv-hint">pH4·pH7·pH10 측정, max-min/14×100 ≤ 5%</span>
    </h3>
    <div class="pv-grid3">${ni('phm4','pH4 측정')}${ni('phm7','pH7 측정')}${ni('phm10','pH10 측정')}</div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">🌡️ 온도보상
      <span class="pv-hint">기준: pH4.00 완충액, max-min ≤ 0.1</span>
    </h3>
    <div class="pv-grid3">
      ${ni('pht10','10℃ 측정')}${ni('pht15','15℃ 측정')}${ni('pht20','20℃ 측정')}
      ${ni('pht25','25℃ 측정')}${ni('pht30','30℃ 측정')}
    </div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">🧪 현장적용계수 <span class="pv-hint">(선택, |Ai평균-Ci평균| ≤ 0.3)</span></h3>
    <div class="pv-field-rounds">
      <div class="pv-field-round">
        <div class="pv-field-round__label">1회차</div>
        <div class="pv-field-round__inputs">
          ${ni('phci1','현장측정값 Ci₁')}${ni('phai1','수분석 Ai₁')}${ni('phai2','수분석 Ai₂')}
        </div>
      </div>
      <div class="pv-field-round">
        <div class="pv-field-round__label">2회차</div>
        <div class="pv-field-round__inputs">
          ${ni('phci2','현장측정값 Ci₂')}${ni('phai3','수분석 Ai₃')}${ni('phai4','수분석 Ai₄')}
        </div>
      </div>
    </div>
  </div>
</div>

${buildResultsPanel('PH')}`;
}

// ── 폼: DO ───────────────────────────────────────────────
function buildFormDO() {
  return `
<div class="card pv-form-card">
  <div class="pv-section">
    <h3 class="pv-section__title">🔁 반복성
      <span class="pv-hint">25℃ Span(8.263) 기준 S 3회 (RSD ≤ 3%)</span>
    </h3>
    <div class="pv-grid3">${ni('dos1','S1')}${ni('dos2','S2')}${ni('dos3','S3')}</div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">📉 드리프트
      <span class="pv-hint">초기 → 2시간 후, |차|/20×100 ≤ 5%</span>
    </h3>
    <div class="pv-zs-table">
      <div class="pv-zs-header"><span></span><span>Z (제로)</span><span>S (스팬)</span></div>
      <div class="pv-zs-row"><span class="pv-zs-label">시험 초기</span>${ni('dozi','Z 초기')}${ni('dosi','S 초기')}</div>
      <div class="pv-zs-row"><span class="pv-zs-label">2시간 후</span>${ni('dozf','Z 2시간')}${ni('dosf','S 2시간')}</div>
    </div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">📈 직선성
      <span class="pv-hint">(max-min)/20×100 ≤ 5%</span>
    </h3>
    <div class="pv-grid2">${ni('domax','최댓값')}${ni('domin','최솟값')}</div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">🌡️ 온도보상
      <span class="pv-hint">20℃ 기준 9.092, 30℃ 기준 7.559, 오차 ≤ 5%</span>
    </h3>
    <div class="pv-grid2">${ni('dot20','20℃ 측정값')}${ni('dot30','30℃ 측정값')}</div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">⏱️ 응답시간 <span class="pv-hint">기준: 120초 이하</span></h3>
    <div style="max-width:200px">${ni('resp','측정값 (초)')}</div>
    <p class="pv-zs-note" style="margin-top:6px">기준값 고정 ≤ 120초. 측정값만 입력하세요.</p>
  </div>
</div>

${buildResultsPanel('DO')}`;
}

// ── 폼: 먹는물 (TU/CL) ──────────────────────────────────
function buildFormWater(code) {
  return `
<div class="card pv-form-card">
  <div class="pv-section">
    <h3 class="pv-section__title">📏 측정범위</h3>
    <div class="pv-row1">${ni('range','')}</div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">📉 드리프트 및 🔁 반복성</h3>
    <div class="pv-zs-wrap">
      <div class="pv-zs-table">
        <div class="pv-zs-section-label">드리프트 초기구간</div>
        <div class="pv-zs-row">${zsCell('z1','1','z')}${zsCell('s1','1','s')}</div>
        <div class="pv-zs-row">${zsCell('z2','2','z')}${zsCell('s2','2','s')}</div>
        <div class="pv-zs-section-label pv-zs-section-label--sep">드리프트 최종구간</div>
        <div class="pv-zs-row">${zsCell('z3','3','z')}${zsCell('s3','3','s')}</div>
        <div class="pv-zs-row">${zsCell('z4','4','z')}${zsCell('s4','4','s')}</div>
        <div class="pv-zs-section-label pv-zs-section-label--sep">반복성 1차 (필수)</div>
        <div class="pv-zs-row">${zsCell('z5','5','z')}${zsCell('s5','5','s')}</div>
        <div class="pv-zs-section-label pv-zs-section-label--sep">반복성 2·3차 (둘 다 입력해야 적용)</div>
        <div class="pv-zs-row">${zsCell('z6','6','z')}${zsCell('s6','6','s')}</div>
        <div class="pv-zs-row">${zsCell('z7','7','z')}${zsCell('s7','7','s')}</div>
      </div>
      <p class="pv-zs-note">드리프트: |평균(Z3,Z4)−평균(Z1,Z2)| / 범위 ≤ 3% | 반복성: Z5+Z6+Z7 모두 입력 시 3회 직접계산, 미입력 시 4콤보 자동선택 / 범위 ≤ 2%</p>
      <div id="pv_rep_summary" class="pv-lin-summary"></div>
    </div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">📈 직선성 — 주입농도값 M</h3>
    <div class="pv-row1">${ni('m1','M')}</div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">⏱️ 응답시간
      <span class="pv-hint">기준: S1 × 0.5 자동계산. 시약식은 해당 없음.</span>
    </h3>
    <div class="pv-resp-water">
      <label class="pv-resp-toggle">
        <input type="checkbox" id="pv_resp_skip" />
        <span>시약식 — 응답시간 시험 해당 없음</span>
      </label>
      <div id="pv_resp_fields" style="margin-top:8px">
        <div style="max-width:200px">${ni('resp','측정값 (mm)')}</div>
        <p class="pv-zs-note" style="margin-top:4px" id="pv_resp_criterion">기준: S1 입력 후 자동계산 (S1 × 0.5)</p>
      </div>
    </div>
  </div>
</div>

${buildResultsPanel(code)}`;
}

// ── 결과 패널 HTML ───────────────────────────────────────
function buildResultsPanel(code) {
  const extraBlocks = [];
  if (IS_PH(code) || IS_DO(code)) {
    extraBlocks.push(`<div class="pv-res-block" id="pv-res-tc-block" hidden>
      <h4 class="pv-res-block__title">🌡️ 온도보상</h4><div id="pv-res-tc"></div></div>`);
  }
  if (!IS_DO(code) && !IS_WATER(code)) {
    extraBlocks.push(`<div class="pv-res-block" id="pv-res-field-block" hidden>
      <h4 class="pv-res-block__title">🧪 현장적용계수</h4><div id="pv-res-field"></div></div>`);
  }
  if (IS_COD(code)) {
    extraBlocks.push(`<div class="pv-res-block" id="pv-res-gluc-block" hidden>
      <h4 class="pv-res-block__title">🍬 포도당변동성</h4><div id="pv-res-gluc"></div></div>`);
  }
  // 기본형(TOC/TN/TP/SS/COD)에는 측정범위 초과 블록 추가
  if (!IS_PH(code) && !IS_DO(code)) {
    extraBlocks.push(`<div class="pv-res-block" id="pv-res-range-block" hidden>
      <h4 class="pv-res-block__title">📏 측정범위 검사</h4><div id="pv-res-range"></div></div>`);
  }
  // 응답시간: TOC, DO(buildFormDO에서 처리), TU, CL, pH(buildFormPH에서 처리)
  if (code === 'TOC' || IS_DO(code) || IS_WATER(code) || IS_PH(code)) {
    extraBlocks.push(`<div class="pv-res-block" id="pv-res-resp-block" hidden>
      <h4 class="pv-res-block__title">⏱️ 응답시간</h4><div id="pv-res-resp"></div></div>`);
  }
  return `
<div id="pv-results" class="card pv-results-card" hidden>
  <details class="pv-collapse">
    <summary class="pv-collapse__summary">검사 결과</summary>
    <div class="pv-res-grid" style="margin-top:12px">
      <div class="pv-res-block"><h4 class="pv-res-block__title">🔁 반복성 (RSD)</h4><div id="pv-res-rep"></div></div>
      <div class="pv-res-block"><h4 class="pv-res-block__title">📉 드리프트</h4><div id="pv-res-drift"></div></div>
      <div class="pv-res-block"><h4 class="pv-res-block__title">📈 직선성</h4><div id="pv-res-lin"></div></div>
      ${extraBlocks.join('\n      ')}
    </div>
    <div id="pv-final"></div>
  </details>
  <details class="pv-collapse">
    <summary class="pv-collapse__summary">법령근거 · 정도검사기준 <span class="pv-legal-badge">국가법령정보센터</span></summary>
    <div id="pv-legal-content" class="pv-legal-content" style="margin-top:10px"></div>
  </details>
  <div style="text-align:right;margin-top:12px">
    <button class="btn btn--ghost btn--mini" id="pv-cert-btn-result" type="button">성적서 출력</button>
  </div>
</div>`;
}

// ── 성적서 ───────────────────────────────────────────────
const FIELD_LABELS = {
  range:'측정범위 R', fdis:'배출기준 (mg/L)', resp:'응답시간',
  z1:'Z1',z2:'Z2',z3:'Z3',z4:'Z4',z5:'Z5',z6:'Z6',z7:'Z7',
  s1:'S1',s2:'S2',s3:'S3',s4:'S4',s5:'S5',s6:'S6',s7:'S7',
  m1:'M1',m2:'M2',m3:'M3',
  ci1:'Ci₁(현장)',ci2:'Ci₂(현장)',ai1:'Ai₁(수분석)',ai2:'Ai₂',ai3:'Ai₃',ai4:'Ai₄',
  codmax:'최댓값',codmin:'최솟값',
  ph7a:'pH7 1회',ph4a:'pH4 1회',ph7b:'pH7 2회',ph4b:'pH4 2회',ph7c:'pH7 3회',ph4c:'pH4 3회',
  phdi:'드리프트 초기',phdf:'드리프트 2시간후',
  phm4:'직선성 pH4',phm7:'직선성 pH7',phm10:'직선성 pH10',
  pht10:'온도보상 10℃',pht15:'15℃',pht20:'20℃',pht25:'25℃',pht30:'30℃',
  phci1:'Ci₁(현장)',phai1:'Ai₁',phai2:'Ai₂',phci2:'Ci₂(현장)',phai3:'Ai₃',phai4:'Ai₄',
  dos1:'S1',dos2:'S2',dos3:'S3',
  dozi:'Z초기',dozf:'Z 2시간후',dosi:'S초기',dosf:'S 2시간후',
  domax:'최댓값',domin:'최솟값',dot20:'20℃',dot30:'30℃',
};

function certRow(l,v,p) {
  const color = p===null?'#888':p?'#1a7f37':'#cf222e';
  const verdict = p===null?'—':p?'적합':'부적합';
  return `<tr>
    <td style="padding:6px 10px;border:1px solid #ccc">${l}</td>
    <td style="padding:6px 10px;border:1px solid #ccc">${v}</td>
    <td style="padding:6px 10px;border:1px solid #ccc;font-weight:600;color:${color}">${verdict}</td></tr>`;
}

function buildCertResultRows(tab) {
  let rows = ''; let allPass = true;
  const addRow = (l,v,p) => { rows += certRow(l,v,p); if(p===false) allPass=false; };
  const d = loadData(tab.id);
  const gd = f => { const v = parseFloat(d[f]); return Number.isFinite(v) ? v : null; };
  if (IS_PH(tab.code)) {
    const rep = repeatability([gd('ph7a'),gd('ph7b'),gd('ph7c')],[gd('ph4a'),gd('ph4b'),gd('ph4c')]);
    const dr = drift(14,[gd('phdi')],[gd('phdf')],[gd('phdi')],[gd('phdf')]);
    const lin = phLinearity([gd('phm4'),gd('phm7'),gd('phm10')]);
    addRow(`pH7 반복성 RSD ≤ ${rep.limit}%`,`${fmt(rep.zero.rsd)}%`,rep.zero.pass);
    addRow(`pH4 반복성 RSD ≤ ${rep.limit}%`,`${fmt(rep.span.rsd)}%`,rep.span.pass);
    addRow(`드리프트 ≤ ${PRECISION_CRITERIA.zeroDrift}%`,`${fmt(dr.zeroDrift)}%`,dr.zeroPass);
    addRow(`직선성 ≤ ${PRECISION_CRITERIA.linearity}%`,`${fmt(lin.error, 1)}%`,lin.pass);
    const tc = phTemperatureComp({t10:gd('pht10'),t15:gd('pht15'),t20:gd('pht20'),t25:gd('pht25'),t30:gd('pht30')});
    if(tc.pass!==null) addRow(`온도보상 max-min ≤ ${PRECISION_CRITERIA.phTempComp}`,fmt(tc.range,3),tc.pass);
    // pH 현장적용계수: |Ai평균-Ci| ≤ 0.20 (계산기와 동일)
    const fci1=gd('phci1'),fci2=gd('phci2'),fai1=gd('phai1'),fai2=gd('phai2'),fai3=gd('phai3'),fai4=gd('phai4');
    if(fci1!=null||fci2!=null||fai1!=null||fai2!=null||fai3!=null||fai4!=null){
      const fRes=fieldApplication('PH',[fai1,fai2,fai3,fai4],[fci1,fci2]);
      addRow('pH 현장적용계수 |Ai-Ci| ≤ 0.20',`${fmt(fRes.fi,2)}`,fRes.pass);
    }
  } else if (IS_DO(tab.code)) {
    const rep = repeatability([],[gd('dos1'),gd('dos2'),gd('dos3')], 20);
    const dr = drift(20,[gd('dozi')],[gd('dozf')],[gd('dosi')],[gd('dosf')]);
    const lin = doLinearity(gd('domax'),gd('domin'),20);
    addRow(`DO 반복성 RSD ≤ ${rep.limit}%`,`${fmt(rep.span.rsd)}%`,rep.span.pass);
    addRow(`제로드리프트 ≤ ${PRECISION_CRITERIA.zeroDrift}%`,`${fmt(dr.zeroDrift)}%`,dr.zeroPass);
    addRow(`스팬드리프트 ≤ ${PRECISION_CRITERIA.spanDrift}%`,`${fmt(dr.spanDrift)}%`,dr.spanPass);
    addRow(`직선성 ≤ ${PRECISION_CRITERIA.linearity}%`,`${fmt(lin.error, 1)}%`,lin.pass);
    if(gd('dot20')||gd('dot30')){
      const tc = doTemperatureComp(gd('dot20'),gd('dot30'));
      addRow(`DO 온도보상 |편차| ≤ ${tc.limit} mg/L`,`${fmt(tc.maxDev,2)} mg/L`,tc.pass);
    }
    // DO 응답시간: 고정 120초 (계산기와 동일)
    const dResp=gd('resp');
    if(dResp!=null) addRow('응답시간 ≤ 120초',`${fmt(dResp,0)}초`,dResp<=120);
  } else {
    const range=gd('range'),isWater=IS_WATER(tab.code);
    const zRepVals=pickRepVals(gd('z5'),gd('z6'),gd('z7'),[gd('z1'),gd('z2')],[gd('z3'),gd('z4')]);
    const sRepVals=pickRepVals(gd('s5'),gd('s6'),gd('s7'),[gd('s1'),gd('s2')],[gd('s3'),gd('s4')]);
    const rep=repeatability(zRepVals,sRepVals,range,isWater?2.0:undefined);
    const dr=drift(range,[gd('z1'),gd('z2')],[gd('z3'),gd('z4')],[gd('s1'),gd('s2')],[gd('s3'),gd('s4')],isWater?{zero:3,span:3}:undefined);
    const linRef=isWater&&gd('s1')>0?gd('s1')/2:undefined;
    const lin=linearity(range,isWater?[gd('m1')]:[gd('m1'),gd('m2'),gd('m3')],linRef);
    const driftLim=isWater?3:PRECISION_CRITERIA.zeroDrift;
    addRow(`저농도 반복성 RSD ≤ ${rep.limit}%`,rep.zero.pass===null?'—':`${fmt(rep.zero.rsd)}%`,rep.zero.pass);
    addRow(`고농도 반복성 RSD ≤ ${rep.limit}%`,rep.span.pass===null?'—':`${fmt(rep.span.rsd)}%`,rep.span.pass);
    addRow(`제로드리프트 ≤ ${driftLim}%`,`${fmt(dr.zeroDrift)}%`,dr.zeroPass);
    addRow(`스팬드리프트 ≤ ${driftLim}%`,`${fmt(dr.spanDrift)}%`,dr.spanPass);
    addRow(`직선성 ≤ ${PRECISION_CRITERIA.linearity}%`,`${fmt(lin.error, 1)}%`,lin.pass);
    const ci1=gd('ci1'),ci2=gd('ci2'),ai1=gd('ai1'),ai2=gd('ai2'),ai3=gd('ai3'),ai4=gd('ai4');
    if(ci1||ci2||ai1||ai2||ai3||ai4){
      const fRes=fieldApplication(tab.code,[ai1,ai2,ai3,ai4],[ci1,ci2],{discharge:gd('fdis'), highVariability: d['highvar'] === true});
      const fv=fRes.highVariability
        ?`변동성 큰 시료: 오차율 ${fmt(fRes.meanRate,1)}% (≤15%) AND 절대오차 ${fmt(fRes.meanFi,3)} mg/L (≤0.5)`
        :fRes.useDischarge
          ?`Fi/배출기준 ${fmt(fRes.dischargeRate,1)}% (기준 ≤15%)`
          :fRes.useRate?`오차율 ${fmt(fRes.meanRate,1)}% (기준 ≤${fRes.limit}%)`
          :`절대오차 ${fmt(fRes.meanFi,3)} mg/L (기준 ≤${fRes.limit} mg/L)`;
      addRow(`${tab.code} 현장적용계수`,fv,fRes.pass);
    }
    if(IS_COD(tab.code)&&(gd('codmax')||gd('codmin'))){
      const gRes=codGlucoseVariability(gd('codmax'),gd('codmin'),range);
      addRow(`포도당변동성 ≤ ${PRECISION_CRITERIA.codGlucose}%`,`${fmt(gRes.error)}%`,gRes.pass);
    }
    if(tab.code==='TOC'){
      // TOC 응답시간: 고정 15분 기준 (계산기와 동일)
      const resp=gd('resp');
      if(resp) addRow('응답시간 ≤ 15분',`${fmt(resp,1)}분`,resp<=15);
    } else if(isWater){
      // TU/Cl 응답: 응답값 ≥ S1×0.5 (계산기와 동일, resp_skip 시 생략)
      const resp=gd('resp'), s1=gd('s1'), respLimit=s1?s1*0.5:null;
      if(d['resp_skip']!==true && resp!=null && respLimit!=null)
        addRow('응답값 ≥ S1×0.5',`${fmt(resp,2)} (기준 ≥ ${fmt(respLimit,2)})`,resp>=respLimit);
    }
  }
  return { rows, allPass };
}

function buildRawDataRows(tab) {
  const d = loadData(tab.id);
  const fields = getFields(tab.code).filter(f => f !== 'resp_limit');
  const gd = f => { const v = parseFloat(d[f]); return Number.isFinite(v) ? v : NaN; };

  let repPickHTML = '';
  if (!IS_PH(tab.code) && !IS_DO(tab.code)) {
    const zPicked = pickRepWithLabels(
      gd('z5'), 'Z5', [gd('z6'), gd('z7')], ['Z6','Z7'],
      [{label:'Z1',val:gd('z1')},{label:'Z2',val:gd('z2')}],
      [{label:'Z3',val:gd('z3')},{label:'Z4',val:gd('z4')}]
    );
    const sPicked = pickRepWithLabels(
      gd('s5'), 'S5', [gd('s6'), gd('s7')], ['S6','S7'],
      [{label:'S1',val:gd('s1')},{label:'S2',val:gd('s2')}],
      [{label:'S3',val:gd('s3')},{label:'S4',val:gd('s4')}]
    );
    const fmtPick = arr => arr ? arr.map(p => `${p.label}=${p.val}`).join(', ') : '—';
    repPickHTML = `
      <tr style="background:#fffbe6"><td colspan="2" style="padding:5px 10px;border:1px solid #ddd;font-weight:600;color:#92400e;font-size:11px">▶ 반복성 계산에 사용된 값</td></tr>
      <tr><td style="padding:5px 10px;border:1px solid #ddd;color:#555">저농도(Z) 선택값</td>
        <td style="padding:5px 10px;border:1px solid #ddd;font-family:monospace;font-size:12px">${fmtPick(zPicked)}</td></tr>
      <tr><td style="padding:5px 10px;border:1px solid #ddd;color:#555">고농도(S) 선택값</td>
        <td style="padding:5px 10px;border:1px solid #ddd;font-family:monospace;font-size:12px">${fmtPick(sPicked)}</td></tr>`;
  }

  const inputRows = fields.map(f => {
    const v = d[f];
    if (v === undefined || v === '' || v === null) return '';
    return `<tr><td style="padding:5px 10px;border:1px solid #ddd;color:#555">${FIELD_LABELS[f]||f}</td>
      <td style="padding:5px 10px;border:1px solid #ddd;font-family:monospace">${v}</td></tr>`;
  }).join('');

  return repPickHTML + inputRows;
}

function buildCertPageHTML(tab, date) {
  const { rows } = buildCertResultRows(tab);
  const allPass = tab.pass === 'ok';
  const rawRows = buildRawDataRows(tab);
  const passColor = allPass ? '#1a7f37' : '#cf222e';
  return `<div class="cert-page">
    <div class="cert-header">
      <div style="font-size:18px;font-weight:700">수질TMS 정도검사 성적서</div>
      <div style="font-size:11px;color:#666;margin-top:2px">KTL 전문 계측 서비스</div>
    </div>
    <table class="cert-meta">
      <tr><td>접수번호</td><td style="font-family:monospace;font-weight:600">${fullReceiptNo(tab)}</td></tr>
      ${calcSiteName ? `<tr><td>현장명</td><td style="font-weight:600">${calcSiteName}</td></tr>` : ''}
      <tr><td>검사 항목</td><td style="font-weight:600">${tab.label}</td></tr>
      <tr><td>검사년도</td><td>${date}</td></tr>
    </table>
    <div class="cert-section-title">▶ 검사 결과</div>
    <table class="cert-table">
      <thead><tr><th>검사항목</th><th>수치</th><th style="width:70px">판정</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="cert-verdict" style="border-color:${passColor};color:${passColor}">
      최종 판정: ${allPass ? '✅ 전 항목 적합' : '❌ 부적합 항목 있음'}
    </div>
    ${rawRows ? `
    <div class="cert-section-title" style="margin-top:18px">▶ Raw Data (측정 입력값)</div>
    <table class="cert-table">
      <thead><tr><th>항목</th><th>입력값</th></tr></thead>
      <tbody>${rawRows}</tbody>
    </table>` : ''}
  </div>`;
}

const CERT_PRINT_CSS = `
  body{font-family:sans-serif;margin:0;padding:0;color:#000;background:#fff}
  .cert-page{padding:36px 40px;max-width:660px;margin:0 auto;page-break-after:always}
  .cert-page:last-child{page-break-after:avoid}
  .cert-header{text-align:center;margin-bottom:18px;padding-bottom:12px;border-bottom:2px solid #000}
  .cert-meta{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:13px}
  .cert-meta td{padding:4px 0}
  .cert-meta td:first-child{width:90px;color:#666}
  .cert-section-title{font-size:13px;font-weight:700;margin:0 0 6px;color:#334}
  .cert-table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px}
  .cert-table th{padding:7px 10px;text-align:left;border:1px solid #ccc;background:#f0f0f0;font-size:12px}
  .cert-table td{padding:6px 10px;border:1px solid #ccc}
  .cert-verdict{border:2px solid;border-radius:6px;padding:10px;text-align:center;font-size:15px;font-weight:700;margin-bottom:10px}
  @media print{.cert-page{padding:20px 24px}}
`;

function openCertPrintWindow(pagesHTML) {
  const win = window.open('', '_blank', 'width=780,height=1000');
  if (!win) { alert('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.'); return; }
  win.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
    <title>정도검사 성적서</title><style>${CERT_PRINT_CSS}</style></head>
    <body>${pagesHTML}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 400);
}

function showCert(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;
  saveData(tabId);  // 출력 전 현재 입력값 저장 — 성적서가 옛 데이터 쓰는 것 방지
  const date = new Date().getFullYear() + '년';

  // 기존 오버레이 제거
  document.getElementById('cert-overlay')?.remove();

  const { rows } = buildCertResultRows(tab);
  const allPass = tab.pass === 'ok';
  const rawRows = buildRawDataRows(tab);
  const passColor = allPass ? '#1a7f37' : '#cf222e';

  const ov = document.createElement('div');
  ov.id = 'cert-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto';
  ov.innerHTML = `
    <div style="background:#fff;color:#000;max-width:660px;width:100%;border-radius:12px;padding:32px 36px;font-family:sans-serif;max-height:90vh;overflow:auto">
      <div style="text-align:center;margin-bottom:18px;padding-bottom:12px;border-bottom:2px solid #000">
        <div style="font-size:19px;font-weight:700">수질TMS 정도검사 성적서</div>
        <div style="font-size:11px;color:#666;margin-top:3px">KTL 전문 계측 서비스</div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:13px">
        <tr><td style="padding:4px 0;width:90px;color:#666">접수번호</td><td style="font-weight:600;font-family:monospace">${fullReceiptNo(tab)}</td></tr>
        ${calcSiteName ? `<tr><td style="padding:4px 0;color:#666">현장명</td><td style="font-weight:600">${calcSiteName}</td></tr>` : ''}
        <tr><td style="padding:4px 0;color:#666">검사 항목</td><td style="font-weight:600">${tab.label}</td></tr>
        <tr><td style="padding:4px 0;color:#666">검사년도</td><td>${date}</td></tr>
      </table>
      <div style="font-size:13px;font-weight:700;margin:0 0 6px">▶ 검사 결과</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px">
        <thead><tr style="background:#f0f0f0">
          <th style="padding:7px 10px;text-align:left;border:1px solid #ccc">검사항목</th>
          <th style="padding:7px 10px;text-align:left;border:1px solid #ccc">수치</th>
          <th style="padding:7px 10px;text-align:left;border:1px solid #ccc;width:70px">판정</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="border:2px solid ${passColor};border-radius:6px;padding:10px;text-align:center;font-size:15px;font-weight:700;color:${passColor};margin-bottom:16px">
        최종 판정: ${allPass ? '✅ 전 항목 적합' : '❌ 부적합 항목 있음'}
      </div>
      ${rawRows ? `
      <div style="font-size:13px;font-weight:700;margin:0 0 6px">▶ Raw Data (측정 입력값)</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px">
        <thead><tr style="background:#f9f9f9">
          <th style="padding:6px 10px;text-align:left;border:1px solid #ddd">항목</th>
          <th style="padding:6px 10px;text-align:left;border:1px solid #ddd">입력값</th>
        </tr></thead>
        <tbody>${rawRows}</tbody>
      </table>` : ''}
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button id="cert-print-one" style="padding:8px 16px;background:#0969da;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:13px">🖨 이 항목 출력</button>
        <button id="cert-print-all" style="padding:8px 16px;background:#6f42c1;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:13px">📄 전체 출력</button>
        <button onclick="document.getElementById('cert-overlay').remove()" style="padding:8px 16px;background:#f0f0f0;border:0;border-radius:6px;cursor:pointer;font-size:13px">닫기</button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  document.getElementById('cert-print-one').addEventListener('click', () => {
    openCertPrintWindow(buildCertPageHTML(tab, date));
  });
  document.getElementById('cert-print-all').addEventListener('click', () => {
    const allPages = tabs.map(t => buildCertPageHTML(t, date)).join('');
    openCertPrintWindow(allPages);
  });
}

// ── 초기화 ───────────────────────────────────────────────
function init() {
  const panel = document.getElementById('panel-precision');
  if (!panel) return;

  loadMeta();
  if (!activeId || !tabs.find(t => t.id === activeId)) {
    activeId = tabs.length ? tabs[0].id : null;
  }

  // 저장된 접수번호·사용자 이름 복원 (관리자는 복원하지 않고 빈 값으로 시작)
  const isAdm = isAdmin();
  calcReceiptNo = isAdm ? '' : (localStorage.getItem('ktl-calc-receipt') || '');
  calcUserName  = isAdm ? '' : (localStorage.getItem('ktl-calc-username') || '');
  calcSiteName  = isAdm ? '' : (localStorage.getItem('ktl-site-name') || '');

  panel.innerHTML = `
<div class="pv-page">
  <div class="card pv-save-card">
    <div class="pv-save-bar">
      <div class="pv-save-field">
        <label class="pv-save-label" for="pv-receipt-no">접수번호</label>
        <input id="pv-receipt-no" class="field__control pv-save-input" type="text"
               placeholder="26-031078-01" value="${calcReceiptNo}" autocomplete="off" />
      </div>
      <div class="pv-save-field">
        <label class="pv-save-label" for="pv-user-name">사용자</label>
        <input id="pv-user-name" class="field__control pv-save-input" type="text"
               placeholder="이름" value="${calcUserName}" autocomplete="off" />
      </div>
      <div class="pv-save-field">
        <label class="pv-save-label" for="pv-site-name">현장명</label>
        <input id="pv-site-name" class="field__control pv-save-input" type="text"
               placeholder="현장명" value="${calcSiteName}" autocomplete="off" />
      </div>
      <div class="pv-save-actions">
        <button id="pv-primary-btn" class="btn btn--ghost btn--mini" type="button">주사용자 전환</button>
        <button id="pv-load-btn" class="btn btn--ghost btn--mini" type="button">📂 불러오기</button>
        <button id="pv-save-btn" class="btn btn--primary btn--mini" type="button">💾 저장</button>
        ${isAdm ? `<button id="pv-reset-btn" class="btn btn--ghost btn--mini btn--danger" type="button">🧹 청소</button>` : ''}
      </div>
    </div>
    <div id="pv-admin-receipts-quick" style="display:none; margin-top:12px; border-top:1px dashed var(--border); padding-top:10px;"></div>
    <div id="pv-save-status" class="pv-save-status"></div>
  </div>
  <div class="card pv-tab-card">
    <div class="pv-tab-bar">
      <div id="pv-tab-list" class="pv-item-tabs"></div>
      <div class="pv-add-wrap">
        <button class="btn btn--primary btn--mini pv-add-btn" id="pv-add-btn" type="button">+ 추가</button>
        <div id="pv-add-menu" class="pv-add-menu" hidden>
          ${ITEMS.map(it=>`<button class="pv-add-item" data-code="${it.code}" type="button">${it.label}</button>`).join('')}
        </div>
      </div>
      <button class="btn btn--ghost btn--mini" id="pv-cert-btn" type="button">성적서 출력</button>
    </div>
  </div>
  <div id="pv-form-area"></div>
</div>`;

  renderTabs();

  const addBtn = document.getElementById('pv-add-btn');
  const addMenu = document.getElementById('pv-add-menu');
  addBtn?.addEventListener('click', e => { e.stopPropagation(); addMenu.hidden = !addMenu.hidden; });
  document.addEventListener('click', () => { if (addMenu) addMenu.hidden = true; });
  panel.querySelectorAll('.pv-add-item').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); addMenu.hidden=true; addTab(b.dataset.code); }));

  document.getElementById('pv-cert-btn')?.addEventListener('click', () => {
    if (activeId) showCert(activeId);
  });
  panel.addEventListener('click', e => {
    if (e.target.id === 'pv-cert-btn-result' && activeId) showCert(activeId);
  });

  if (activeId) switchTab(activeId);
  else renderEmpty();

  renderAdminReceiptsQuick();

  // ── 저장/불러오기 이벤트 ───────────────────────────────
  document.getElementById('pv-receipt-no')?.addEventListener('input', e => {
    calcReceiptNo = e.target.value.trim();
    if (!isAdm) {
      try { localStorage.setItem('ktl-calc-receipt', calcReceiptNo); } catch {}
    }
    scheduleAutoSave();
  });
  document.getElementById('pv-user-name')?.addEventListener('input', e => {
    calcUserName = e.target.value.trim();
    if (!isAdm) {
      try { localStorage.setItem('ktl-calc-username', calcUserName); } catch {}
    }
    scheduleAutoSave();
  });
  document.getElementById('pv-site-name')?.addEventListener('input', e => {
    calcSiteName = e.target.value.trim();
    if (!isAdm) {
      try { localStorage.setItem('ktl-site-name', calcSiteName); } catch {}
    }
  });
  document.getElementById('pv-save-btn')?.addEventListener('click', saveToServer);
  document.getElementById('pv-load-btn')?.addEventListener('click', loadFromServer);
  document.getElementById('pv-primary-btn')?.addEventListener('click', () => {
    isPrimaryUser = !isPrimaryUser;        // 누구나 토글 (누르면 주 사용자)
    if (!isAdm) {
      try { localStorage.setItem('ktl-calc-primary', isPrimaryUser ? '1' : '0'); } catch {}
    }
    applyAccessMode();
    if (!isPrimaryUser && calcReceiptNo) loadFromServer();   // 확인용 전환 시 즉시 최신 반영
  });
  document.getElementById('pv-reset-btn')?.addEventListener('click', () => {
    if (!confirm('화면의 모든 입력 데이터와 탭을 지우고 깨끗이 청소하시겠습니까?')) return;
    try {
      localStorage.removeItem('ktl-calc-receipt');
      localStorage.removeItem('ktl-calc-username');
      localStorage.removeItem('ktl-site-name');
      localStorage.removeItem('ktl-calc-primary');
      localStorage.removeItem('ktl-tabs');
      localStorage.removeItem('ktl-tab-active');
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('ktl-pv-') || key.startsWith('ktl-calc-offline-')) {
          localStorage.removeItem(key);
        }
      });
    } catch (err) {
      console.warn('localStorage clear failed:', err);
    }
    calcReceiptNo = '';
    calcUserName  = '';
    calcSiteName  = '';
    tabs = [];
    activeId = null;
    isPrimaryUser = false;
    adminInMemoryCache = {};
    const receiptEl = document.getElementById('pv-receipt-no');
    const userEl = document.getElementById('pv-user-name');
    const siteEl = document.getElementById('pv-site-name');
    if (receiptEl) receiptEl.value = '';
    if (userEl) userEl.value = '';
    if (siteEl) siteEl.value = '';
    applyAccessMode();
    renderTabs();
    renderEmpty();
    renderAdminReceiptsQuick();
    setSaveStatus('🧹 화면이 깨끗하게 청소되었습니다.', 'ok');
  });
  applyAccessMode();   // 초기 권한 적용
  retryOfflineSaves();   // 미전송(오프라인) 저장분이 있으면 서버에 자동 재전송
  document.getElementById('pv-form-area')?.addEventListener('input', e => {
    scheduleAutoSave();
  });
  // 측정값 입력칸: 포커스 해제 시 입력값 중 최대 소수 자리로 전체 정렬
  document.getElementById('pv-form-area')?.addEventListener('focusout', e => {
    if (!e.target.classList.contains('pv-measure-input')) return;
    const formArea = document.getElementById('pv-form-area');
    if (formArea) alignMeasureInputs(formArea);
  });

  // (🎙️ 음성 입력 추적·핸들러는 모듈 레벨에서 1회 등록 — parseSpokenNumber 아래)

  // 관리자 접속 시 화면/캐시 강제 청소용 글로벌 메서드 등록
  window.resetCalculatorForAdmin = function() {
    calcReceiptNo = '';
    calcUserName  = '';
    calcSiteName  = '';
    tabs = [];
    activeId = null;
    isPrimaryUser = false;
    adminInMemoryCache = {};

    const receiptEl = document.getElementById('pv-receipt-no');
    const userEl = document.getElementById('pv-user-name');
    const siteEl = document.getElementById('pv-site-name');
    if (receiptEl) receiptEl.value = '';
    if (userEl) userEl.value = '';
    if (siteEl) siteEl.value = '';

    applyAccessMode();
    renderTabs();
    renderEmpty();
    renderAdminReceiptsQuick();
  };

  window.refreshAdminReceiptsQuick = function() {
    renderAdminReceiptsQuick();
  };
}

function getActiveReceipts() {
  try {
    const list = JSON.parse(localStorage.getItem('ktl-issued-tokens') || '[]');
    return list.filter(t => t.receiptNo && new Date(t.expiresAt).getTime() > Date.now());
  } catch {
    return [];
  }
}

function renderAdminReceiptsQuick() {
  const container = document.getElementById('pv-admin-receipts-quick');
  if (!container) return;
  if (!isAdmin()) {
    container.style.display = 'none';
    return;
  }
  const list = getActiveReceipts();
  if (list.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  container.innerHTML = `
    <div class="pv-admin-receipts-title">발행된 접수번호 (클릭 시 즉시 로드):</div>
    <div class="pv-quick-chips-grid">
      ${list.map(t => `
        <button type="button" class="btn btn--mini btn--ghost pv-quick-chip" data-load-receipt="${t.receiptNo}" title="${t.applicantName || ''} - ${t.siteName || ''}">
          <span class="pv-quick-chip-key">🔑</span><span class="pv-quick-chip-no">${t.receiptNo}</span>${t.applicantName ? `<span class="pv-quick-chip-name">(${t.applicantName})</span>` : ''}
        </button>
      `).join('')}
    </div>
  `;

  container.querySelectorAll('.pv-quick-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const receiptNo = btn.dataset.loadReceipt;
      const receiptEl = document.getElementById('pv-receipt-no');
      const userEl = document.getElementById('pv-user-name');
      if (receiptEl) {
        receiptEl.value = receiptNo;
        receiptEl.dispatchEvent(new Event('input'));
      }
      if (userEl) {
        userEl.value = '';
        userEl.dispatchEvent(new Event('input'));
      }
      loadFromServer();
    });
  });
}

window.reinitCalculator = init;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else { init(); }


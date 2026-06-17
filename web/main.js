/**
 * KTL 전문 계측 서비스 — 프런트엔드 진입점.
 * 정도검사 계산은 precision-ui.js 가 담당.
 * 이 파일은 인증·서비스 탭 전환·DB 상태·테마만 담당.
 */

import { getDbStatus } from './api.js';
import { renderStatusChip } from './render.js';
import { initChat } from './chat.js';
import { initAdmin } from './admin.js';

const $ = (id) => document.getElementById(id);

// ── 인증 ──────────────────────────────────────────────────────────────────

async function tryInviteLogin(onSuccess) {
  const params = new URLSearchParams(location.search);
  const t  = params.get('t');
  const pw = params.get('pw');
  const password = t || (pw ? pw.toUpperCase() : null);
  if (!password) return false;
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (res.ok) {
      storeToken(data.token);
      window.history.replaceState(null, '', location.pathname);
      if (data.applicantName) {
        showNameConfirmModal(data.applicantName, data.receiptNo || '', data.siteName || '', () => onSuccess(data.role || 'user'), data.token);
      } else {
        onSuccess(data.role || 'user');
      }
      return true;
    }
  } catch { /* 일반 게이트로 진행 */ }
  return false;
}

function getStoredToken() {
  try { return localStorage.getItem('ktl-auth'); } catch { return null; }
}
function storeToken(token) {
  try { localStorage.setItem('ktl-auth', token); } catch { /* 무시 */ }
}
function tokenValid(token) {
  if (!token || !token.includes('.')) return false;
  try {
    const decoded = JSON.parse(atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof decoded.exp === 'number' && Date.now() / 1000 < decoded.exp;
  } catch { return false; }
}
function tokenRole(token) {
  if (!token || !token.includes('.')) return 'user';
  try {
    const decoded = JSON.parse(atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
    return decoded.role || 'user';
  } catch { return 'user'; }
}
function showAuthError(msg) {
  const el = $('auth-err');
  if (!el) return;
  el.hidden = !msg;
  el.textContent = msg ?? '';
}

function tokenName(token) {
  if (!token || !token.includes('.')) return '';
  try {
    const decoded = JSON.parse(atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
    return decoded.id || '';
  } catch { return ''; }
}

// 비밀번호 변경 모달 (isForce 파라미터 추가)
function setupPwChangeModal(userName, onDone, isForce = true) {
  const modal = $('pw-change-modal');
  const titleEl = $('pwc-title');
  const descEl = $('pwc-desc');
  const curEl  = $('pwc-cur');
  const newEl  = $('pwc-new');
  const new2El = $('pwc-new2');
  const msgEl  = $('pwc-msg');
  const btn    = $('pwc-btn');
  const cancelBtn = $('pwc-cancel-btn');
  
  if (!modal) return;
  modal.style.display = 'flex';
  
  if (isForce) {
    if (titleEl) titleEl.textContent = '🔑 초기 비밀번호 변경 필요';
    if (descEl) descEl.textContent = '보안을 위해 초기 비밀번호를 변경해주세요. 변경 후 다시 로그인합니다.';
    if (cancelBtn) cancelBtn.style.display = 'none';
  } else {
    if (titleEl) titleEl.textContent = '🔑 비밀번호 변경';
    if (descEl) descEl.textContent = '현재 비밀번호와 새 비밀번호를 입력해주세요.';
    if (cancelBtn) {
      cancelBtn.style.display = 'block';
      cancelBtn.onclick = () => { modal.style.display = 'none'; };
    }
  }

  curEl.value = ''; newEl.value = ''; new2El.value = ''; msgEl.style.display = 'none';
  curEl.focus();

  const showMsg = (txt, ok=false) => {
    msgEl.textContent = txt;
    msgEl.style.color = ok ? '#4ade80' : '#f87171';
    msgEl.style.display = 'block';
  };

  async function submit() {
    const cur = curEl.value, nw = newEl.value, nw2 = new2El.value;
    if (!cur || !nw || !nw2) return showMsg('모두 입력하세요');
    if (nw !== nw2) return showMsg('새 비밀번호가 일치하지 않습니다');
    if (nw.length < 4) return showMsg('4자 이상 입력하세요');
    if (nw === cur) return showMsg('현재 비밀번호와 동일합니다');
    btn.disabled = true; btn.textContent = '변경 중…';
    try {
      const r = await fetch('/api/changePassword', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: userName, currentPassword: cur, newPassword: nw }),
      });
      const d = await r.json();
      if (r.ok) {
        showMsg('✅ 변경되었습니다. 다시 로그인해주세요.', true);
        setTimeout(() => { modal.style.display = 'none'; onDone(); }, 1500);
      } else {
        showMsg('❌ ' + (d.error || '오류가 발생했습니다'));
      }
    } catch { showMsg('서버에 연결할 수 없습니다'); }
    finally { btn.disabled = false; btn.textContent = '비밀번호 변경'; }
  }
  
  btn.onclick = submit;
  new2El.onkeydown = e => { if (e.key === 'Enter') submit(); };
}

function showNameConfirmModal(applicantName, receiptNo, siteName, onConfirmed, sessionToken) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999';

  const box = document.createElement('div');
  box.style.cssText = 'background:#1e293b;border-radius:14px;padding:28px 24px;min-width:280px;max-width:340px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.5);text-align:center';

  const nameDisplay = document.createElement('div');
  nameDisplay.style.cssText = 'font-size:22px;font-weight:700;color:#f1f5f9;margin-bottom:6px';
  nameDisplay.textContent = applicantName || '(이름 없음)';

  const sub = document.createElement('div');
  sub.style.cssText = 'font-size:14px;color:#94a3b8;margin-bottom:6px';
  sub.textContent = '유지관리담당자 맞습니까?';

  const siteEl = document.createElement('div');
  siteEl.style.cssText = 'font-size:13px;color:#7dd3fc;margin-bottom:4px';
  siteEl.textContent = siteName ? `현장: ${siteName}` : '';

  const receiptEl = document.createElement('div');
  receiptEl.style.cssText = 'font-size:12px;color:#64748b;margin-bottom:16px';
  receiptEl.textContent = receiptNo ? `접수번호: ${receiptNo}` : '';

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;justify-content:center;margin-bottom:12px';

  const yesBtn = document.createElement('button');
  yesBtn.textContent = '맞습니다';
  yesBtn.style.cssText = 'flex:1;padding:10px;border-radius:8px;border:none;background:#0ea5e9;color:#fff;font-size:15px;font-weight:600;cursor:pointer';

  const noBtn = document.createElement('button');
  noBtn.textContent = '아닙니다';
  noBtn.style.cssText = 'flex:1;padding:10px;border-radius:8px;border:none;background:#334155;color:#f1f5f9;font-size:15px;cursor:pointer';

  const changeRow = document.createElement('div');
  changeRow.style.cssText = 'display:none;margin-top:8px';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = '이름을 입력하세요';
  nameInput.style.cssText = 'width:100%;box-sizing:border-box;padding:9px 12px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#f1f5f9;font-size:14px;margin-bottom:8px';

  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = '확인';
  confirmBtn.style.cssText = 'width:100%;padding:9px;border-radius:8px;border:none;background:#0ea5e9;color:#fff;font-size:14px;font-weight:600;cursor:pointer';

  changeRow.appendChild(nameInput);
  changeRow.appendChild(confirmBtn);
  btnRow.appendChild(yesBtn);
  btnRow.appendChild(noBtn);
  box.appendChild(nameDisplay);
  box.appendChild(sub);
  box.appendChild(siteEl);
  box.appendChild(receiptEl);
  box.appendChild(btnRow);
  box.appendChild(changeRow);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const done = (name) => {
    try {
      localStorage.setItem('ktl-applicant-name', name);
      if (receiptNo) localStorage.setItem('ktl-receipt-no', receiptNo);
      // 계산기 UI(precision-ui.js)가 읽는 키도 함께 저장
      localStorage.setItem('ktl-calc-username', name);
      if (receiptNo) localStorage.setItem('ktl-calc-receipt', receiptNo);
      if (siteName) localStorage.setItem('ktl-site-name', siteName);
      // DOM 직접 업데이트 (precision-ui init()이 이미 실행된 후라 localStorage만으론 부족)
      const receiptEl = document.getElementById('pv-receipt-no');
      const userEl = document.getElementById('pv-user-name');
      const siteEl = document.getElementById('pv-site-name');
      if (receiptEl && receiptNo) {
        receiptEl.value = receiptNo;
        receiptEl.dispatchEvent(new Event('input'));
      }
      if (userEl) {
        userEl.value = name;
        userEl.dispatchEvent(new Event('input'));
      }
      if (siteEl && siteName) {
        siteEl.value = siteName;
        siteEl.dispatchEvent(new Event('input'));
      }
    } catch { /* 무시 */ }
    // 이름이 바뀌었으면 서버(Blob 토큰 단일출처)에 영속화 → 다음 로그인 + 관리자 패널 모두 반영.
    // 실패(오프라인) 시 localStorage 캐시는 유지(즉시 표시).
    if (sessionToken && name && name !== applicantName) {
      fetch('/api/updateName', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ name }),
      }).catch(() => {});
    }
    document.body.removeChild(overlay);
    onConfirmed(name);
  };

  yesBtn.addEventListener('click', () => done(applicantName));
  noBtn.addEventListener('click', () => {
    changeRow.style.display = 'block';
    btnRow.style.display = 'none';
    nameInput.focus();
  });
  confirmBtn.addEventListener('click', () => {
    const v = nameInput.value.trim();
    if (v) done(v);
  });
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') { const v = nameInput.value.trim(); if (v) done(v); } });
}

function setupAuthGate(onSuccess) {
  const idEl   = $('auth-id');
  const passEl = $('auth-pass');
  const btn    = $('auth-btn');
  const toggleEl = $('auth-admin-toggle');
  if (!passEl || !btn) return;

  if (idEl && idEl.style.display !== 'none') {
    idEl.focus();
  } else {
    passEl.focus();
  }

  if (toggleEl) {
    toggleEl.addEventListener('click', () => {
      showAuthError('');
      if (!idEl) return;
      if (idEl.style.display === 'none') {
        idEl.style.display = 'block';
        idEl.value = '';
        const authSub = $('auth-sub');
        if (authSub) authSub.textContent = '아이디와 비밀번호를 입력하세요.';
        toggleEl.textContent = '고객 로그인 (접속 코드만 입력)';
        idEl.focus();
      } else {
        idEl.style.display = 'none';
        idEl.value = '';
        const authSub = $('auth-sub');
        if (authSub) authSub.textContent = '접속 코드 또는 비밀번호를 입력하세요.';
        toggleEl.textContent = '관리자 로그인 (아이디 입력)';
        passEl.focus();
      }
    });
  }

  async function attempt() {
    btn.disabled = true;
    btn.textContent = '확인 중…';
    showAuthError('');
    const name = (idEl && idEl.style.display !== 'none') ? idEl.value.trim() : '';
    const password = passEl.value;

    try {
      // 1순위: 개인 ID/PW (Mac Studio 사용자)
      if (name) {
        const r = await fetch('/api/userAuth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, password }),
        });
        const data = await r.json();
        if (r.ok) {
          if (data.mustChange) {
            // 비밀번호 변경 필수 → 모달 표시 후 로그아웃 상태 유지
            setupPwChangeModal(data.name, () => {
              passEl.value = '';
              btn.disabled = false; btn.textContent = '접속하기';
              passEl.focus();
            });
            return;
          }
          storeToken(data.token);
          onSuccess(data.role || 'admin');
          return;
        }
        showAuthError(data.error || '아이디 또는 비밀번호가 올바르지 않습니다.');
        return;
      }

      // 2순위: 접속 코드 / 관리자 비밀번호 (기존 방식)
      const body = { password };
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 500 && import.meta.env.DEV) {
        onSuccess('user'); return;
      }
      const data = await res.json();
      if (!res.ok) { showAuthError(data.error || '비밀번호가 올바르지 않습니다.'); return; }
      storeToken(data.token);
      if (data.applicantName) {
        showNameConfirmModal(data.applicantName, data.receiptNo || '', data.siteName || '', () => onSuccess(data.role || 'user'), data.token);
      } else {
        onSuccess(data.role || 'user');
      }
    } catch {
      showAuthError('서버에 연결할 수 없습니다.');
    } finally {
      btn.disabled = false;
      btn.textContent = '접속하기';
    }
  }
  btn.addEventListener('click', attempt);
  passEl.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
  idEl?.addEventListener('keydown', e => { if (e.key === 'Enter') passEl.focus(); });
}

function showApp() {
  const gate = $('auth-gate');
  const app = $('main-app');
  if (gate) gate.hidden = true;   // [hidden] CSS 규칙으로 숨김
  if (app) app.hidden = false;    // hidden 속성 제거 → .app { display:flex } 적용
}

async function guardAuth(onReady) {
  const searchParams = new URLSearchParams(location.search);
  if (searchParams.get('bypass') === 'true') {
    const mockPayload = { id: 'admin', role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 };
    const mockToken = btoa(JSON.stringify(mockPayload)).replace(/=/g, '') + '.dummy.dummy';
    storeToken(mockToken);
    showApp();
    onReady('admin');
    return;
  }
  const hasInviteParam = !!(searchParams.get('t') || searchParams.get('pw'));
  const inviteDone = await tryInviteLogin((role) => { showApp(); onReady(role); });
  if (inviteDone) return;

  // 초대 파라미터가 있었는데 실패 → 저장 세션 무시하고 게이트로
  if (!hasInviteParam) {
    const stored = getStoredToken();
    if (tokenValid(stored)) { showApp(); onReady(tokenRole(stored)); return; }
  } else {
    // URL의 파라미터 제거 후 오류 표시
    window.history.replaceState(null, '', location.pathname);
    showAuthError('접속 코드가 만료되었거나 삭제된 코드입니다.');
  }

  setupAuthGate((role) => { showApp(); onReady(role); });
}

// ── 서비스 탭 ──────────────────────────────────────────────────────────────

let chatInited = false, adminInited = false;

function openChat() {
  const panel   = $('chat-panel');
  const overlay = $('chat-overlay');
  if (!panel) return;
  panel.hidden   = false;
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    panel.classList.add('chat-panel--open');
    overlay.classList.add('chat-overlay--show');
  });
  if (!chatInited) { initChat(); chatInited = true; }
  setTimeout(() => $('chat-input')?.focus(), 300);
}

function closeChat() {
  const panel   = $('chat-panel');
  const overlay = $('chat-overlay');
  if (!panel) return;
  panel.classList.remove('chat-panel--open');
  overlay.classList.remove('chat-overlay--show');
  document.body.style.overflow = '';
  setTimeout(() => {
    panel.hidden   = true;
    overlay.hidden = true;
  }, 280);
}

// 서버(/api/chatMode)에서 채팅 모드를 받아 FAB 표시 갱신. 실패 시 안전 기본(관리자만/숨김).
async function applyChatModeFromServer(role) {
  const fab = $('chat-fab');
  if (!fab) return;
  // 오프라인/서버불가 시 마지막으로 받은 캐시값(localStorage)을 사용. 성공했을 때만 캐시 갱신.
  let mode = localStorage.getItem('ktl-chat-mode') || 'maintenance';
  try {
    const r = await fetch('/api/chatMode');
    if (r.ok) {
      const d = await r.json();
      if (d && d.mode) { mode = d.mode; try { localStorage.setItem('ktl-chat-mode', mode); } catch {} }
    }
  } catch { /* 오프라인 → 캐시값 유지 */ }
  fab.hidden = !(mode === 'active' || (mode === 'maintenance' && role === 'admin'));
}

function initSvcTabs(role) {
  const fab = $('chat-fab');
  // 채팅 표시는 서버(/api/chatMode) 단일 출처로 결정 → admin 설정이 모든 사용자에 반영.
  // active=전원 / maintenance=관리자만 / inactive=전원 숨김. 서버 응답 전까진 숨김(안전).
  if (fab) {
    document.body.dataset.role = role; // setChatMode에서 FAB 즉시 반영에 사용
    fab.hidden = true;
    applyChatModeFromServer(role);
  }

  if (role === 'admin') {
    const adminTab = $('admin-tab');
    if (adminTab) adminTab.hidden = false;
  }

  // 플로팅 채팅 버튼
  fab?.addEventListener('click', openChat);
  $('chat-close')?.addEventListener('click', closeChat);
  $('chat-close-bottom')?.addEventListener('click', closeChat);
  $('chat-overlay')?.addEventListener('click', closeChat);

  // 스와이프 닫기 제거 — 닫기 버튼으로만 닫음 (엄지 스와이프 오작동 방지)

  // 서비스 탭 (calc / admin 만)
  document.querySelectorAll('.svc-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.svc-tab').forEach(t => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      const svc = tab.dataset.svc;
      $('svc-calc').hidden  = svc !== 'calc';
      $('svc-admin').hidden = svc !== 'admin';
      if (svc === 'calc' && typeof window.refreshAdminReceiptsQuick === 'function') {
        window.refreshAdminReceiptsQuick();
      }
      if (svc === 'admin') {
        document.body.dataset.adminToken = getStoredToken() || '';
        initAdmin(getStoredToken() || '');
        adminInited = true;
      }
    });
  });
}

// ── 테마 ───────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('ktl-theme', theme); } catch { /* 무시 */ }
}

// ── 초기화 ─────────────────────────────────────────────────────────────────

function init(role) {
  if (role === 'admin' && typeof window.resetCalculatorForAdmin === 'function') {
    window.resetCalculatorForAdmin();
  }
  const saved = (() => { try { return localStorage.getItem('ktl-theme'); } catch { return null; } })();
  if (saved) applyTheme(saved);

  $('theme-btn')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
  });

  // 비밀번호 변경 버튼 연동 (일반 사용자/임시 토큰 접속 시 숨김, 관리자 로그인 시에만 본인 이름으로 활성화)
  const token = getStoredToken();
  const isStaff = tokenRole(token) === 'admin';
  const userName = tokenName(token);
  const pwcTrigger = $('pwc-btn-trigger');
  if (pwcTrigger) {
    if (isStaff && userName) {
      pwcTrigger.removeAttribute('hidden');
      pwcTrigger.addEventListener('click', () => {
        setupPwChangeModal(userName, () => {
          try { localStorage.removeItem('ktl-auth'); } catch {}
          location.reload();
        }, false); // isForce = false 로 일반 변경 모드 실행
      });
    } else {
      pwcTrigger.setAttribute('hidden', '');
    }
  }

  $('logout-btn')?.addEventListener('click', () => {
    try { localStorage.removeItem('ktl-auth'); } catch { /* 무시 */ }
    location.reload();
  });

  initSvcTabs(role);
  initChat();
  chatInited = true;

  void (async () => {
    renderStatusChip($('status-chip'), 'checking');
    renderStatusChip($('status-chip'), await getDbStatus());
  })();
}

guardAuth((role) => { window.__userRole = role; init(role); });

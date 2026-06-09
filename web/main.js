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
      onSuccess(data.role || 'user');
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

// 비밀번호 변경 모달 (첫 로그인 강제)
function setupPwChangeModal(userName, onDone) {
  const modal = $('pw-change-modal');
  const curEl  = $('pwc-cur');
  const newEl  = $('pwc-new');
  const new2El = $('pwc-new2');
  const msgEl  = $('pwc-msg');
  const btn    = $('pwc-btn');
  if (!modal) return;
  modal.style.display = 'flex';
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
  btn.addEventListener('click', submit);
  new2El.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

function setupAuthGate(onSuccess) {
  const idEl   = $('auth-id');
  const passEl = $('auth-pass');
  const btn    = $('auth-btn');
  if (!passEl || !btn) return;
  idEl ? idEl.focus() : passEl.focus();

  async function attempt() {
    btn.disabled = true;
    btn.textContent = '확인 중…';
    showAuthError('');
    const name = idEl?.value.trim() || '';
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
      onSuccess(data.role || 'user');
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
  const hasInviteParam = !!new URLSearchParams(location.search).get('t');
  const inviteDone = await tryInviteLogin((role) => { showApp(); onReady(role); });
  if (inviteDone) return;

  // ?t= 파라미터가 있었는데 실패 → 저장 세션 무시하고 게이트로
  // (삭제된 코드로 접근 시도 차단)
  if (!hasInviteParam) {
    const stored = getStoredToken();
    if (tokenValid(stored)) { showApp(); onReady(tokenRole(stored)); return; }
  } else {
    // URL의 ?t= 제거 후 오류 표시
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

function initSvcTabs(role) {
  const fab = $('chat-fab');
  // 관리자: 항상 표시 (테스트 목적)
  // 일반 사용자: ktl-chat-enabled = 'true' 일 때만 표시
  if (fab) {
    const mode = localStorage.getItem('ktl-chat-mode')
      || (localStorage.getItem('ktl-chat-enabled') === 'true' ? 'active' : 'maintenance');
    fab.hidden = !(mode === 'active' || (mode === 'maintenance' && role === 'admin'));
    document.body.dataset.role = role; // setChatMode에서 FAB 즉시 반영에 사용
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
      if (svc === 'admin' && !adminInited) {
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
  const saved = (() => { try { return localStorage.getItem('ktl-theme'); } catch { return null; } })();
  if (saved) applyTheme(saved);

  $('theme-btn')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
  });

  $('logout-btn')?.addEventListener('click', () => {
    try { localStorage.removeItem('ktl-auth'); } catch { /* 무시 */ }
    location.reload();
  });

  initSvcTabs(role);

  void (async () => {
    renderStatusChip($('status-chip'), 'checking');
    renderStatusChip($('status-chip'), await getDbStatus());
  })();
}

guardAuth((role) => { window.__userRole = role; init(role); });

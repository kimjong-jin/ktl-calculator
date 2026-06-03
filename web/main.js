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
  const t = new URLSearchParams(location.search).get('t');
  if (!t) return false;
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: t }),
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

function setupAuthGate(onSuccess) {
  const idEl   = $('auth-id');
  const passEl = $('auth-pass');
  const btn    = $('auth-btn');
  if (!passEl || !btn) return;
  (idEl || passEl).focus();

  async function attempt() {
    btn.disabled = true;
    btn.textContent = '확인 중…';
    showAuthError('');
    try {
      const body = { password: passEl.value };
      if (idEl && idEl.value.trim()) body.id = idEl.value.trim();
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 500 && import.meta.env.DEV) {
        console.warn('[auth] DEV: 인증 우회');
        onSuccess('user');
        return;
      }
      const data = await res.json();
      if (!res.ok) { showAuthError(data.error || '아이디 또는 비밀번호가 올바르지 않습니다.'); return; }
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
  const inviteDone = await tryInviteLogin((role) => { showApp(); onReady(role); });
  if (inviteDone) return;
  const stored = getStoredToken();
  if (tokenValid(stored)) { showApp(); onReady(tokenRole(stored)); return; }
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
    const enabled = localStorage.getItem('ktl-chat-enabled') === 'true';
    fab.hidden = !(role === 'admin' || enabled);
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

  // 스와이프 다운 닫기 (모바일)
  const panel = $('chat-panel');
  let touchStartY = 0;
  panel?.addEventListener('touchstart', e => {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  panel?.addEventListener('touchend', e => {
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (dy > 80) closeChat(); // 80px 이상 아래로 스와이프하면 닫기
  }, { passive: true });

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

/**
 * 관리자 패널 모듈.
 * initAdmin(token) — 관리자 토큰으로 /api/admin 조회 후 패널 렌더링.
 *
 * 발급된 접속 코드는 localStorage('ktl-issued-tokens')에 저장.
 * 형식: [{ id, token, url, days, createdAt, expiresAt }]
 */

const STORE_KEY = 'ktl-issued-tokens';
const SKILL_KEY = 'ktl-admin-skill';
let adminToken = '';

// ── 관리자 AI 스킬 ──────────────────────────────────────────
function loadSkill() {
  try { return localStorage.getItem(SKILL_KEY) || ''; } catch { return ''; }
}
function saveSkill(text) {
  try { localStorage.setItem(SKILL_KEY, text); } catch {}
}

// ── localStorage 토큰 목록 ──────────────────────────────────
function loadTokenList() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; }
}
function saveTokenList(list) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch {}
}
function addToList(entry) {
  const list = loadTokenList();
  list.unshift(entry); // 최신 순
  saveTokenList(list.slice(0, 50)); // 최대 50개
}
function removeFromList(id) {
  saveTokenList(loadTokenList().filter(t => t.id !== id));
}

function isExpired(expiresAt) {
  return Date.now() > new Date(expiresAt).getTime();
}
function daysLeft(expiresAt) {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / 86400000);
}

// ── 초기화 ──────────────────────────────────────────────────
export async function initAdmin(token) {
  adminToken = token;
  const wrap = document.getElementById('admin-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<p class="admin-loading">관리자 데이터 로드 중…</p>';
  await loadAndRender(wrap);
}

async function loadAndRender(wrap) {
  try {
    const res = await fetch('/api/admin', { headers: { Authorization: `Bearer ${adminToken}` } });
    const data = await res.json();
    if (!res.ok) { wrap.innerHTML = `<p class="error">${data.error || '로드 실패'}</p>`; return; }
    render(wrap, data);
  } catch {
    wrap.innerHTML = '<p class="error">서버에 연결할 수 없습니다.</p>';
  }
}

function chip(ok, labelOk, labelFail) {
  return `<span class="admin-chip ${ok ? 'admin-chip--ok' : 'admin-chip--fail'}">${ok ? labelOk : labelFail}</span>`;
}

function statusBadge(expiresAt) {
  if (isExpired(expiresAt)) {
    return '<span class="admin-chip admin-chip--fail">만료</span>';
  }
  const d = daysLeft(expiresAt);
  if (d <= 2) return `<span class="admin-chip admin-chip--warn">D-${d}</span>`;
  return `<span class="admin-chip admin-chip--ok">유효 D-${d}</span>`;
}

// ── 토큰 목록 HTML ───────────────────────────────────────────
function renderTokenTable() {
  const list = loadTokenList();
  if (!list.length) {
    return '<p class="admin-empty">발급된 접속 코드가 없습니다.</p>';
  }
  const rows = list.map(t => `
    <tr class="token-row${isExpired(t.expiresAt) ? ' token-row--expired' : ''}">
      <td class="token-col--no">${t.no || '–'}</td>
      <td class="token-col--date">${new Date(t.createdAt).toLocaleDateString('ko-KR')}</td>
      <td class="token-col--exp">${new Date(t.expiresAt).toLocaleDateString('ko-KR')}</td>
      <td class="token-col--days">${t.days}일</td>
      <td class="token-col--status">${statusBadge(t.expiresAt)}</td>
      <td class="token-col--code">
        <input class="field__control token-code-input" value="${t.token}" readonly />
      </td>
      <td class="token-col--actions">
        <button class="btn btn--mini" data-copy="${t.id}">복사</button>
        <button class="btn btn--mini btn--danger" data-del="${t.id}">삭제</button>
      </td>
    </tr>`).join('');
  return `
    <table class="token-table">
      <thead>
        <tr>
          <th>#</th><th>발급일</th><th>만료일</th><th>기간</th><th>상태</th>
          <th>접속 코드</th><th>관리</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── 메인 렌더 ────────────────────────────────────────────────
function render(wrap, d) {
  const { db, gemini, skill, access, server, ts } = d;

  wrap.innerHTML = `
    <!-- AI 전문 지식 스킬 -->
    <div class="admin-section admin-section--skill">
      <div class="skill-section-header">
        <div>
          <h3 class="admin-section__title" style="margin:0">AI 전문 지식 스킬</h3>
          <p class="skill-section-desc">이 지식이 AI 법령 해석 답변에 자동으로 반영됩니다. 모든 사용자의 답변 품질이 향상됩니다.</p>
        </div>
        <div class="skill-status-row">
          ${chip(!!(skill && skill.envConfigured), '서버 적용됨', '서버 미적용')}
          <span class="skill-local-badge" id="skill-local-badge">${loadSkill() ? '로컬 스킬 있음' : '로컬 스킬 없음'}</span>
        </div>
      </div>

      ${skill && skill.envConfigured ? `
      <div class="skill-env-info">
        <span class="skill-env-icon">✦</span>
        <div>
          <strong>서버 전문 지식 활성화됨</strong> — ADMIN_SKILL_CONTEXT 환경변수로 설정 (${skill.charCount}자)
          ${skill.preview ? `<div class="skill-env-preview">"${escAdminHtml(skill.preview)}…"</div>` : ''}
        </div>
      </div>` : `
      <div class="skill-env-info skill-env-info--warn">
        <span class="skill-env-icon">⚠</span>
        <div>
          <strong>서버 전문 지식 미설정</strong> — 아래에서 작성 후 Vercel 환경변수 <code>ADMIN_SKILL_CONTEXT</code>에 적용하면 모든 사용자에게 반영됩니다.
        </div>
      </div>`}

      <div class="skill-editor-wrap">
        <div class="skill-editor-header">
          <label class="skill-editor-label" for="skill-textarea">전문 지식 내용 <span class="skill-char-count" id="skill-char-count">${loadSkill().length}자</span></label>
          <div class="skill-editor-actions">
            <button class="btn btn--mini" id="skill-save-btn">로컬 저장</button>
            <button class="btn btn--mini btn--ghost" id="skill-copy-btn" title="Vercel 환경변수에 복사하여 붙여넣기">Vercel 환경변수 복사</button>
            <button class="btn btn--mini btn--danger" id="skill-clear-btn">초기화</button>
          </div>
        </div>
        <textarea id="skill-textarea" class="skill-textarea" placeholder="예시:
■ 수질TMS 현장 경험 (2018~현재)
- pH 전극 교정 시 0.1pH 오차 이상이면 즉시 재교정 필요
- TOC 측정기 NDIR 방식은 고온산화법보다 유지비 낮음
- 반복성 검사 실패 주요 원인: 배관 내 에어포켓, 시약 오염

■ 최신 고시 업데이트 (2025)
- 물환경보전법 시행규칙 개정으로 정도검사 주기 변경...">${loadSkill()}</textarea>
        <p class="skill-hint">
          <strong>로컬 저장</strong>: 이 브라우저(관리자) 세션에서만 AI에 반영됩니다.<br>
          <strong>Vercel 환경변수 복사</strong> → Vercel 대시보드 → Settings → Environment Variables → <code>ADMIN_SKILL_CONTEXT</code>에 붙여넣기하면 모든 사용자에게 영구 반영됩니다.
        </p>
      </div>
    </div>

    <!-- 고객 접속 코드 발급 -->
    <div class="admin-section">
      <h3 class="admin-section__title">고객 접속 코드 발급</h3>
      <div class="admin-issue-bar">
        <label class="admin-days-label">유효기간
          <input id="issue-days" class="field__control admin-days-input" type="number" value="${access.days}" min="1" max="365" />
          <span class="admin-val--dim">일</span>
        </label>
        <input id="issue-label" class="field__control admin-label-input" type="text" placeholder="메모 (선택, 예: 홍길동)" />
        <button class="btn btn--primary" id="issue-btn">+ 새 접속 코드 발급</button>
      </div>
      <div id="issue-result" class="issue-result" hidden>
        <div class="issue-result__label">고객에게 전달할 접속 링크 (클릭 한 번으로 자동 로그인)</div>
        <div class="issue-url-row">
          <input id="issue-url" class="field__control issue-url-input" type="text" readonly />
          <button class="btn btn--mini" id="copy-url-btn">링크 복사</button>
        </div>
        <div class="issue-result__label" style="margin-top:10px">코드만 전달할 경우 (입력란에 붙여넣기)</div>
        <div class="issue-url-row">
          <input id="issue-code" class="field__control issue-url-input" type="text" readonly />
          <button class="btn btn--mini" id="copy-code-btn">코드 복사</button>
        </div>
        <p class="admin-card__sub" id="issue-exp"></p>
      </div>
    </div>

    <!-- 발급된 접속 코드 목록 -->
    <div class="admin-section">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h3 class="admin-section__title" style="margin:0">발급된 접속 코드 목록</h3>
        <button class="btn btn--mini btn--ghost" id="clear-expired-btn">만료 코드 정리</button>
      </div>
      <div id="token-list-wrap">${renderTokenTable()}</div>
    </div>

    <!-- 서비스 상태 -->
    <div class="admin-section">
      <h3 class="admin-section__title">서비스 상태</h3>
      <div class="admin-grid3">
        <div class="admin-card">
          <div class="admin-card__label">DB 연동</div>
          ${chip(db.connected, '정상', '오류')}
          ${db.connected
            ? `<div class="admin-card__sub">${db.fileName} · ${db.itemCount}종</div>`
            : `<div class="admin-card__sub admin-err">${db.error || ''}</div>`}
        </div>
        <div class="admin-card">
          <div class="admin-card__label">AI (Gemini)</div>
          ${chip(gemini.configured, '키 설정됨', '키 미설정')}
          <div class="admin-card__sub">${gemini.configured ? 'GEMINI_API_KEY 등록됨' : 'Vercel 환경변수 필요'}</div>
        </div>
        <div class="admin-card">
          <div class="admin-card__label">인증 설정</div>
          ${chip(access.adminPwSet, '완전', '관리자 비번 없음')}
          <div class="admin-card__sub">관리자 ${access.adminPwSet ? '✓' : '✗'} &nbsp;·&nbsp; 기본 ${access.days}일</div>
        </div>
      </div>
    </div>

    <!-- 시스템 -->
    <div class="admin-section">
      <h3 class="admin-section__title">시스템</h3>
      <div class="admin-grid3">
        <div class="admin-card">
          <div class="admin-card__label">Node.js</div>
          <span class="admin-val">${server.node}</span>
        </div>
        <div class="admin-card">
          <div class="admin-card__label">환경</div>
          <span class="admin-val">${server.env}</span>
        </div>
        <div class="admin-card">
          <div class="admin-card__label">조회 시각</div>
          <span class="admin-val admin-val--sm">${new Date(ts).toLocaleString('ko-KR')}</span>
          <button class="btn btn--mini" id="admin-refresh" style="margin-top:6px">새로고침</button>
        </div>
      </div>
    </div>
  `;

  bindEvents(wrap, access);
}

function bindEvents(wrap, access) {
  // 새로고침
  document.getElementById('admin-refresh')?.addEventListener('click', () => {
    wrap.innerHTML = '<p class="admin-loading">새로고침 중…</p>';
    loadAndRender(wrap);
  });

  // 토큰 발급
  document.getElementById('issue-btn')?.addEventListener('click', () => issueToken(access));

  // 복사 버튼
  makeCopyBtn('copy-url-btn', 'issue-url');
  makeCopyBtn('copy-code-btn', 'issue-code');

  // 만료 코드 정리
  document.getElementById('clear-expired-btn')?.addEventListener('click', () => {
    saveTokenList(loadTokenList().filter(t => !isExpired(t.expiresAt)));
    refreshTokenList();
  });

  // 토큰 목록 이벤트 위임
  document.getElementById('token-list-wrap')?.addEventListener('click', async (e) => {
    const copyId = e.target.dataset.copy;
    const delId  = e.target.dataset.del;
    if (copyId) {
      const t = loadTokenList().find(t => t.id === copyId);
      if (t) {
        try { await navigator.clipboard.writeText(t.token); } catch {}
        const orig = e.target.textContent;
        e.target.textContent = '복사됨';
        setTimeout(() => { e.target.textContent = orig; }, 1500);
      }
    }
    if (delId) {
      if (confirm('이 접속 코드를 목록에서 삭제할까요?')) {
        removeFromList(delId);
        refreshTokenList();
      }
    }
  });

  // AI 스킬 관리
  const skillTA = document.getElementById('skill-textarea');
  const charCount = document.getElementById('skill-char-count');
  const localBadge = document.getElementById('skill-local-badge');

  skillTA?.addEventListener('input', () => {
    if (charCount) charCount.textContent = `${skillTA.value.length}자`;
  });

  document.getElementById('skill-save-btn')?.addEventListener('click', () => {
    const val = skillTA?.value || '';
    saveSkill(val);
    if (localBadge) localBadge.textContent = val ? '로컬 스킬 있음' : '로컬 스킬 없음';
    const btn = document.getElementById('skill-save-btn');
    const orig = btn.textContent;
    btn.textContent = '저장됨 ✓';
    btn.classList.add('btn--success');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('btn--success'); }, 2000);
  });

  document.getElementById('skill-copy-btn')?.addEventListener('click', async () => {
    const val = skillTA?.value || '';
    if (!val) { alert('내용을 먼저 입력하세요.'); return; }
    try {
      await navigator.clipboard.writeText(val);
      const btn = document.getElementById('skill-copy-btn');
      const orig = btn.textContent;
      btn.textContent = '복사됨 ✓';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    } catch { alert('복사 실패. 직접 선택하여 복사하세요.'); }
  });

  document.getElementById('skill-clear-btn')?.addEventListener('click', () => {
    if (!confirm('AI 전문 지식을 모두 초기화할까요?')) return;
    saveSkill('');
    if (skillTA) skillTA.value = '';
    if (charCount) charCount.textContent = '0자';
    if (localBadge) localBadge.textContent = '로컬 스킬 없음';
  });
}

function escAdminHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function refreshTokenList() {
  const wrap = document.getElementById('token-list-wrap');
  if (wrap) wrap.innerHTML = renderTokenTable();
}

// ── 토큰 발급 ────────────────────────────────────────────────
async function issueToken(access) {
  const btn    = document.getElementById('issue-btn');
  const days   = parseInt(document.getElementById('issue-days')?.value || String(access?.days || 10), 10);
  const label  = document.getElementById('issue-label')?.value.trim() || '';
  const result = document.getElementById('issue-result');

  btn.disabled = true;
  btn.textContent = '생성 중…';

  try {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ action: 'generate_token', days }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || '토큰 생성 실패'); return; }

    const origin  = location.origin;
    const url     = `${origin}/?t=${data.inviteToken}`;
    const no      = loadTokenList().length + 1;

    // localStorage 저장
    addToList({
      id:        data.inviteToken.slice(-16),  // 코드 끝 16자 = 고유 식별자
      no,
      token:     data.inviteToken,
      url,
      days,
      label,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(data.exp * 1000).toISOString(),
    });

    // UI 업데이트
    document.getElementById('issue-url').value  = url;
    document.getElementById('issue-code').value = data.inviteToken;
    document.getElementById('issue-exp').textContent =
      `만료: ${new Date(data.exp * 1000).toLocaleDateString('ko-KR')} (${days}일)`;
    result.hidden = false;

    // 목록 갱신
    refreshTokenList();

  } catch {
    alert('서버에 연결할 수 없습니다.');
  } finally {
    btn.disabled = false;
    btn.textContent = '+ 새 접속 코드 발급';
  }
}

function makeCopyBtn(btnId, inputId) {
  document.getElementById(btnId)?.addEventListener('click', async () => {
    const val = document.getElementById(inputId)?.value;
    if (!val) return;
    try {
      await navigator.clipboard.writeText(val);
      const btn = document.getElementById(btnId);
      const orig = btn.textContent;
      btn.textContent = '복사됨 ✓';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    } catch { /* 무시 */ }
  });
}

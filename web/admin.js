/**
 * 관리자 패널 모듈.
 * initAdmin(token) — 관리자 토큰으로 /api/admin 조회 후 패널 렌더링.
 */

let adminToken = '';

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

function render(wrap, d) {
  const { db, gemini, access, server, ts } = d;

  const expiryHtml = access.globalExpiry
    ? `<span class="admin-val">${access.globalExpiry}</span>`
    : `<span class="admin-val admin-val--dim">미설정 (로그인 기준 ${access.days}일)</span>`;

  wrap.innerHTML = `
    <!-- 고객 초대 코드 발급 -->
    <div class="admin-section">
      <h3 class="admin-section__title">고객 접속 코드 발급</h3>
      <div class="admin-issue-bar">
        <label class="admin-days-label">유효기간
          <input id="issue-days" class="field__control admin-days-input" type="number" value="${access.days}" min="1" max="365" />
          <span class="admin-val--dim">일</span>
        </label>
        <button class="btn btn--primary" id="issue-btn">새 접속 코드 발급</button>
      </div>
      <div id="issue-result" class="issue-result" hidden>
        <div class="issue-result__label">고객에게 전달할 접속 링크 (클릭 한 번으로 자동 로그인)</div>
        <div class="issue-url-row">
          <input id="issue-url" class="field__control issue-url-input" type="text" readonly />
          <button class="btn btn--mini" id="copy-url-btn">복사</button>
        </div>
        <div class="issue-result__label" style="margin-top:10px">코드만 전달할 경우 (입력란에 붙여넣기)</div>
        <div class="issue-url-row">
          <input id="issue-code" class="field__control issue-url-input" type="text" readonly />
          <button class="btn btn--mini" id="copy-code-btn">복사</button>
        </div>
        <p class="admin-card__sub" id="issue-exp"></p>
      </div>
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
          <div class="admin-card__sub">관리자 ${access.adminPwSet ? '✓' : '✗'} &nbsp;·&nbsp; 레거시 공용 ${access.userPwSet ? '✓' : '✗'}</div>
        </div>
      </div>
    </div>

    <!-- 접속 정책 -->
    <div class="admin-section">
      <h3 class="admin-section__title">접속 정책</h3>
      <div class="admin-grid2">
        <div class="admin-card">
          <div class="admin-card__label">기본 유효기간</div>
          <span class="admin-val">${access.days}일</span>
          <div class="admin-card__sub">ACCESS_DAYS 환경변수</div>
        </div>
        <div class="admin-card">
          <div class="admin-card__label">전역 만료일</div>
          ${expiryHtml}
          <div class="admin-card__sub">ACCESS_START 환경변수</div>
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

  // 새로고침
  document.getElementById('admin-refresh')?.addEventListener('click', () => {
    wrap.innerHTML = '<p class="admin-loading">새로고침 중…</p>';
    loadAndRender(wrap);
  });

  // 토큰 발급
  document.getElementById('issue-btn')?.addEventListener('click', issueToken);

  // 복사 버튼
  makeCopyBtn('copy-url-btn', 'issue-url');
  makeCopyBtn('copy-code-btn', 'issue-code');
}

async function issueToken() {
  const btn = document.getElementById('issue-btn');
  const days = parseInt(document.getElementById('issue-days')?.value || '10', 10);
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

    const origin = location.origin;
    const url = `${origin}/?t=${data.inviteToken}`;
    document.getElementById('issue-url').value = url;
    document.getElementById('issue-code').value = data.inviteToken;
    document.getElementById('issue-exp').textContent =
      `만료: ${new Date(data.exp * 1000).toLocaleDateString('ko-KR')} (${days}일)`;
    result.hidden = false;
  } catch {
    alert('서버에 연결할 수 없습니다.');
  } finally {
    btn.disabled = false;
    btn.textContent = '새 접속 코드 발급';
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
      btn.textContent = '복사됨';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    } catch { /* 무시 */ }
  });
}

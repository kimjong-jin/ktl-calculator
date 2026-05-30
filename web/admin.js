/**
 * 관리자 패널 모듈.
 * initAdmin(token) — 관리자 토큰으로 /api/admin 조회 후 패널 렌더링.
 */

export async function initAdmin(token) {
  const wrap = document.getElementById('admin-wrap');
  if (!wrap) return;

  wrap.innerHTML = '<p class="admin-loading">관리자 데이터 로드 중…</p>';

  try {
    const res = await fetch('/api/admin', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) {
      wrap.innerHTML = `<p class="error">${data.error || '관리자 데이터 로드 실패'}</p>`;
      return;
    }
    render(wrap, data);
  } catch {
    wrap.innerHTML = '<p class="error">서버에 연결할 수 없습니다.</p>';
  }
}

function chip(ok, labelOk, labelFail) {
  const cls = ok ? 'admin-chip--ok' : 'admin-chip--fail';
  return `<span class="admin-chip ${cls}">${ok ? labelOk : labelFail}</span>`;
}

function render(wrap, d) {
  const { db, gemini, access, server, ts } = d;

  const expiry = access.globalExpiry
    ? `<span class="admin-val">${access.globalExpiry}</span>`
    : `<span class="admin-val admin-val--dim">미설정 (로그인 기준 ${access.days}일)</span>`;

  wrap.innerHTML = `
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
          ${chip(access.userPwSet && access.adminPwSet, '완전', '일부 미설정')}
          <div class="admin-card__sub">
            고객비번 ${access.userPwSet ? '✓' : '✗'} &nbsp;·&nbsp; 관리자비번 ${access.adminPwSet ? '✓' : '✗'}
          </div>
        </div>
      </div>
    </div>

    <!-- 접속 정책 -->
    <div class="admin-section">
      <h3 class="admin-section__title">접속 정책</h3>
      <div class="admin-grid2">
        <div class="admin-card">
          <div class="admin-card__label">고객 유효기간</div>
          <span class="admin-val">${access.days}일</span>
          <div class="admin-card__sub">ACCESS_DAYS 환경변수</div>
        </div>
        <div class="admin-card">
          <div class="admin-card__label">전역 만료일</div>
          ${expiry}
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

  document.getElementById('admin-refresh')?.addEventListener('click', () => {
    // token is captured via closure
    wrap.innerHTML = '<p class="admin-loading">관리자 데이터 로드 중…</p>';
    // re-fetch
    fetch('/api/admin', { headers: { Authorization: `Bearer ${document.body.dataset.adminToken || ''}` } })
      .then(r => r.json())
      .then(data => render(wrap, data))
      .catch(() => { wrap.innerHTML = '<p class="error">새로고침 실패</p>'; });
  });
  // store token for refresh
  document.body.dataset.adminToken = document.body.dataset.adminToken || '';
}

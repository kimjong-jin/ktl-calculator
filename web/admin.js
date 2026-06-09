/**
 * 관리자 패널 모듈.
 * initAdmin(token) — 관리자 토큰으로 /api/admin 조회 후 패널 렌더링.
 */

const STORE_KEY    = 'ktl-issued-tokens';
const SKILLS_KEY   = 'ktl-admin-skills';
const CHAT_KEY     = 'ktl-chat-mode';
const COPIED_KEY   = 'ktl-copied-tokens';  // {tokenId: true} — 복사된 토큰 영구 기록
const TAB_KEY      = 'ktl-admin-tab';      // 마지막 선택 탭
const USER_KEY     = 'ktl-admin-user';     // 현재 접속자 이름
let adminToken = '';
let calcDataReceipts = new Set();

const STAFF_NAMES = ['김종진','권민경','김성대','김수철','정슬기','강준','정진욱'];

function loadCopied() {
  try { return JSON.parse(localStorage.getItem(COPIED_KEY) || '{}'); } catch { return {}; }
}
function markCopied(tokenId) {
  const m = loadCopied();
  m[tokenId] = true;
  try { localStorage.setItem(COPIED_KEY, JSON.stringify(m)); } catch {}
}
function isCopied(tokenId) { return !!loadCopied()[tokenId]; }

function getActiveTab() { return localStorage.getItem(TAB_KEY) || '전체'; }
function setActiveTab(name) { localStorage.setItem(TAB_KEY, name); }

function getAdminUser() { return localStorage.getItem(USER_KEY) || '김종진'; }
function setAdminUser(name) { localStorage.setItem(USER_KEY, name); }

// ── 계산 데이터 관리 ──────────────────────────────────────
async function loadCalcDataList(token) {
  const listEl = document.getElementById('calc-data-list');
  if (!listEl) return;
  try {
    const res = await fetch(`/api/calcData?action=list&token=${encodeURIComponent(token)}`);
    if (!res.ok) {
      listEl.innerHTML = '<p class="admin-card__sub">❌ Mac Studio 연결 실패 (MAC_STUDIO_URL 환경변수 확인)</p>';
      return;
    }
    const data = await res.json();
    if (!data.length) {
      listEl.innerHTML = '<p class="admin-card__sub" style="color:#64748b">저장된 계산 데이터 없음</p>';
      return;
    }
    const tokenList = loadTokenList();
    const rows = data.map(d => {
      const updated = new Date(d.updatedAt).toLocaleString('ko-KR', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
      const expires = new Date(d.expiresAt).toLocaleDateString('ko-KR', {month:'numeric',day:'numeric'});
      const matchedToken = tokenList.find(t => t.receiptNo === d.receiptNo && !isExpired(t.expiresAt));
      const pwBadge = matchedToken?.pw
        ? `<span style="background:#fff;color:#111;font-family:monospace;font-size:13px;font-weight:900;letter-spacing:2px;padding:2px 8px;border-radius:5px;border:2px solid #333">${matchedToken.pw}</span>`
        : '';
      // 상태: 데이터 만료 > 토큰 삭제됨 > 유효
      const statusBadge = d.expired
        ? '<span style="color:#ef4444;font-size:12px;font-weight:600">만료</span>'
        : matchedToken
          ? '<span style="color:#22c55e;font-size:12px;font-weight:600">유효</span>'
          : '<span style="color:#f59e0b;font-size:12px;font-weight:600">무효</span>';
      return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #1e293b;flex-wrap:wrap">
        <span style="font-family:monospace;color:#38bdf8;min-width:160px">${d.receiptNo}</span>
        <span style="color:#94a3b8;min-width:80px">${d.userName}</span>
        ${d.siteName ? `<span style="color:#7dd3fc;font-size:12px;min-width:100px">${d.siteName}</span>` : ''}
        ${pwBadge}
        ${statusBadge}
        <span style="color:#64748b;font-size:12px;flex:1">저장 ${updated} | 만료 ${expires}</span>
        <button class="btn btn--mini" style="background:#dc2626;color:#fff;border:none"
          data-no="${d.receiptNo}" data-user="${d.userName}">삭제</button>
      </div>`;
    }).join('');
    listEl.innerHTML = `<div>${rows}</div>`;
    listEl.querySelectorAll('button[data-no]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const no = btn.dataset.no, user = btn.dataset.user;
        if (!confirm(`[${no}] ${user} 데이터를 삭제하시겠습니까?`)) return;
        const r = await fetch(
          `/api/calcData?receiptNo=${encodeURIComponent(no)}&userName=${encodeURIComponent(user)}&token=${encodeURIComponent(token)}`,
          { method: 'DELETE' }
        );
        if (r.ok) btn.closest('div[style]').remove();
        else alert('삭제 실패');
      });
    });
  } catch (e) {
    listEl.innerHTML = `<p class="admin-card__sub">❌ 오류: ${e.message}</p>`;
  }
}

// ── AI 법령 3단계 모드 ────────────────────────────────────────
function getChatMode() {
  const v = localStorage.getItem(CHAT_KEY);
  if (v === 'active' || v === 'maintenance' || v === 'inactive') return v;
  // 구 버전 마이그레이션 (ktl-chat-enabled)
  return localStorage.getItem('ktl-chat-enabled') === 'true' ? 'active' : 'maintenance';
}
function setChatMode(mode) {
  localStorage.setItem(CHAT_KEY, mode);
  // 즉시 FAB 반영 (role 확인)
  const role = document.body.dataset.role || 'user';
  const fab = document.getElementById('chat-fab');
  if (fab) {
    fab.hidden = !(mode === 'active' || (mode === 'maintenance' && role === 'admin'));
  }
}

// ── 스킬 라이브러리 ─────────────────────────────────────────
function loadSkills() {
  try { return JSON.parse(localStorage.getItem(SKILLS_KEY) || '[]'); } catch { return []; }
}
function saveSkills(list) {
  try { localStorage.setItem(SKILLS_KEY, JSON.stringify(list)); } catch {}
}
function genId() {
  return 'sk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function activeSkillText() {
  return loadSkills()
    .filter(s => s.active)
    .map(s => `[스킬: ${s.title} — 작성: ${s.author}]\n${s.content}`)
    .join('\n\n---\n\n');
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
  list.unshift(entry);
  saveTokenList(list.slice(0, 50));
}
function removeFromList(id) {
  saveTokenList(loadTokenList().filter(t => t.id !== id));
}
function isExpired(expiresAt) { return Date.now() > new Date(expiresAt).getTime(); }
function daysLeft(expiresAt) {
  const diff = new Date(expiresAt).getTime() - Date.now();
  return diff <= 0 ? 0 : Math.ceil(diff / 86400000);
}

// ── 초기화 ──────────────────────────────────────────────────
export async function initAdmin(token) {
  adminToken = token;
  // 만료된 토큰 localStorage에서 자동 정리
  saveTokenList(loadTokenList().filter(t => !isExpired(t.expiresAt)));

  // Blob에서 전체 토큰 목록 동기화 (parser.work 발급 토큰 포함)
  try {
    const res = await fetch('/api/admin?action=list_tokens', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const { tokens } = await res.json();
      const now = Math.floor(Date.now() / 1000);
      const local = loadTokenList();
      const localIds = new Set(local.map(t => t.id || t.token?.split('.')[0]));
      // Blob에만 있는 토큰(parser.work 발급)을 localStorage에 추가
      let changed = false;
      Object.entries(tokens).forEach(([tokenId, e]) => {
        if (e.exp <= now) return; // 만료 제외
        const issuedMs = e.issuedAt ? e.issuedAt * 1000 : Date.now();
        const createdAt = new Date(issuedMs).toISOString();
        const days = Math.round((e.exp * 1000 - issuedMs) / 86400000);
        // id 직접 일치 OR token payload 부분 일치 OR pw 일치 (id 불일치 fallback)
        const existing = local.find(t =>
          t.id === tokenId ||
          t.token?.split('.')[0] === tokenId ||
          (e.pw && t.pw === e.pw)
        );
        if (existing) {
          // id를 Blob tokenId로 통일 (다음 sync부터 정확히 매칭되도록)
          if (existing.id !== tokenId) { existing.id = tokenId; changed = true; }
          if (!existing.pw && e.pw)               { existing.pw = e.pw;               changed = true; }
          if (!existing.receiptNo && e.receiptNo) { existing.receiptNo = e.receiptNo; changed = true; }
          if (!existing.siteName && e.siteName)   { existing.siteName  = e.siteName;  changed = true; }
          if (!existing.applicantName && e.applicantName) { existing.applicantName = e.applicantName; changed = true; }
          if (!existing.label && e.label)         { existing.label = e.label; changed = true; }
          if (!existing.createdAt) { existing.createdAt = createdAt; existing.days = days; changed = true; }
          return;
        }
        local.unshift({
          id: tokenId,
          token: tokenId,
          label: e.label || '',
          pw: e.pw || '',
          issuedAt: createdAt,
          createdAt,
          expiresAt: new Date(e.exp * 1000).toISOString(),
          days,
          receiptNo: e.receiptNo || '',
          siteName: e.siteName || '',
          applicantName: e.applicantName || '',
          no: local.length + 1,
        });
        changed = true;
      });
      // pw 중복 제거 — 동일 pw 항목 중 id가 Blob tokenId인 것(최신)만 유지
      const pwSeen = new Set();
      const deduped = local.filter(t => {
        if (!t.pw) return true;
        if (pwSeen.has(t.pw)) { changed = true; return false; }
        pwSeen.add(t.pw);
        return true;
      });
      if (changed) saveTokenList(deduped);
    }
  } catch (e) {
    console.warn('[admin] Blob 토큰 동기화 실패:', e);
  }

  // calc 데이터 receiptNo 목록 캐시 (미사용 코드 표시용)
  try {
    const r = await fetch(`/api/calcData?action=list&token=${encodeURIComponent(token)}`);
    if (r.ok) {
      const list = await r.json();
      calcDataReceipts = new Set(list.map(d => d.receiptNo).filter(Boolean));
    }
  } catch {}

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
  if (isExpired(expiresAt)) return '<span class="admin-chip admin-chip--fail">만료</span>';
  const d = daysLeft(expiresAt);
  if (d <= 2) return `<span class="admin-chip admin-chip--warn">D-${d}</span>`;
  return `<span class="admin-chip admin-chip--ok">유효 D-${d}</span>`;
}

/** 초대 토큰 문자열에서 hex16 userId 추출 */
function decodeTokenUserId(inviteToken) {
  try {
    const payload = inviteToken.split('.')[0];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json).id || null;
  } catch { return null; }
}

// ── 담당자 탭 HTML ──────────────────────────────────────────
function renderStaffTabs() {
  const user = getAdminUser();
  const fullAdmin = user === '김종진';
  if (!fullAdmin) setActiveTab(user);
  let active = getActiveTab();
  // '전체' 탭 없음 — 김종진 탭이 전체 역할
  if (fullAdmin && (active === '전체' || !STAFF_NAMES.includes(active))) {
    active = '김종진';
    setActiveTab('김종진');
  }
  const tabs = fullAdmin ? STAFF_NAMES : [user];
  const tabsHtml = tabs.map(name => {
    const isActive = name === active;
    // 김종진 탭 = 전체 카운트
    const count = (fullAdmin && name === '김종진')
      ? loadTokenList().length
      : loadTokenList().filter(t => t.label === name).length;
    return `<button class="staff-tab${isActive ? ' staff-tab--active' : ''}" data-tab="${name}">
      ${name}${count ? ` <span class="staff-tab__count">${count}</span>` : ''}
    </button>`;
  }).join('');
  const userOpts = STAFF_NAMES.map(n =>
    `<option value="${n}"${n === user ? ' selected' : ''}>${n}</option>`).join('');
  return `<div id="staff-tabs-wrap">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <span style="font-size:12px;color:#94a3b8">접속자</span>
      <select id="admin-user-select" class="field__control" style="width:auto;padding:3px 10px;font-size:13px;display:inline-block">${userOpts}</select>
    </div>
    <div class="staff-tabs" id="staff-tabs">${tabsHtml}</div>
  </div>`;
}

// ── 토큰 목록 HTML ───────────────────────────────────────────
function renderTokenTable(chatLimits, chatUsage) {
  const user = getAdminUser();
  const activeTab = user === '김종진' ? getActiveTab() : user;
  const allList = loadTokenList();
  // 김종진 탭 = 전체 보기
  const list = (user === '김종진' && activeTab === '김종진') ? allList : allList.filter(t => t.label === activeTab);
  const defaultLimit = chatLimits?.default ?? 50;
  const today = new Date().toISOString().slice(0, 10);

  const tableHtml = !list.length
    ? `<p class="admin-empty">${activeTab === '전체' ? '발급된 접속 코드가 없습니다.' : `${activeTab} 님에게 발급된 코드가 없습니다.`}</p>`
    : `<table class="token-table">
      <thead><tr><th>#</th><th>이름</th><th>비밀번호</th><th>발급일</th><th>만료일</th><th>기간</th><th>상태</th><th>챗봇 한도</th><th>관리</th></tr></thead>
      <tbody>${list.map(t => {
        const userId = decodeTokenUserId(t.token);
        const usage  = userId ? (chatUsage?.[userId]) : null;
        const todayCount = (usage?.date === today) ? usage.count : 0;
        const limit  = userId ? (chatLimits?.keys?.[userId] ?? defaultLimit) : defaultLimit;
        const copied = isCopied(t.id);
        const rowClass = isExpired(t.expiresAt) ? ' token-row--expired' : copied ? ' token-row--copied' : '';
        return `
        <tr class="token-row${rowClass}">
          <td class="token-col--no">${t.no || '–'}</td>
          <td class="token-col--label">
            <div style="color:#38bdf8;font-weight:600">${t.label || '–'}</div>
            ${t.applicantName ? `<div style="font-size:11px;color:#94a3b8">${t.applicantName}</div>` : ''}
            ${t.siteName ? `<div style="font-size:11px;color:#64748b">${t.siteName}</div>` : ''}
            ${t.receiptNo ? `<div style="font-size:11px;color:#475569;font-family:monospace">${t.receiptNo}</div>` : ''}
            ${t.receiptNo && !calcDataReceipts.has(t.receiptNo) ? `<div style="font-size:11px;color:#f59e0b;font-weight:600">미사용</div>` : ''}
          </td>
          <td class="token-col--pw">
            ${t.pw
              ? `<span style="display:inline-block;background:#fff;color:#111;font-family:monospace;font-size:15px;font-weight:900;letter-spacing:3px;padding:3px 10px;border-radius:6px;border:2px solid #333">${t.pw}</span>
                 <button class="btn btn--mini" data-copy-pw="${t.pw}" style="margin-left:6px;font-size:11px;background:#0ea5e9;color:#fff;border:none">복사</button>`
              : '<span style="color:#475569;font-size:11px">–</span>'}
          </td>
          <td class="token-col--date">${new Date(t.createdAt).toLocaleDateString('ko-KR')}</td>
          <td class="token-col--exp">${new Date(t.expiresAt).toLocaleDateString('ko-KR')}</td>
          <td class="token-col--days">${t.days}일</td>
          <td class="token-col--status">${statusBadge(t.expiresAt)}</td>
          <td class="token-col--chat" style="white-space:nowrap">
            ${userId
              ? `<span style="font-size:12px;color:#64748b">오늘 ${todayCount}회</span>
                 <input class="field__control" type="number" min="0" max="9999" value="${limit}"
                   style="width:64px;margin-left:6px;padding:2px 6px;font-size:13px"
                   data-limit-uid="${userId}" title="일일 한도 설정 후 Enter" />
                 <button class="btn btn--mini btn--ghost" data-reset-uid="${userId}" title="오늘 사용량 초기화" style="margin-left:4px">↺</button>`
              : `<span style="font-size:12px;color:#94a3b8">–</span>`}
          </td>
          <td class="token-col--actions">
            <button class="btn btn--mini${copied ? ' btn--copied' : ''}" data-copy="${t.id}">${copied ? '복사됨 ✓' : '복사'}</button>
            <button class="btn btn--mini btn--danger" data-del="${t.id}">삭제</button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;

  return `
    <div style="margin-bottom:10px;display:flex;align-items:center;gap:12px">
      <span style="font-size:13px;color:#94a3b8">기본 일일 한도</span>
      <input class="field__control" type="number" min="0" max="9999" value="${defaultLimit}"
        id="default-limit-input" style="width:80px;padding:4px 8px;font-size:13px" />
      <button class="btn btn--mini" id="default-limit-save">저장</button>
    </div>
    <div class="token-table-wrap">${tableHtml}</div>`;
}

// ── 스킬 라이브러리 렌더 ────────────────────────────────────
function renderSkillLibrary(query = '') {
  const skills = loadSkills();
  const q = query.toLowerCase().trim();
  const filtered = q
    ? skills.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.author.toLowerCase().includes(q) ||
        s.content.toLowerCase().includes(q))
    : skills;
  const activeCount = skills.filter(s => s.active).length;

  if (!filtered.length) {
    return `<div class="skill-empty">${q ? `"${escH(q)}"에 해당하는 스킬이 없습니다.` : '등록된 스킬이 없습니다. + 새 스킬로 추가하세요.'}</div>`;
  }

  return filtered.map(s => `
    <div class="skill-card${s.active ? ' skill-card--active' : ''}" data-skill-id="${s.id}">
      <div class="skill-card__top">
        <div class="skill-card__meta">
          <span class="skill-card__title">${escH(s.title)}</span>
          <span class="skill-card__author">✍ ${escH(s.author)}</span>
          <span class="skill-card__date">${new Date(s.createdAt).toLocaleDateString('ko-KR')}</span>
          ${s.updatedAt !== s.createdAt ? `<span class="skill-card__date">(수정됨)</span>` : ''}
        </div>
        <div class="skill-card__actions">
          <label class="skill-toggle" title="${s.active ? 'AI에 반영 중 — 클릭하면 비활성' : '클릭하면 AI에 반영'}">
            <input type="checkbox" class="skill-toggle__input" data-toggle="${s.id}" ${s.active ? 'checked' : ''} />
            <span class="skill-toggle__track"></span>
            <span class="skill-toggle__label">${s.active ? '활성' : '비활성'}</span>
          </label>
          <button class="btn btn--mini" data-edit="${s.id}">편집</button>
          <button class="btn btn--mini btn--danger" data-del-skill="${s.id}">삭제</button>
        </div>
      </div>
      <div class="skill-card__preview">${escH(s.content.slice(0, 120))}${s.content.length > 120 ? '…' : ''}</div>
    </div>`).join('');
}

// ── 스킬 섹션 HTML 생성 ─────────────────────────────────────
function skillSectionHTML(serverSkill) {
  const skills = loadSkills();
  const activeCount = skills.filter(s => s.active).length;
  return `
    <div class="admin-section admin-section--skill" id="skill-section">
      <!-- 헤더 -->
      <div class="skill-lib-header">
        <div class="skill-lib-title-group">
          <h3 class="admin-section__title" style="margin:0">AI 전문 지식 스킬</h3>
          <p class="skill-section-desc">등록된 스킬이 AI 법령 해석 답변에 자동으로 반영됩니다.</p>
        </div>
        <div class="skill-lib-badges">
          ${chip(!!(serverSkill && serverSkill.envConfigured), '서버 적용됨', '서버 미적용')}
          <span class="skill-count-badge" id="skill-count-badge">활성 ${activeCount}개 / 총 ${skills.length}개</span>
        </div>
      </div>

      <!-- 서버 상태 -->
      ${serverSkill && serverSkill.envConfigured ? `
      <div class="skill-env-info">
        <span class="skill-env-icon">✦</span>
        <div>서버에 전문 지식 설정됨 (${serverSkill.charCount}자)
          ${serverSkill.preview ? `<div class="skill-env-preview">"${escH(serverSkill.preview)}…"</div>` : ''}
        </div>
      </div>` : `
      <div class="skill-env-info skill-env-info--warn">
        <span class="skill-env-icon">⚠</span>
        <div><strong>서버 미설정</strong> — 활성 스킬을 "서버 내보내기"로 복사 후 Vercel 환경변수 <code>ADMIN_SKILL_CONTEXT</code>에 붙여넣으세요.</div>
      </div>`}

      <!-- 툴바 -->
      <div class="skill-toolbar">
        <div class="skill-search-wrap">
          <input id="skill-search" class="skill-search" type="search" placeholder="제목·작성자·내용 검색…" autocomplete="off" />
        </div>
        <div class="skill-toolbar__actions">
          <button class="btn btn--primary btn--mini" id="skill-add-btn">+ 새 스킬</button>
          <button class="btn btn--mini btn--ghost" id="skill-export-btn" title="활성 스킬을 Vercel 환경변수용으로 복사">서버 내보내기</button>
        </div>
      </div>

      <!-- 인라인 추가/편집 폼 -->
      <div id="skill-form-wrap" hidden>
        <div class="skill-form">
          <div class="skill-form__row2">
            <input id="skill-form-title" class="field__control" placeholder="스킬 제목 *" maxlength="60" />
            <input id="skill-form-author" class="field__control" placeholder="작성자 이름 *" maxlength="30" />
          </div>
          <textarea id="skill-form-content" class="skill-textarea" placeholder="전문 지식 내용을 자유롭게 입력하세요.
예:
■ 수질TMS 현장 경험 (2020~)
- pH 전극 교정 주기: 매월 1회 권장
- 반복성 실패 주요 원인: 배관 에어포켓, 시약 오염
■ 최신 고시 메모
- 2025년 물환경보전법 시행규칙 개정 — 정도검사 제출 기한 30일→14일"></textarea>
          <div class="skill-form__footer">
            <span class="skill-char-count" id="skill-form-chars">0자</span>
            <div class="skill-form__btns">
              <button class="btn btn--primary btn--mini" id="skill-form-save">저장</button>
              <button class="btn btn--mini btn--ghost" id="skill-form-cancel">취소</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 스킬 목록 -->
      <div id="skill-list">${renderSkillLibrary()}</div>
    </div>`;
}

// ── AI 법령 기능 잠금/해제 섹션 ──────────────────────────────
function chatToggleSectionHTML() {
  const mode = getChatMode();
  const modeDesc = {
    active:      '🟢 <strong>활성</strong> — 모든 사용자에게 AI 법령 버튼이 표시됩니다.',
    maintenance: '🔧 <strong>관리</strong> — 관리자만 접근 가능. 유지관리·테스트 중.',
    inactive:    '⛔ <strong>비활성</strong> — 전체 비활성화. 버튼이 모두에게 숨겨집니다.',
  };
  const btnStyle = (m) => m === mode
    ? 'padding:8px 18px;border-radius:8px;font-weight:700;cursor:pointer;border:2px solid transparent;' +
      (m === 'active' ? 'background:#22c55e;color:#fff;border-color:#16a34a;'
      : m === 'maintenance' ? 'background:#f59e0b;color:#fff;border-color:#d97706;'
      : 'background:#ef4444;color:#fff;border-color:#dc2626;')
    : 'padding:8px 18px;border-radius:8px;font-weight:600;cursor:pointer;background:#334155;color:#94a3b8;border:2px solid #475569;';
  return `
    <div class="admin-section" id="chat-toggle-section">
      <h3 class="admin-section__title" style="margin:0 0 8px">AI 법령 기능</h3>
      <p class="admin-card__sub" style="margin:0 0 14px" id="chat-mode-desc">${modeDesc[mode]}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="chat-mode-active"      style="${btnStyle('active')}"      data-mode="active">🟢 활성</button>
        <button id="chat-mode-maintenance" style="${btnStyle('maintenance')}" data-mode="maintenance">🔧 관리</button>
        <button id="chat-mode-inactive"    style="${btnStyle('inactive')}"    data-mode="inactive">⛔ 비활성</button>
      </div>
    </div>`;
}

function render(wrap, d) {
  const { db, gemini, skill, access, chatLimits, chatUsage, server, ts } = d;

  wrap.innerHTML = `
    ${chatToggleSectionHTML()}
    ${skillSectionHTML(skill)}


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
        <div class="issue-result__label" style="font-size:13px;color:#94a3b8">비밀번호</div>
        <div class="issue-url-row">
          <input id="issue-pw" class="field__control issue-url-input" type="text" readonly
            style="font-size:24px;font-weight:900;letter-spacing:6px;color:#111;background:#fff;border:2px solid #333;text-align:center;max-width:200px" />
          <button class="btn btn--mini" id="copy-pw-btn" style="background:#0ea5e9;color:#fff">비밀번호 복사</button>
        </div>
        <div class="issue-result__label" style="margin-top:14px;font-size:13px;color:#94a3b8">고객 접속 링크 (버튼 하나로 전달)</div>
        <div class="issue-url-row">
          <input id="issue-short-url" class="field__control issue-url-input" type="text" readonly />
          <button class="btn btn--primary" id="copy-short-url-btn" style="white-space:nowrap">🔗 링크 복사</button>
        </div>
        <details style="margin-top:10px">
          <summary style="font-size:12px;color:#64748b;cursor:pointer">긴 접속 코드 / 전체 URL 보기</summary>
          <div style="margin-top:8px">
            <div class="issue-url-row">
              <input id="issue-url" class="field__control issue-url-input" type="text" readonly />
              <button class="btn btn--mini" id="copy-url-btn">전체 URL</button>
            </div>
            <div class="issue-url-row" style="margin-top:6px">
              <input id="issue-code" class="field__control issue-url-input" type="text" readonly />
              <button class="btn btn--mini" id="copy-code-btn">코드만</button>
            </div>
          </div>
        </details>
        <p class="admin-card__sub" id="issue-exp"></p>
      </div>
    </div>

    <!-- 발급된 접속 코드 목록 -->
    <div class="admin-section">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h3 class="admin-section__title" style="margin:0">발급된 접속 코드 목록</h3>
        <button class="btn btn--mini btn--ghost" id="clear-expired-btn">만료 코드 정리</button>
        <button class="btn btn--mini btn--ghost" id="dedup-btn">중복 정리</button>
        <button class="btn btn--mini btn--danger" id="clear-all-btn">전체 삭제</button>
      </div>
      ${renderStaffTabs()}
      <div id="token-list-wrap">${renderTokenTable(chatLimits, chatUsage)}</div>
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

// ── 이벤트 바인딩 ────────────────────────────────────────────
function bindEvents(wrap, access) {
  // AI 법령 3단계 모드 버튼
  const modeDesc = {
    active:      '🟢 <strong>활성</strong> — 모든 사용자에게 AI 법령 버튼이 표시됩니다.',
    maintenance: '🔧 <strong>관리</strong> — 관리자만 접근 가능. 유지관리·테스트 중.',
    inactive:    '⛔ <strong>비활성</strong> — 전체 비활성화. 버튼이 모두에게 숨겨집니다.',
  };
  ['active', 'maintenance', 'inactive'].forEach(m => {
    document.getElementById(`chat-mode-${m}`)?.addEventListener('click', () => {
      setChatMode(m);
      // 설명 갱신
      const desc = document.getElementById('chat-mode-desc');
      if (desc) desc.innerHTML = modeDesc[m];
      // 버튼 스타일 갱신
      ['active', 'maintenance', 'inactive'].forEach(btn => {
        const el = document.getElementById(`chat-mode-${btn}`);
        if (!el) return;
        if (btn === m) {
          el.style.cssText = 'padding:8px 18px;border-radius:8px;font-weight:700;cursor:pointer;border:2px solid transparent;' +
            (btn === 'active' ? 'background:#22c55e;color:#fff;border-color:#16a34a;'
            : btn === 'maintenance' ? 'background:#f59e0b;color:#fff;border-color:#d97706;'
            : 'background:#ef4444;color:#fff;border-color:#dc2626;');
        } else {
          el.style.cssText = 'padding:8px 18px;border-radius:8px;font-weight:600;cursor:pointer;background:#334155;color:#94a3b8;border:2px solid #475569;';
        }
      });
    });
  });

  // 계산 데이터 목록 로드


  // 새로고침
  document.getElementById('admin-refresh')?.addEventListener('click', () => {
    wrap.innerHTML = '<p class="admin-loading">새로고침 중…</p>';
    loadAndRender(wrap);
  });

  // 담당자 탭 클릭
  document.getElementById('staff-tabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]')?.dataset.tab;
    if (!tab) return;
    setActiveTab(tab);
    // 탭 이름으로 라벨 자동 설정
    const labelInput = document.getElementById('issue-label');
    if (labelInput) labelInput.value = tab;
    refreshTokenList();
  });

  // 접속자 변경
  document.getElementById('admin-user-select')?.addEventListener('change', (e) => {
    setAdminUser(e.target.value);
    const labelInput = document.getElementById('issue-label');
    if (labelInput) labelInput.value = e.target.value === '김종진' ? '' : e.target.value;
    refreshTokenList();
  });

  // 발급 라벨 초기값을 현재 활성 탭으로 설정
  const labelInput = document.getElementById('issue-label');
  if (labelInput) {
    const activeTab = getActiveTab();
    labelInput.value = STAFF_NAMES.includes(activeTab) ? activeTab : getAdminUser();
  }

  // 토큰 발급
  document.getElementById('issue-btn')?.addEventListener('click', () => issueToken(access));
  makeCopyBtn('copy-pw-btn', 'issue-pw');
  makeCopyBtn('copy-short-url-btn', 'issue-short-url');
  makeCopyBtn('copy-url-btn', 'issue-url');
  makeCopyBtn('copy-code-btn', 'issue-code');
  document.getElementById('clear-expired-btn')?.addEventListener('click', () => {
    saveTokenList(loadTokenList().filter(t => !isExpired(t.expiresAt)));
    refreshTokenList();
  });
  document.getElementById('clear-all-btn')?.addEventListener('click', async () => {
    if (!confirm('발급된 접속 코드를 전체 삭제하시겠습니까?\n모든 고객의 접속이 즉시 차단됩니다.')) return;
    const btn = document.getElementById('clear-all-btn');
    btn.textContent = '삭제 중…'; btn.disabled = true;
    try {
      await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ action: 'revoke_all' }),
      });
    } catch {}
    saveTokenList([]);
    refreshTokenList();
    btn.textContent = '전체 삭제'; btn.disabled = false;
  });
  document.getElementById('dedup-btn')?.addEventListener('click', async () => {
    const list = loadTokenList();
    const byReceipt = {};
    for (const t of list) {
      if (!t.receiptNo) continue;
      if (!byReceipt[t.receiptNo]) byReceipt[t.receiptNo] = [];
      byReceipt[t.receiptNo].push(t);
    }
    const toRevoke = [];
    for (const group of Object.values(byReceipt)) {
      if (group.length <= 1) continue;
      group.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      toRevoke.push(...group.slice(1));
    }
    if (!toRevoke.length) { alert('중복 코드 없음'); return; }
    if (!confirm(`동일 접수번호 중복 코드 ${toRevoke.length}개를 삭제하시겠습니까?\n(각 접수번호의 가장 최신 코드만 남깁니다)`)) return;
    const ids = new Set(toRevoke.map(t => t.id));
    saveTokenList(list.filter(t => !ids.has(t.id)));
    for (const t of toRevoke) {
      const tokenKey = (t.token || t.id || '').split('.')[0];
      if (tokenKey) {
        fetch('/api/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ action: 'revoke_token', tokenId: tokenKey }),
        }).catch(() => {});
      }
    }
    refreshTokenList();
    const btn = document.getElementById('dedup-btn');
    if (btn) { btn.textContent = `${toRevoke.length}개 정리됨 ✓`; setTimeout(() => { btn.textContent = '중복 정리'; }, 2500); }
  });
  document.getElementById('token-list-wrap')?.addEventListener('click', async (e) => {
    const copyId    = e.target.dataset.copy;
    const copyPw    = e.target.dataset.copyPw;
    const delId     = e.target.dataset.del;
    const resetUid  = e.target.dataset.resetUid;
    if (copyPw) {
      try { await navigator.clipboard.writeText(copyPw); } catch {}
      const orig = e.target.textContent;
      e.target.textContent = '복사됨 ✓';
      setTimeout(() => { e.target.textContent = orig; }, 1500);
    }
    if (copyId) {
      const t = loadTokenList().find(t => t.id === copyId);
      if (t) {
        const origin = location.origin;
        const url = `${origin}/?t=${t.token}`;
        try { await navigator.clipboard.writeText(url); } catch {}
        markCopied(t.id);
        refreshTokenList();
      }
    }
    if (delId && confirm('이 접속 코드를 삭제할까요?\n삭제하면 해당 고객은 즉시 접속이 차단됩니다.')) {
      const entry = loadTokenList().find(t => t.id === delId);
      const delBtn = e.target;
      delBtn.textContent = '삭제 중…';
      delBtn.disabled = true;
      // Blob revoke 먼저 완료 후 localStorage 제거 (순서 역전 방지)
      const tokenKey = entry?.id || entry?.token?.split('.')[0] || '';
      if (tokenKey) {
        try {
          await fetch('/api/admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
            body: JSON.stringify({ action: 'revoke_token', tokenId: tokenKey }),
          });
        } catch {}
      }
      removeFromList(delId);
      refreshTokenList();
    }
    // 오늘 사용량 초기화
    if (resetUid && confirm('오늘 사용량을 초기화할까요?')) {
      await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ action: 'reset_chat_usage', userId: resetUid }),
      }).catch(() => {});
      loadAndRender(document.getElementById('admin-wrap'));
    }
  });

  // 한도 입력 — Enter 또는 blur 시 저장
  document.getElementById('token-list-wrap')?.addEventListener('change', async (e) => {
    const uid = e.target.dataset.limitUid;
    if (!uid) return;
    const limit = parseInt(e.target.value, 10);
    if (!Number.isFinite(limit) || limit < 0) return;
    await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ action: 'set_chat_limit', userId: uid, limit }),
    }).catch(() => {});
  });

  // 기본 한도 저장
  document.getElementById('default-limit-save')?.addEventListener('click', async () => {
    const val = parseInt(document.getElementById('default-limit-input')?.value || '', 10);
    if (!Number.isFinite(val) || val < 0) return;
    await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ action: 'set_chat_limit', userId: 'default', limit: val }),
    }).catch(() => {});
    const btn = document.getElementById('default-limit-save');
    if (btn) { btn.textContent = '저장됨'; setTimeout(() => { btn.textContent = '저장'; }, 1500); }
  });

  // ── 스킬 라이브러리 이벤트 ──────────────────────────────────
  let editingId = null;

  // 검색
  document.getElementById('skill-search')?.addEventListener('input', (e) => {
    refreshSkillList(e.target.value);
  });

  // + 새 스킬 버튼
  document.getElementById('skill-add-btn')?.addEventListener('click', () => {
    editingId = null;
    openForm(null);
  });

  // 폼 취소
  document.getElementById('skill-form-cancel')?.addEventListener('click', closeForm);

  // 폼 저장
  document.getElementById('skill-form-save')?.addEventListener('click', () => {
    const title   = document.getElementById('skill-form-title')?.value.trim();
    const author  = document.getElementById('skill-form-author')?.value.trim();
    const content = document.getElementById('skill-form-content')?.value.trim();
    if (!title || !author) { alert('제목과 작성자 이름을 입력하세요.'); return; }
    if (!content) { alert('전문 지식 내용을 입력하세요.'); return; }

    const skills = loadSkills();
    const now = new Date().toISOString();
    if (editingId) {
      const idx = skills.findIndex(s => s.id === editingId);
      if (idx >= 0) skills[idx] = { ...skills[idx], title, author, content, updatedAt: now };
    } else {
      skills.unshift({ id: genId(), title, author, content, active: true, createdAt: now, updatedAt: now });
    }
    saveSkills(skills);
    updateCountBadge();
    closeForm();
    refreshSkillList(document.getElementById('skill-search')?.value || '');
  });

  // 폼 글자 수
  document.getElementById('skill-form-content')?.addEventListener('input', (e) => {
    const el = document.getElementById('skill-form-chars');
    if (el) el.textContent = `${e.target.value.length}자`;
  });

  // 스킬 목록 이벤트 위임
  document.getElementById('skill-list')?.addEventListener('click', (e) => {
    const editId    = e.target.dataset.edit;
    const delSkill  = e.target.dataset.delSkill;
    if (editId) {
      editingId = editId;
      const skills = loadSkills();
      openForm(skills.find(s => s.id === editId) || null);
    }
    if (delSkill && confirm('이 스킬을 삭제할까요?')) {
      saveSkills(loadSkills().filter(s => s.id !== delSkill));
      updateCountBadge();
      refreshSkillList(document.getElementById('skill-search')?.value || '');
    }
  });

  // 토글 (활성/비활성)
  document.getElementById('skill-list')?.addEventListener('change', (e) => {
    const toggleId = e.target.dataset.toggle;
    if (!toggleId) return;
    const skills = loadSkills();
    const s = skills.find(s => s.id === toggleId);
    if (s) {
      s.active = e.target.checked;
      saveSkills(skills);
      updateCountBadge();
      // 토글 라벨만 업데이트
      const label = e.target.closest('.skill-toggle')?.querySelector('.skill-toggle__label');
      if (label) label.textContent = s.active ? '활성' : '비활성';
      e.target.closest('.skill-card')?.classList.toggle('skill-card--active', s.active);
    }
  });

  // 서버 내보내기 (활성 스킬 → 클립보드)
  document.getElementById('skill-export-btn')?.addEventListener('click', async () => {
    const text = activeSkillText();
    if (!text) { alert('활성화된 스킬이 없습니다.'); return; }
    try {
      await navigator.clipboard.writeText(text);
      const btn = document.getElementById('skill-export-btn');
      const orig = btn.textContent;
      btn.textContent = '복사됨 ✓';
      setTimeout(() => { btn.textContent = orig; }, 2500);
      alert(`활성 스킬 ${loadSkills().filter(s => s.active).length}개가 클립보드에 복사됐습니다.\nVercel 대시보드 → Settings → Environment Variables → ADMIN_SKILL_CONTEXT에 붙여넣기하세요.`);
    } catch { alert('복사 실패. 직접 복사하세요.'); }
  });
}

function openForm(skill) {
  const wrap = document.getElementById('skill-form-wrap');
  if (!wrap) return;
  document.getElementById('skill-form-title').value   = skill?.title   || '';
  document.getElementById('skill-form-author').value  = skill?.author  || '';
  document.getElementById('skill-form-content').value = skill?.content || '';
  document.getElementById('skill-form-chars').textContent = `${(skill?.content || '').length}자`;
  document.getElementById('skill-form-save').textContent = skill ? '수정 저장' : '저장';
  wrap.hidden = false;
  document.getElementById('skill-form-title').focus();
}
function closeForm() {
  const wrap = document.getElementById('skill-form-wrap');
  if (wrap) wrap.hidden = true;
}
function refreshSkillList(query = '') {
  const el = document.getElementById('skill-list');
  if (el) el.innerHTML = renderSkillLibrary(query);
}
function updateCountBadge() {
  const skills = loadSkills();
  const el = document.getElementById('skill-count-badge');
  if (el) el.textContent = `활성 ${skills.filter(s => s.active).length}개 / 총 ${skills.length}개`;
}
function refreshTokenList() {
  const user = getAdminUser();
  const fullAdmin = user === '김종진';
  if (!fullAdmin) setActiveTab(user);
  let active = getActiveTab();
  if (fullAdmin && (active === '전체' || !STAFF_NAMES.includes(active))) {
    active = '김종진';
    setActiveTab('김종진');
  }
  const tabs = fullAdmin ? STAFF_NAMES : [user];

  // 탭 버튼만 갱신 (컨테이너 유지 → 이벤트 리스너 보존)
  const tabsDiv = document.getElementById('staff-tabs');
  if (tabsDiv) {
    tabsDiv.innerHTML = tabs.map(name => {
      const isActive = name === active;
      const count = (fullAdmin && name === '김종진')
        ? loadTokenList().length
        : loadTokenList().filter(t => t.label === name).length;
      return `<button class="staff-tab${isActive ? ' staff-tab--active' : ''}" data-tab="${name}">
        ${name}${count ? ` <span class="staff-tab__count">${count}</span>` : ''}
      </button>`;
    }).join('');
  }
  const selectEl = document.getElementById('admin-user-select');
  if (selectEl) selectEl.value = user;

  // 목록 갱신
  const wrap = document.getElementById('token-list-wrap');
  if (wrap) wrap.innerHTML = renderTokenTable();
}

function escH(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── 토큰 발급 ────────────────────────────────────────────────
async function issueToken(access) {
  const btn    = document.getElementById('issue-btn');
  const days   = parseInt(document.getElementById('issue-days')?.value || String(access?.days || 10), 10);
  const label  = document.getElementById('issue-label')?.value.trim() || '';
  const result = document.getElementById('issue-result');
  btn.disabled = true; btn.textContent = '생성 중…';
  try {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ action: 'generate_token', days }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || '토큰 생성 실패'); return; }
    const origin = location.origin;
    const url    = `${origin}/?t=${data.inviteToken}`;
    const no     = loadTokenList().length + 1;
    addToList({
      id: data.inviteToken.slice(-16), no, token: data.inviteToken, url, days, label,
      pw: data.pw || '',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(data.exp * 1000).toISOString(),
    });
    const shortUrl = data.pw ? `${origin}/?pw=${data.pw}` : url;
    document.getElementById('issue-pw').value        = data.pw || '';
    document.getElementById('issue-short-url').value = shortUrl;
    document.getElementById('issue-url').value       = url;
    document.getElementById('issue-code').value      = data.inviteToken;
    document.getElementById('issue-exp').textContent =
      `만료: ${new Date(data.exp * 1000).toLocaleDateString('ko-KR')} (${days}일)`;
    result.hidden = false;
    refreshTokenList();
  } catch { alert('서버에 연결할 수 없습니다.'); }
  finally { btn.disabled = false; btn.textContent = '+ 새 접속 코드 발급'; }
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
    } catch {}
  });
}

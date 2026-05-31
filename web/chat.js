/**
 * AI 법령 해석 챗봇 프런트엔드 모듈.
 * initChat() 최초 1회 호출. 이후 동일 DOM에서 동작.
 */

const MAX_HISTORY = 10;
const SKILL_KEY = 'ktl-admin-skill';
let history = [];
let sending = false;

const WELCOME = "수질TMS 정도검사·먹는물 관련 법령에 대해 질문하세요.\n예: 수질TMS 반복성 검사 주기, 물환경보전법 정도검사 기준, 잔류염소 허용 기준 등";

export function initChat() {
  const msgs = document.getElementById('chat-msgs');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  if (!msgs || !input || !sendBtn) return;
  if (msgs.dataset.initialized) return;
  msgs.dataset.initialized = '1';

  appendMsg('assistant', WELCOME);
  checkLawConnectivity();

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  async function send() {
    if (sending) return;
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    adjustTextarea(input);
    appendMsg('user', msg);
    history.push({ role: 'user', content: msg });

    sending = true;
    sendBtn.disabled = true;
    const loader = appendMsg('assistant', '답변 생성 중…', true);

    try {
      const adminSkill = loadAdminSkill();
      const body = { message: msg, history: history.slice(-MAX_HISTORY) };
      if (adminSkill) body.adminSkill = adminSkill;

      const res = await fetch('/api/lawChat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      const reply = res.ok ? (data.reply || '응답 없음') : (data.error || '오류가 발생했습니다.');
      loader.classList.remove('chat-msg--loading');
      loader.innerHTML = formatReply(reply);
      if (res.ok) {
        history.push({ role: 'assistant', content: reply });
        updateLawStatus(data.lawConnected ? 'ok' : 'down');
        if (data.skillActive) markSkillActive();
      }
      if (data.lawRef) {
        const ref = document.createElement('div');
        ref.className = 'chat-lawref';
        ref.innerHTML = `<span class="chat-lawref__icon">📋</span> 참고 법령: <strong>${escHtml(data.lawRef)}</strong>`;
        loader.after(ref);
      }
    } catch {
      loader.classList.remove('chat-msg--loading');
      loader.textContent = '서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.';
      loader.classList.add('chat-msg--error');
    } finally {
      sending = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }
}

export async function checkLawConnectivity() {
  updateLawStatus('checking');
  try {
    const res = await fetch('/api/lawSearch?query=물환경보전법&target=law', { signal: AbortSignal.timeout(8000) });
    updateLawStatus(res.ok ? 'ok' : 'down');
  } catch {
    updateLawStatus('down');
  }
}

export function updateLawStatus(status) {
  const chip = document.getElementById('law-status-chip');
  if (!chip) return;
  chip.className = `law-status-chip law-status-chip--${status}`;
  const dot = chip.querySelector('.law-status-chip__dot');
  const label = chip.querySelector('.law-status-chip__label');
  if (dot) dot.className = `law-status-chip__dot`;
  if (label) {
    label.textContent =
      status === 'ok' ? '법령 연동됨' :
      status === 'down' ? '법령 미연결' : '연동 확인 중';
  }
}

function markSkillActive() {
  const badge = document.getElementById('skill-active-badge');
  if (badge) badge.hidden = false;
}

function loadAdminSkill() {
  try { return localStorage.getItem(SKILL_KEY) || ''; } catch { return ''; }
}

function appendMsg(role, text, isLoading = false) {
  const msgs = document.getElementById('chat-msgs');
  const div = document.createElement('div');
  div.className = `chat-msg chat-msg--${role}${isLoading ? ' chat-msg--loading' : ''}`;
  if (role === 'assistant' && !isLoading) {
    div.innerHTML = formatReply(text);
  } else {
    div.textContent = text;
  }
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

function formatReply(text) {
  return escHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/■/g, '<span class="chat-bullet">■</span>')
    .replace(/\n/g, '<br>');
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function adjustTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

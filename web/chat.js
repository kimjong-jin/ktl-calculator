/**
 * AI 법령 해석 챗봇 프런트엔드 모듈.
 * initChat() 최초 1회 호출. 이후 동일 DOM에서 동작.
 */

const MAX_HISTORY = 10;
let history = [];
let sending = false;

const WELCOME = "계측·정도검사 관련 법령에 대해 질문하세요.\n예: 유량계 정도검사 주기, 대기환경측정기기 형식승인 기준, 계량기 검정 절차 등";

export function initChat() {
  const msgs = document.getElementById('chat-msgs');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  if (!msgs || !input || !sendBtn) return;
  if (msgs.dataset.initialized) return;
  msgs.dataset.initialized = '1';

  appendMsg('assistant', WELCOME);

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
    const loader = appendMsg('assistant', '답변을 생성하는 중…');

    try {
      const res = await fetch('/api/lawChat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history: history.slice(-MAX_HISTORY) }),
      });
      const data = await res.json();
      const reply = res.ok ? (data.reply || '응답 없음') : (data.error || '오류가 발생했습니다.');
      loader.innerHTML = formatReply(reply);
      if (res.ok) history.push({ role: 'assistant', content: reply });
      if (data.lawRef) {
        const ref = document.createElement('p');
        ref.className = 'chat-lawref';
        ref.textContent = `참고 법령: ${data.lawRef}`;
        loader.after(ref);
      }
    } catch {
      loader.textContent = '서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.';
      loader.classList.add('chat-msg--error');
    } finally {
      sending = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }
}

function appendMsg(role, text) {
  const msgs = document.getElementById('chat-msgs');
  const div = document.createElement('div');
  div.className = `chat-msg chat-msg--${role}`;
  if (role === 'assistant') {
    div.innerHTML = formatReply(text);
  } else {
    div.textContent = text;
  }
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

function formatReply(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function adjustTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

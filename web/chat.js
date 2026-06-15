/**
 * AI 법령 해석 챗봇 프런트엔드 모듈.
 * initChat() 최초 1회 호출. 이후 동일 DOM에서 동작.
 */

const MAX_HISTORY = 6;
const SKILLS_KEY = 'ktl-admin-skills';
let history = [];
let sending = false;

const WELCOME = "KTL 환경측정기기 서비스에 대해 질문하세요.\n예: TOC 정도검사 기준, CL 성능시험 방법, 파생모델 수수료, 간이측정기 등급 판정, 포르마진 표준용액 제조";

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

  // 음성인식 설정
  const micBtn = document.getElementById('chat-mic');
  const headerMicBtn = document.getElementById('header-mic');
  let recognition = null;
  let isRecording = false;
  let activeMicBtn = null;

  const getMicButtons = () => {
    const btns = [];
    if (micBtn) btns.push(micBtn);
    if (headerMicBtn) btns.push(headerMicBtn);
    return btns;
  };

  if (micBtn) {
    micBtn.addEventListener('click', () => { activeMicBtn = micBtn; toggleSpeechRecognition(); });
  }
  if (headerMicBtn) {
    headerMicBtn.addEventListener('click', () => { activeMicBtn = headerMicBtn; toggleSpeechRecognition(); });
  }

  function toggleSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast('이 브라우저는 음성 인식을 지원하지 않습니다. Chrome 등을 사용해주세요.');
      return;
    }

    if (isRecording) {
      if (recognition) recognition.stop();
      return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      isRecording = true;
      getMicButtons().forEach(btn => btn.classList.add('chat-mic-btn--recording'));
      showToast('🎙️ 음성 인식을 시작합니다. 말씀하세요...');
    };

    recognition.onend = () => {
      isRecording = false;
      getMicButtons().forEach(btn => btn.classList.remove('chat-mic-btn--recording'));
      activeMicBtn = null;
    };

    recognition.onerror = (event) => {
      isRecording = false;
      getMicButtons().forEach(btn => btn.classList.remove('chat-mic-btn--recording'));
      activeMicBtn = null;
      if (event.error === 'not-allowed') {
        showToast('⚠️ 마이크 권한이 거부되었습니다. 주소창에서 권한을 허용해주세요.');
      } else {
        showToast(`⚠️ 음성 인식 오류: ${event.error}`);
      }
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      if (!transcript) return;

      const commands = parseVoiceCommand(transcript);
      if (commands.length > 0) {
        let appliedCount = 0;
        commands.forEach(cmd => {
          let field = cmd.field;
          // Tab-aware mapping for Linearity/Middle fields
          if (field === 'm1') {
            if (document.getElementById('pv_m1')) field = 'm1';
            else if (document.getElementById('pv_phm4')) field = 'phm4';
            else if (document.getElementById('pv_domax')) field = 'domax';
          } else if (field === 'm2') {
            if (document.getElementById('pv_m2')) field = 'm2';
            else if (document.getElementById('pv_phm7')) field = 'phm7';
            else if (document.getElementById('pv_domin')) field = 'domin';
          } else if (field === 'm3') {
            if (document.getElementById('pv_m3')) field = 'm3';
            else if (document.getElementById('pv_phm10')) field = 'phm10';
          }

          const inputEl = document.getElementById(`pv_${field}`);
          if (inputEl) {
            inputEl.value = cmd.val;
            // Auto-calculation 및 saveData 트리거를 위한 input 이벤트 디스패치
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            
            // 시각적 피드백 하이라이트
            inputEl.classList.add('pv-field-highlight');
            setTimeout(() => {
              inputEl.classList.remove('pv-field-highlight');
            }, 1000);
            appliedCount++;
          }
        });

        if (appliedCount > 0) {
          const msgList = commands.map(c => `${c.field.toUpperCase()}=${c.val}`).join(', ');
          showToast(`✅ 음성 입력 완료: ${msgList}`);
          appendMsg('assistant', `🎤 음성 명령 적용: ${msgList}`);
        } else {
          showToast('⚠️ 인식된 필드가 현재 화면에 없습니다.');
        }
      } else {
        // 일반 대화의 경우 헤더 마이크에서 왔다면 챗봇 창을 열지 않고 토스트로 텍스트만 피드백
        if (activeMicBtn === headerMicBtn) {
          showToast(`인식 결과: "${transcript}" (일치하는 필드가 없습니다)`);
        } else {
          // 일반 텍스트는 챗봇 입력창에 대입
          const currentVal = input.value.trim();
          input.value = currentVal ? `${currentVal} ${transcript}` : transcript;
          adjustTextarea(input);
          input.focus();
          showToast('📝 텍스트를 입력창에 추가했습니다.');
        }
      }
    };

    recognition.start();
  }

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
      const getLS = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
      const body = {
        message: msg,
        history: history.slice(-MAX_HISTORY),
        userName: getLS('ktl-calc-username'),
        receiptNo: getLS('ktl-calc-receipt'),
      };
      if (adminSkill) body.adminSkill = adminSkill;

      const authToken = (() => { try { return localStorage.getItem('ktl-auth') || ''; } catch { return ''; } })();
      const res = await fetch('/api/lawChat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'x-auth-token': authToken } : {}),
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      const reply = res.ok
        ? (data.reply || '응답 없음')
        : res.status === 429
          ? `⚠️ ${data.error || '오늘 AI 응답 한도를 초과했습니다.'}`
          : (data.error || '오류가 발생했습니다.');
      loader.classList.remove('chat-msg--loading');
      loader.innerHTML = formatReply(reply);
      if (res.ok) {
        history.push({ role: 'assistant', content: reply });
        if (data.knowledgeUsed || data.lawConnected) updateLawStatus('ok');
        if (data.skillActive) markSkillActive();
        if (data.tokens) appendTokenBadge(loader, data.tokens);
        if (data.knowledgeUsed) markKnowledgeUsed(loader, data.knowledgeVersion);
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
      status === 'ok' ? '지식 서비스 연결됨' :
      status === 'down' ? '서비스 미연결' : '연결 확인 중';
  }
}

function markSkillActive() {
  const badge = document.getElementById('skill-active-badge');
  if (badge) badge.hidden = false;
}

function markKnowledgeUsed(msgEl, version) {
  const tag = document.createElement('span');
  tag.className = 'chat-kb-tag';
  tag.textContent = version ? `📚 지식베이스 (${version} 기준)` : '📚 지식베이스';
  tag.title = version
    ? `KTL 지식 베이스 활용 — ${version} 시행 법령 기준`
    : 'KTL 도메인 지식 베이스가 이 답변에 활용됐습니다';
  msgEl.prepend(tag);
}

function loadAdminSkill() {
  try {
    const skills = JSON.parse(localStorage.getItem(SKILLS_KEY) || '[]');
    return skills
      .filter(s => s.active)
      .map(s => `[스킬: ${s.title} — 작성: ${s.author}]\n${s.content}`)
      .join('\n\n---\n\n');
  } catch { return ''; }
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

function appendTokenBadge(msgEl, tokens) {
  const thinking = tokens.total - tokens.input - tokens.output;
  const badge = document.createElement('div');
  badge.className = 'chat-token-badge';
  let html = `<span style="opacity:.5;font-size:11px">🔢 토큰</span>` +
    `<span class="chat-token-badge__sep">|</span>` +
    `<span class="chat-token-badge__item" title="입력 토큰">입력 ${tokens.input.toLocaleString()}</span>` +
    `<span class="chat-token-badge__sep">·</span>`;
  if (thinking > 0) {
    html +=
      `<span class="chat-token-badge__thinking" title="추론 토큰">추론 ${thinking.toLocaleString()}</span>` +
      `<span class="chat-token-badge__sep">·</span>`;
  }
  html +=
    `<span class="chat-token-badge__item" title="출력 토큰">출력 ${tokens.output.toLocaleString()}</span>` +
    `<span class="chat-token-badge__sep">·</span>` +
    `<span class="chat-token-badge__total" title="합계 토큰">합계 ${tokens.total.toLocaleString()}</span>`;
  badge.innerHTML = html;
  msgEl.appendChild(badge);
}

function adjustTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// Toast Notification Utility
function showToast(text) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.position = 'fixed';
    container.style.bottom = '24px';
    container.style.left = '50%';
    container.style.transform = 'translateX(-50%)';
    container.style.zIndex = '9999';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '8px';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast-msg';
  toast.textContent = text;
  toast.style.background = 'var(--surface-1)';
  toast.style.color = 'var(--text)';
  toast.style.border = '1px solid var(--border-strong)';
  toast.style.padding = '10px 16px';
  toast.style.borderRadius = 'var(--r-sm)';
  toast.style.boxShadow = 'var(--sh-2)';
  toast.style.fontSize = '14px';
  toast.style.opacity = '0';
  toast.style.transition = 'opacity 0.2s, transform 0.2s';
  toast.style.transform = 'translateY(10px)';
  
  container.appendChild(toast);
  toast.offsetHeight; // force reflow
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), 200);
  }, 2500);
}

// Map spoken aliases to canonical field codes
const fieldMap = {
  // Z fields (Zero drift / 제로 / 제료 / 재로)
  'z1': 'z1', '제트원': 'z1', '제트일': 'z1', '지일': 'z1', '지원': 'z1', '제로원': 'z1', '제로일': 'z1', '제로1': 'z1', '제료1': 'z1', '재로1': 'z1', '제로일번': 'z1', '제로일본': 'z1', '제료일번': 'z1', '제료일본': 'z1', '재로일번': 'z1', '재로일본': 'z1',
  'z2': 'z2', '제트투': 'z2', '제트이': 'z2', '지이': 'z2', '지투': 'z2', '제로투': 'z2', '제로이': 'z2', '제로2': 'z2', '제료2': 'z2', '재로2': 'z2',
  'z3': 'z3', '제트쓰리': 'z3', '제트삼': 'z3', '지삼': 'z3', '지쓰리': 'z3', '제로쓰리': 'z3', '제로삼': 'z3', '제로3': 'z3', '제료3': 'z3', '재로3': 'z3',
  'z4': 'z4', '제트포': 'z4', '제트사': 'z4', '지사': 'z4', '지포': 'z4', '제로포': 'z4', '제로사': 'z4', '제로4': 'z4', '제료4': 'z4', '재로4': 'z4',
  'z5': 'z5', '제트파이브': 'z5', '제트오': 'z5', '지오': 'z5', '지파이브': 'z5', '제로파이브': 'z5', '제로오': 'z5', '제로5': 'z5', '제료5': 'z5', '재로5': 'z5',
  'z6': 'z6', '제트식스': 'z6', '제트육': 'z6', '지육': 'z6', '지식스': 'z6', '제로식스': 'z6', '제로육': 'z6', '제로6': 'z6', '제료6': 'z6', '재로6': 'z6',
  'z7': 'z7', '제트세븐': 'z7', '제트칠': 'z7', '지칠': 'z7', '지세븐': 'z7', '제로세븐': 'z7', '제로칠': 'z7', '제로7': 'z7', '제료7': 'z7', '재로7': 'z7',

  // S fields (Span drift / 스팬 / 습팬 / 수팬 / 스판 / 쓰판)
  's1': 's1', '에스원': 's1', '에스일': 's1', '스팬원': 's1', '스팬일': 's1', '스팬1': 's1', '스판1': 's1', '습팬1': 's1', '쓰판1': 's1', '스팬일번': 's1', '스팬일본': 's1', '스판일번': 's1', '스판일본': 's1', '습팬일번': 's1', '습팬일본': 's1',
  's2': 's2', '에스투': 's2', '에스이': 's2', '스팬투': 's2', '스팬이': 's2', '스팬2': 's2', '스판2': 's2', '습팬2': 's2', '쓰판2': 's2',
  's3': 's3', '에스쓰리': 's3', '에스삼': 's3', '스팬쓰리': 's3', '스팬삼': 's3', '스팬3': 's3', '스판3': 's3', '습팬3': 's3', '쓰판3': 's3',
  's4': 's4', '에스포': 's4', '에스사': 's4', '스팬포': 's4', '스팬사': 's4', '스팬4': 's4', '스판4': 's4', '습팬4': 's4', '쓰판4': 's4',
  's5': 's5', '에스파이브': 's5', '에스오': 's5', '스팬파이브': 's5', '스팬오': 's5', '스팬5': 's5', '스판5': 's5', '습팬5': 's5', '쓰판5': 's5',
  's6': 's6', '에스식스': 's6', '에스육': 's6', '스팬식스': 's6', '스팬육': 's6', '스팬6': 's6', '스판6': 's6', '습팬6': 's6', '쓰판6': 's6',
  's7': 's7', '에스세븐': 's7', '에스칠': 's7', '스팬세븐': 's7', '스팬칠': 's7', '스팬7': 's7', '스판7': 's7', '습팬7': 's7', '쓰판7': 's7',

  // M fields (Linearity / 직선성 / 미들 / 미을 / 미늘 / 밀들 / 민들 / 믿을래 / 믿을레)
  'm1': 'm1', '엠원': 'm1', '엠일': 'm1', '엠1': 'm1', '직선성원': 'm1', '직선성일': 'm1', '직선성1': 'm1', '미들원': 'm1', '미들일': 'm1', '미들1': 'm1', '미들': 'm1', '미을1': 'm1', '미늘1': 'm1', '밀들1': 'm1', '민들1': 'm1', '미을': 'm1', '미늘': 'm1', '밀들': 'm1', '민들': 'm1', '믿을래': 'm1', '믿을레': 'm1', '미들래': 'm1', '미들레': 'm1', '믿을원': 'm1', '믿을일': 'm1', '믿을1': 'm1', '믿을일본': 'm1', '미들일본': 'm1', '믿을일본에': 'm1', '미들일본에': 'm1', '믿을일번': 'm1', '미들일번': 'm1', '믿을일번에': 'm1', '미들일번에': 'm1',
  'm2': 'm2', '엠투': 'm2', '엠이': 'm2', '엠2': 'm2', '직선성투': 'm2', '직선성이': 'm2', '직선성2': 'm2', '미들투': 'm2', '미들이': 'm2', '미들2': 'm2', '미을2': 'm2', '미늘2': 'm2', '밀들2': 'm2', '민들2': 'm2', '믿을투': 'm2', '믿을이': 'm2', '믿을2': 'm2', '믿을래이': 'm2', '믿을레이': 'm2',
  'm3': 'm3', '엠쓰리': 'm3', '엠삼': 'm3', '엠3': 'm3', '직선성쓰리': 'm3', '직선성삼': 'm3', '직선성3': 'm3', '미들쓰리': 'm3', '미들삼': 'm3', '미들3': 'm3', '미을3': 'm3', '미늘3': 'm3', '밀들3': 'm3', '민들3': 'm3', '믿을쓰리': 'm3', '믿을삼': 'm3', '믿을3': 'm3',

  // Other fields
  'range': 'range', '측정범위': 'range', '레인지': 'range', '범위': 'range',
  'fdis': 'fdis', '배출기준': 'fdis', '배출허용기준': 'fdis', '허용기준': 'fdis',
  'resp': 'resp', '응답시간': 'resp', '리스폰스': 'resp',

  // pH fields
  'ph7a': 'ph7a', 'ph칠에이': 'ph7a', '피에이치칠에이': 'ph7a',
  'ph4a': 'ph4a', 'ph사에이': 'ph4a', '피에이치사에이': 'ph4a',
  'ph7b': 'ph7b', 'ph칠비': 'ph7b', '피에이치칠비': 'ph7b',
  'ph4b': 'ph4b', 'ph사비': 'ph4b', '피에이치사비': 'ph4b',
  'ph7c': 'ph7c', 'ph칠씨': 'ph7c', '피에이치칠씨': 'ph7c',
  'ph4c': 'ph4c', 'ph사씨': 'ph4c', '피에이치사씨': 'ph4c',
  'phdi': 'phdi', 'ph디아이': 'phdi', '피에이치디아이': 'phdi',
  'phdf': 'phdf', 'ph디에프': 'phdf', '피에이치디에프': 'phdf',
  'phm4': 'phm4', 'ph엠사': 'phm4', 'ph엠포': 'phm4', '피에이치엠사': 'phm4', '피에이치엠포': 'phm4',
  'phm7': 'phm7', 'ph엠칠': 'phm7', 'ph엠세븐': 'phm7', '피에이치엠칠': 'phm7', '피에이치엠세븐': 'phm7',
  'phm10': 'phm10', 'ph엠십': 'phm10', 'ph엠텐': 'phm10', '피에이치엠십': 'phm10', '피에이치엠텐': 'phm10',
  'pht10': 'pht10', 'pht십': 'pht10', 'pht텐': 'pht10', '피에이치티십': 'pht10', '피에이치티텐': 'pht10',
  'pht15': 'pht15', 'pht십오': 'pht15', '피에이치티십오': 'pht15',
  'pht20': 'pht20', 'pht이십': 'pht20', '피에이치티이십': 'pht20',
  'pht25': 'pht25', 'pht이십오': 'pht25', '피에이치티이십오': 'pht25',
  'pht30': 'pht30', 'pht삼십': 'pht30', '피에이치티삼십': 'pht30',
  'phci1': 'phci1', 'ph씨아이일': 'phci1', 'ph씨아이원': 'phci1', '피에이치씨아이일': 'phci1', '피에이치씨아이원': 'phci1',
  'phai1': 'phai1', 'ph에이아이일': 'phai1', 'ph에이아이원': 'phai1', '피에이치에이아이일': 'phai1', '피에이치에이아이원': 'phai1',
  'phai2': 'phai2', 'ph에이아이이': 'phai2', 'ph에이아이투': 'phai2', '피에이치에이아이이': 'phai2', '피에이치에이아이투': 'phai2',
  'phci2': 'phci2', 'ph씨아이이': 'phci2', 'ph씨아이투': 'phci2', '피에이치씨아이이': 'phci2', '피에이치씨아이투': 'phci2',
  'phai3': 'phai3', 'ph에이아이삼': 'phai3', 'ph에이아이쓰리': 'phai3', '피에이치에이아이삼': 'phai3', '피에이치에이아이쓰리': 'phai3',
  'phai4': 'phai4', 'ph에이아이사': 'phai4', 'ph에이아이포': 'phai4', '피에이치에이아이사': 'phai4', '피에이치에이아이포': 'phai4',

  // DO fields
  'dos1': 'dos1', 'dos일': 'dos1', 'dos원': 'dos1', '디오에스일': 'dos1', '디오에스원': 'dos1',
  'dos2': 'dos2', 'dos이': 'dos2', 'dos투': 'dos2', '디오에스이': 'dos2', '디오에스투': 'dos2',
  'dos3': 'dos3', 'dos삼': 'dos3', 'dos쓰리': 'dos3', '디오에스삼': 'dos3', '디오에스쓰리': 'dos3',
  'dozi': 'dozi', '디오지아이': 'dozi',
  'dozf': 'dozf', '디오지에프': 'dozf',
  'dosi': 'dosi', '디오에스아이': 'dosi',
  'dosf': 'dosf', '디오에스에프': 'dosf',
  'domax': 'domax', '디오맥스': 'domax',
  'domin': 'domin', '디오민': 'domin',
  'dot20': 'dot20', '디오티이십': 'dot20',
  'dot30': 'dot30', '디오티삼십': 'dot30',

  // Field application fields
  'ci1': 'ci1', '씨아이일': 'ci1', '씨아이원': 'ci1',
  'ai1': 'ai1', '에이아이일': 'ai1', '에이아이원': 'ai1',
  'ai2': 'ai2', '에이아이이': 'ai2', '에이아이투': 'ai2',
  'ci2': 'ci2', '씨아이이': 'ci2', '씨아이투': 'ci2',
  'ai3': 'ai3', '에이아이삼': 'ai3', '에이아이쓰리': 'ai3',
  'ai4': 'ai4', '에이아이사': 'ai4', '에이아이포': 'ai4',

  // COD fields
  'codmax': 'codmax', '씨오디맥스': 'codmax', '시오디맥스': 'codmax',
  'codmin': 'codmin', '씨오디민': 'codmin', '시오디민': 'codmin'
};

function normalizeKoreanNumbers(str) {
  const valMap = { '영': 0, '공': 0, '일': 1, '이': 2, '삼': 3, '사': 4, '오': 5, '육': 6, '칠': 7, '팔': 8, '구': 9 };
  
  // Replace decimal "점" surrounded by digits or Korean numbers with "."
  str = str.replace(/([0-9영공일이삼사오육칠팔구])\s*점\s*([0-9영공일이삼사오육칠팔구])/g, '$1.$2');
  
  // Parse compound Korean numbers like "사십오", "이십", "십오"
  const numRegex = /[영공일이삼사오육칠팔구십백]+/g;
  
  return str.replace(numRegex, (match) => {
    if (match === '영' || match === '공') return '0';
    
    // Check if it has 십 or 백
    if (!match.includes('십') && !match.includes('백')) {
      // Just a sequence of digits, e.g. "이오" -> "25"
      return match.split('').map(char => valMap[char] !== undefined ? valMap[char] : char).join('');
    }
    
    // It's a compound number
    let total = 0;
    let temp = match;
    
    // Parse "백"
    if (temp.includes('백')) {
      const parts = temp.split('백');
      const prefix = parts[0];
      const prefixVal = prefix ? (valMap[prefix] || 1) : 1;
      total += prefixVal * 100;
      temp = parts[1] || '';
    }
    
    // Parse "십"
    if (temp.includes('십')) {
      const parts = temp.split('십');
      const prefix = parts[0];
      const prefixVal = prefix ? (valMap[prefix] || 1) : 1;
      total += prefixVal * 10;
      temp = parts[1] || '';
    }
    
    // Parse remaining units
    if (temp) {
      total += valMap[temp] || 0;
    }
    
    return total.toString();
  });
}

function parseVoiceCommand(transcript) {
  // 공백을 제거하여 "제로 1번" -> "제로1번" 형태로 가공하여 매칭률 극대화
  let txt = transcript.toLowerCase().replace(/\s+/g, '');
  
  // 사투리 및 연음 오인식 전처리 보정 (일본 -> 1번, 믿을래 -> 미들1 등)
  txt = txt.replace(/마이너스/g, '-')
           .replace(/제료/g, '제로')
           .replace(/재로/g, '제로')
           .replace(/습팬/g, '스팬')
           .replace(/수팬/g, '스팬')
           .replace(/스판/g, '스팬')
           .replace(/쓰판/g, '스팬')
           .replace(/미을/g, '미들')
           .replace(/미늘/g, '미들')
           .replace(/밀들/g, '미들')
           .replace(/민들/g, '미들')
           .replace(/믿을래이/g, '미들2')
           .replace(/믿을레이/g, '미들2')
           .replace(/믿을래/g, '미들1')
           .replace(/믿을레/g, '미들1')
           .replace(/미들래/g, '미들1')
           .replace(/미들레/g, '미들1')
           .replace(/믿을/g, '미들');
           
  txt = normalizeKoreanNumbers(txt);
  
  const sortedAliases = Object.keys(fieldMap).sort((a, b) => b.length - a.length);
  const aliasPattern = sortedAliases.map(a => a.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|');
  // 한국어 조사(은, 는, 이, 가, 에, 번, 값은, 값을 등)와 부호를 유연하게 매칭
  // 음수 부호(-?)를 포함하여 숫자를 매칭하도록 정규식을 개선합니다.
  const regex = new RegExp(`(${aliasPattern})[은는이가에의번값은값을:=\\s]*(-?\\d+(?:\\.\\d+)?)`, 'gi');
  
  const results = [];
  let match;
  while ((match = regex.exec(txt)) !== null) {
    const alias = match[1].toLowerCase();
    const val = match[2];
    const fieldCode = fieldMap[alias];
    if (fieldCode) {
      results.push({ field: fieldCode, val: val });
    }
  }
  return results;
}

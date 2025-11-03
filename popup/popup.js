import { isAuthenticated, loginWithGoogle, logout, loadAuth } from '../lib/auth.js';
import { localDateKey } from '../lib/date-utils.js';
import { requestDailyAffirmation } from '../lib/ai-client.js';
const MODE_PRESETS = {
  pomodoro: { work: 25, rest: 5 },
  long: { work: 50, rest: 10 },
  short: { work: 15, rest: 3 },
};

let selectedMode = 'pomodoro';
let currentDay = new Date();

// 브레이크 선택 카드 상태
let allBreakCandidates = [];
let currentBreakPage = 0;
let selectedBreakIndex = 0;
let currentBreakSessionId = null;
let breakSelectionPayload = null;
let isLoadingBreaks = false;
const maxBreakPages = 5;

document.addEventListener('DOMContentLoaded', async () => {
  // Onboarding gate: if not completed, redirect to onboarding page
  try {
    const { userProfile = {} } = await chrome.storage.local.get('userProfile');
    if (!userProfile.onboardingCompleted) {
      window.location.href = chrome.runtime.getURL('../pages/onboarding.html');
      return;
    }
  } catch {}

  await refreshAuthUI();
  await renderOnboardingSummary();
  await renderTimerDescription();

  document.getElementById('loginBtn').addEventListener('click', async () => {
    try { await loginWithGoogle(); } catch (e) { alert('로그인 실패: ' + e.message); }
    refreshAuthUI();
  });
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await logout();
    refreshAuthUI();
  });

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      selectedMode = btn.dataset.mode;
      setActiveModeButton(selectedMode);
      setControlsEnabled(true);
      // Activate timer controls + recommendation sections on first preset click
      const tc = document.getElementById('timerControls'); if (tc) tc.classList.remove('hidden');
      const bs = document.getElementById('breakSelectionCard'); if (bs) bs.classList.remove('hidden');
      // (reverted) timer is always visible; no gating by AI selection
      // 타이머 모드 클릭 시 즉시 인라인 카드로 휴식 추천 표시
      const preset = MODE_PRESETS[selectedMode] || MODE_PRESETS.pomodoro;
      const payload = { mode: selectedMode, workMinutes: preset.work, breakMinutes: preset.rest };
      
      // 이전 세션 상태 초기화
      allBreakCandidates = [];
      currentBreakPage = 0;
      selectedBreakIndex = 0;
      currentBreakSessionId = null;
      breakSelectionPayload = null;
      
      // 백그라운드에 추천 요청 (완료 후 background에서 메시지로 카드 펼침 요청)
      chrome.runtime.sendMessage({ type: 'breet:prebreakSelect', payload }, async (response) => {
        // 추천 완료 후 약간의 지연을 두고 카드 펼침 (storage 동기화 대기)
        setTimeout(async () => {
          const { prebreakPayload } = await chrome.storage.local.get(['prebreakPayload']);
          if (prebreakPayload && prebreakPayload.breakMinutes === payload.breakMinutes) {
            // 세션 ID 찾기 (가장 최근 것)
            const keys = await chrome.storage.local.get(null);
            let foundSessionId = null;
            let latestTs = 0;
            for (const key in keys) {
              if (key.startsWith('prebreakMeta_')) {
                const sid = key.replace('prebreakMeta_', '');
                const ts = parseInt(sid.split('_')[0]) || 0;
                if (ts > latestTs) {
                  latestTs = ts;
                  foundSessionId = sid;
                }
              }
            }
            if (foundSessionId) {
              await expandBreakSelectionCard({ ...prebreakPayload, sessionId: foundSessionId, breakMinutes: payload.breakMinutes });
            }
          }
        }, 300);
      });
    });
  });

  document.getElementById('startBtn').addEventListener('click', onStart);
  document.getElementById('stopBtn').addEventListener('click', onPause);
  const quick = document.getElementById('quick11');
  if (quick) quick.addEventListener('click', async () => {
    // Clear highlight and run a 1min/1min cycle under same rules
    selectedMode = 'quick';
    setActiveModeButton(null);
    const payload = { mode: 'quick', workMinutes: 1, breakMinutes: 1 };
    
    // 이전 세션 상태 초기화
    allBreakCandidates = [];
    const tc = document.getElementById('timerControls'); if (tc) tc.classList.remove('hidden');
    const bs = document.getElementById('breakSelectionCard'); if (bs) bs.classList.remove('hidden');
    currentBreakPage = 0;
    selectedBreakIndex = 0;
    currentBreakSessionId = null;
    breakSelectionPayload = null;
    
    chrome.runtime.sendMessage({ type: 'breet:prebreakSelect', payload }, async () => {
      // 추천 완료 후 약간의 지연을 두고 카드 펼침 (storage 동기화 대기)
      setTimeout(async () => {
        const { prebreakPayload } = await chrome.storage.local.get(['prebreakPayload']);
        if (prebreakPayload && prebreakPayload.breakMinutes === payload.breakMinutes) {
          // 세션 ID 찾기 (가장 최근 것)
          const keys = await chrome.storage.local.get(null);
          let foundSessionId = null;
          let latestTs = 0;
          for (const key in keys) {
            if (key.startsWith('prebreakMeta_')) {
              const sid = key.replace('prebreakMeta_', '');
              const ts = parseInt(sid.split('_')[0]) || 0;
              if (ts > latestTs) {
                latestTs = ts;
                foundSessionId = sid;
              }
            }
          }
          if (foundSessionId) {
            await expandBreakSelectionCard({ ...prebreakPayload, sessionId: foundSessionId, breakMinutes: payload.breakMinutes });
          }
        }
      }, 300);
    });
  });
  document.getElementById('addTodo').addEventListener('click', onAddTodo);
  const prevDayBtn = document.getElementById('prevDay');
  const nextDayBtn = document.getElementById('nextDay');
  if (prevDayBtn) prevDayBtn.addEventListener('click', () => { currentDay.setDate(currentDay.getDate()-1); renderDateHeader(); loadTodos(); renderDaySummary(); });
  if (nextDayBtn) nextDayBtn.addEventListener('click', () => { currentDay.setDate(currentDay.getDate()+1); renderDateHeader(); loadTodos(); renderDaySummary(); });
  renderDateHeader();
  await migrateTodosIfNeeded();
  loadTodos();
  renderDaySummary();
  refreshCountdown();
  setInterval(refreshCountdown, 1000);
  
  // 브레이크 선택 카드 초기화
  initBreakSelectionCard();
  
  // 메시지 리스너: background에서 카드 펼침 요청
  chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
    if (message.type === 'breet:expandBreakSelection') {
      // 이전 세션 상태 초기화
      allBreakCandidates = [];
      currentBreakPage = 0;
      selectedBreakIndex = 0;
      // 메시지에서 받은 payload를 바로 사용
      expandBreakSelectionCard(message.payload).then(() => {
        if (_sendResponse) _sendResponse({ ok: true });
      }).catch(() => {
        if (_sendResponse) _sendResponse({ ok: false });
      });
      return true;
    }
    return false;
  });
  
  // 세션 상태 구독: break나 idle일 때 카드 닫기 (WORK_ENDING에서는 자동 펼침하지 않음)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.sessionState?.newValue) {
      const newPhase = changes.sessionState.newValue.phase;
      if (newPhase === 'break' || newPhase === 'idle') {
        collapseBreakSelectionCard();
      }
      // WORK_ENDING에서는 자동 펼침하지 않음 (타이머 버튼 클릭 시에만 표시)
    }
  });
});

async function refreshAuthUI() {
  const ok = await isAuthenticated();
  const status = document.getElementById('authStatus');
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  // Guard for stale/cached HTML
  if (!status || !loginBtn || !logoutBtn) return;
  if (ok) {
    const a = await loadAuth();
    status.textContent = a?.email || '로그인됨';
    loginBtn.classList.add('hidden');
    logoutBtn.classList.remove('hidden');
  } else {
    status.textContent = '오프라인';
    loginBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
  }
}

function setActiveModeButton(mode) {
  const all = document.querySelectorAll('.mode-btn');
  all.forEach((b) => {
    b.classList.remove('bg-blue-500','text-white');
    b.classList.remove('border-2','border-blue-400','bg-gray-50');
    if (!b.classList.contains('bg-gray-200')) b.classList.add('bg-gray-200');
  });
  if (mode) {
    const btn = document.querySelector(`.mode-btn[data-mode="${mode}"]`);
    if (btn) {
      btn.classList.remove('bg-gray-200');
      btn.classList.add('bg-gray-50','border-2','border-blue-400');
    }
  }
}

function setControlsEnabled(enabled) {
  const start = document.getElementById('startBtn');
  const stop = document.getElementById('stopBtn');
  if (start) start.disabled = !enabled;
  if (stop) stop.disabled = !enabled;
}

async function renderOnboardingSummary() {
  // onboardingCard 섹션이 삭제되었으므로 더 이상 렌더링하지 않음
  // 작업 유형/건강 관심사는 설정 페이지에서 관리
  return;
}

// dateKey는 localDateKey로 대체 (로컬 기준)
const dateKey = localDateKey;
function formatKR(d = new Date()) { const y=String(d.getFullYear()).slice(2); const m=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0'); const wk=['일','월','화','수','목','금','토'][d.getDay()]; return `${y}.${m}.${dd} (${wk})`; }
function renderDateHeader(){ const el=document.getElementById('dateTitle'); if (el) el.textContent = formatKR(currentDay); }

async function renderDailyAffirmation() {
  const el = document.getElementById('dailyAffirmation');
  if (!el) return;
  const dk = dateKey();
  const { dailyAffirmation = null, userProfile = {} } = await chrome.storage.local.get(['dailyAffirmation','userProfile']);
  if (dailyAffirmation && dailyAffirmation.dateKey === dk && dailyAffirmation.text) {
    el.textContent = dailyAffirmation.text;
    return;
  }
  // try AI; fallback to local rotation
  let text = '';
  try {
    text = await requestDailyAffirmation({ workPatterns: userProfile.workPatterns, healthConcerns: userProfile.healthConcerns });
  } catch {}
  const EMOJIS = ['🌿','😊','☕️','🩵','🍀','✨','💙','🕊️'];
  const FALLBACKS = ['쉬고 가요','숨 고르기','짧게 쉼','눈 쉬어요','목 이완해','어깨 풀자','물 한잔요','천천히 호흡'];
  const MAX = 15, MIN = 6;
  const ensureLen = (s) => {
    const trimmed = (s || '').trim();
    if (trimmed.length >= MIN) return trimmed.slice(0, MAX);
    const alt = FALLBACKS[new Date().getDate() % FALLBACKS.length];
    return alt.slice(0, MAX);
  };
  const e = EMOJIS[new Date().getDate() % EMOJIS.length];
  if (!text || typeof text !== 'string') {
    text = `${ensureLen(FALLBACKS[new Date().getDate() % FALLBACKS.length])} ${e}`;
  } else {
    const hasEmoji = /\p{Emoji}/u.test(text);
    text = `${ensureLen(text)} ${hasEmoji ? '' : e}`.trim();
  }
  el.textContent = text;
  await chrome.storage.local.set({ dailyAffirmation: { dateKey: dk, text } });
}

async function renderTimerDescription() {
  const el = document.getElementById('timerDescription');
  if (!el) return;
  const text = '일하는 중간에 짧게 쉬면서 건강하고 오래 일해요💙';
  el.textContent = text;
  const dk = dateKey();
  await chrome.storage.local.set({ timerDescription: { dateKey: dk, text } });
}

// moved up

async function onToggleOnboardingChip(el) {
  // limit: max 2 edits per day across both categories
  const dk = dateKey();
  const { quickEditMeta = { dateKey: dk, edits: 0 }, userProfile = {} } = await chrome.storage.local.get(['quickEditMeta','userProfile']);
  const meta = (quickEditMeta && quickEditMeta.dateKey === dk) ? quickEditMeta : { dateKey: dk, edits: 0 };
  if (meta.edits >= 2) {
    alert('오늘은 더 이상 변경할 수 없어요 (최대 2회).');
    return;
  }
  const cat = el.dataset.category; const val = el.dataset.value;
  const arr = new Set((userProfile[cat] || []));
  if (arr.has(val)) { arr.delete(val); el.classList.remove('bg-blue-50','text-blue-700','border-blue-300'); }
  else { arr.add(val); el.classList.add('bg-blue-50','text-blue-700','border-blue-300'); }
  const updated = { ...(userProfile||{}) }; updated[cat] = Array.from(arr);
  // log quick edit for AI context
  const { quickEdits = [] } = await chrome.storage.local.get('quickEdits');
  const log = [...quickEdits, { ts: Date.now(), category: cat, value: val, action: arr.has(val) ? 'add' : 'remove' }].slice(-50);
  meta.edits += 1;
  await chrome.storage.local.set({ userProfile: updated, quickEditMeta: meta, quickEdits: log });
}

async function onStart(override, modeLabel) {
  const { sessionState } = await chrome.storage.local.get('sessionState');
  if (sessionState?.phase === 'paused') {
    chrome.runtime.sendMessage({ type: 'breet:resumeTimer' });
    return;
  }
  // Require a mode selection before enabling start
  const mode = modeLabel || selectedMode;
  if (!mode || !MODE_PRESETS[mode]) {
    alert('타이머 모드를 먼저 선택하세요. (25/5, 50/10, 15/3, 1/1)');
    return;
  }
  const preset = override || MODE_PRESETS[mode];
  // Start flow via pre-break selection popup
  chrome.runtime.sendMessage({ type: 'breet:prebreakSelect', payload: { mode, workMinutes: preset.work, breakMinutes: preset.rest } });
}

function onPause() {
  chrome.runtime.sendMessage({ type: 'breet:pauseTimer' });
}

async function refreshCountdown() {
  const el = document.getElementById('countdown');
  const sub = document.getElementById('timerSubtext');
  if (!el) return;
  const { sessionState } = await chrome.storage.local.get('sessionState');
  if (!sessionState || !sessionState.startTs || sessionState.phase === 'idle' || sessionState.phase === undefined) {
    el.textContent = '--:--';
    setControlsEnabled(!!selectedMode);
    if (sub) {
      const p = MODE_PRESETS[selectedMode] || MODE_PRESETS.pomodoro;
      sub.textContent = `${p.work}분 집중 후 ${p.rest}분 휴식`;
    }
    return;
  }
  if (sessionState.phase === 'paused') {
    setControlsEnabled(true);
    const remain = Math.max(0, sessionState.remainingMs || 0);
    const mm = String(Math.floor(remain / 60000)).padStart(2, '0');
    const ss = String(Math.floor((remain % 60000) / 1000)).padStart(2, '0');
    el.textContent = `${mm}:${ss}`;
    if (sub) sub.textContent = `일시정지 · 재생 시 ${mm}:${ss} 뒤 휴식`;
    return;
  }
  // running
  const start = document.getElementById('startBtn');
  const stop = document.getElementById('stopBtn');
  if (start) start.disabled = true;
  if (stop) stop.disabled = false;
  const endTs = sessionState.endTs || (sessionState.startTs + ((sessionState.phase === 'break' ? sessionState.breakDuration : sessionState.workDuration) * 60 * 1000));
  const remain = Math.max(0, endTs - Date.now());
  const mm = String(Math.floor(remain / 60000)).padStart(2, '0');
  const ss = String(Math.floor((remain % 60000) / 1000)).padStart(2, '0');
  el.textContent = `${mm}:${ss}`;
  if (sub) sub.textContent = `집중 중 · ${mm}:${ss} 뒤 휴식`;
}

async function loadTodos() {
  const dk = dateKey(currentDay);
  const { todosByDate = {} } = await chrome.storage.local.get('todosByDate');
  const todos = Array.isArray(todosByDate[dk]) ? todosByDate[dk] : [];
  const list = document.getElementById('todoList');
  list.innerHTML = '';
  todos.forEach((t) => list.appendChild(renderTodo(t)));
}

function renderTodo(todo) {
  const li = document.createElement('li');
  li.className = 'flex items-center justify-between border rounded-md px-2 py-1';
  const left = document.createElement('div');
  left.className = 'flex items-center gap-2';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!todo.completed;
  cb.addEventListener('change', () => toggleTodo(todo.id));
  const span = document.createElement('span');
  span.textContent = todo.text;
  if (todo.completed) span.className = 'line-through text-gray-500';
  left.appendChild(cb);
  left.appendChild(span);
  const snooze = document.createElement('button');
  snooze.className = 'text-xs text-gray-600 hover:text-blue-600';
  snooze.textContent = '하루 미루기';
  snooze.addEventListener('click', () => postponeTodo(todo.id));
  const del = document.createElement('button');
  del.className = 'text-xs text-gray-600 hover:text-red-600';
  del.textContent = '✕';
  del.setAttribute('aria-label','삭제');
  del.addEventListener('click', () => removeTodo(todo.id));
  li.appendChild(left);
  const right = document.createElement('div'); right.className='flex items-center gap-2'; right.appendChild(snooze); right.appendChild(del);
  li.appendChild(right);
  return li;
}

async function onAddTodo() {
  const input = document.getElementById('todoInput');
  const text = (input.value || '').trim();
  if (!text) return;
  const dk = dateKey(currentDay);
  const { todosByDate = {} } = await chrome.storage.local.get('todosByDate');
  const now = Date.now();
  const list = Array.isArray(todosByDate[dk]) ? todosByDate[dk] : [];
  const next = [...list, { id: now, text, completed: false, createdAt: now, updatedAt: now }];
  todosByDate[dk] = next;
  await chrome.storage.local.set({ todosByDate });
  input.value = '';
  loadTodos();
}

async function toggleTodo(id) {
  const dk = dateKey(currentDay);
  const { todosByDate = {} } = await chrome.storage.local.get('todosByDate');
  const list = Array.isArray(todosByDate[dk]) ? todosByDate[dk] : [];
  const next = list.map((t) => {
    if (t.id !== id) return t;
    const completed = !t.completed;
    return { ...t, completed, updatedAt: Date.now(), completedAt: completed ? Date.now() : null };
  });
  todosByDate[dk] = next; await chrome.storage.local.set({ todosByDate });
  loadTodos();
}

async function removeTodo(id) {
  const dk = dateKey(currentDay);
  const { todosByDate = {} } = await chrome.storage.local.get('todosByDate');
  const list = Array.isArray(todosByDate[dk]) ? todosByDate[dk] : [];
  const next = list.filter((t) => t.id !== id);
  todosByDate[dk] = next; await chrome.storage.local.set({ todosByDate });
  loadTodos();
}

async function postponeTodo(id) {
  const dk = dateKey(currentDay);
  const nextDate = new Date(currentDay); nextDate.setDate(nextDate.getDate()+1); const dkNext = dateKey(nextDate);
  const { todosByDate = {} } = await chrome.storage.local.get('todosByDate');
  const list = Array.isArray(todosByDate[dk]) ? todosByDate[dk] : [];
  const idx = list.findIndex(t => t.id === id); if (idx === -1) return;
  const [item] = list.splice(idx,1); item.updatedAt = Date.now();
  const dest = Array.isArray(todosByDate[dkNext]) ? todosByDate[dkNext] : [];
  todosByDate[dk] = list; todosByDate[dkNext] = [...dest, item];
  await chrome.storage.local.set({ todosByDate });
  loadTodos();
}

async function migrateTodosIfNeeded() {
  const { todos = null, todosByDate = null } = await chrome.storage.local.get(['todos','todosByDate']);
  if (todos && !todosByDate) {
    const dk = dateKey(new Date());
    await chrome.storage.local.set({ todosByDate: { [dk]: todos } });
    await chrome.storage.local.remove('todos');
  }
}

async function renderDaySummary() {
  const el = document.getElementById('daySummary'); if (!el) return;
  const dk = dateKey(currentDay);
  const { breakHistory = [] } = await chrome.storage.local.get('breakHistory');
  const rows = breakHistory
    .filter((b) => { const ts = Date.parse(b.timestamp || 0); return dateKey(new Date(ts)) === dk; })
    .filter((b) => b.completed);
  if (!rows.length) { el.textContent = '오늘 완료된 세션 없음'; return; }
  // 최근 순으로 정렬
  rows.sort((a, b) => (Date.parse(b.timestamp || 0)) - (Date.parse(a.timestamp || 0)));
  const blocks = rows.map((item) => {
    const w = item.workDuration, r = item.duration;
    const label = (w===25&&r===5) ? '25/5' : (w===50&&r===10) ? '50/10' : (w===15&&r===3) ? '15/3' : (w===1&&r===1) ? '1/1' : `${w||'-'}/${r}`;
    const t = new Date(item.workEndTs || (Date.parse(item.timestamp||0) - (item.duration||0)*60000));
    let h = t.getHours(); const mm = String(t.getMinutes()).padStart(2,'0'); const ampm = h>=12?'PM':'AM'; h = h%12; if (h===0) h=12; const hh12 = String(h).padStart(2,'0');
    const action = item.breakName || item.breakType || '';
    const topLine = `${label} 실행 · ${action}`.trim();
    const timeLine = `${ampm} ${hh12}:${mm}`;
    return `<div class="py-1"><div>${topLine}</div><div class="text-gray-600 mt-0.5">${timeLine}</div></div><div class="border-t border-gray-200"></div>`;
  });
  el.innerHTML = blocks.join('');
}

// 브레이크 선택 카드 관련 함수들
async function initBreakSelectionCard() {
  const collapsed = document.getElementById('breakSelectionCollapsed');
  const expanded = document.getElementById('breakSelectionExpanded');
  const closeBtn = document.getElementById('breakSelectionClose');
  const otherBtn = document.getElementById('breakOtherSuggestion');
  const skipBtn = document.getElementById('breakSkip');
  if (!collapsed || !expanded) return;
  
  // 접힘 상태 클릭 시 펼침
  collapsed.addEventListener('click', () => expandBreakSelectionCard());
  
  // 닫기 버튼
  if (closeBtn) closeBtn.addEventListener('click', () => collapseBreakSelectionCard());
  
  // 다른 제안 버튼
  if (otherBtn) otherBtn.addEventListener('click', () => loadNewBreakPage());
  
  // 건너뛰기 버튼
  if (skipBtn) skipBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'breet:skipBreak' });
    collapseBreakSelectionCard();
  });
  
  // 초기 상태 확인 및 업데이트 (타이머 버튼 클릭 시에만 표시)
  const { sessionState, prebreakPayload } = await chrome.storage.local.get(['sessionState', 'prebreakPayload']);
  // selecting 단계일 때만 표시 (WORK_ENDING에서는 자동 표시하지 않음)
  if (sessionState?.phase === 'selecting' && prebreakPayload) {
    breakSelectionPayload = prebreakPayload;
    await expandBreakSelectionCard();
  } else {
    // IDLE/WORK 중: 접힌 상태로 표시 (카드는 항상 표시)
    const card = document.getElementById('breakSelectionCard');
    if (card) {
      card.style.maxHeight = 'auto';
      card.style.opacity = '1';
      card.classList.remove('expanded');
      const collapsed = document.getElementById('breakSelectionCollapsed');
      const expanded = document.getElementById('breakSelectionExpanded');
      if (collapsed) collapsed.style.display = 'block';
      if (expanded) expanded.classList.add('hidden');
    }
  }
}

function toggleBreakSelectionCard(forceExpand) {
  const card = document.getElementById('breakSelectionCard');
  if (!card) return;
  if (forceExpand || !card.classList.contains('expanded')) {
    expandBreakSelectionCard();
  } else {
    collapseBreakSelectionCard();
  }
}

async function expandBreakSelectionCard(payload) {
  const card = document.getElementById('breakSelectionCard');
  const collapsed = document.getElementById('breakSelectionCollapsed');
  const expanded = document.getElementById('breakSelectionExpanded');
  if (!card || !collapsed || !expanded) return;
  
  // 페이로드가 있으면 세션 ID 추출 및 저장
  if (payload) {
    currentBreakSessionId = payload.sessionId || null;
    breakSelectionPayload = payload;
    // breakMinutes 명확히 저장
    if (payload.breakMinutes) {
      breakSelectionPayload.breakMinutes = payload.breakMinutes;
    }
    // storage에도 저장 (세션 ID가 있는 경우)
    if (payload.sessionId) {
      await chrome.storage.local.set({ prebreakPayload: payload });
    }
  } else {
    // 페이로드가 없으면 storage에서 가져오기
    const { prebreakPayload, sessionState } = await chrome.storage.local.get(['prebreakPayload', 'sessionState']);
    if (prebreakPayload) {
      breakSelectionPayload = prebreakPayload;
      // 세션 ID 추출 (가장 최근 것)
      const keys = await chrome.storage.local.get(null);
      let latestTs = 0;
      for (const key in keys) {
        if (key.startsWith('prebreakMeta_')) {
          const sid = key.replace('prebreakMeta_', '');
          const ts = parseInt(sid.split('_')[0]) || 0;
          if (ts > latestTs) {
            latestTs = ts;
            currentBreakSessionId = sid;
          }
        }
      }
    }
  }
  
  // 카드 표시 및 펼침
  card.style.maxHeight = '85vh';
  card.style.opacity = '1';
  card.classList.add('expanded');
  collapsed.style.display = 'none';
  expanded.classList.remove('hidden');
  
  // 후보 로딩
  await loadBreakCandidates();
  renderBreakCandidates();
  // 버튼 상태 업데이트
  await updateBreakButtons();
  // 접근성: 첫 추천에 포커스 이동
  setTimeout(() => {
    const first = document.querySelector('#breakCandidateList > div');
    if (first) { first.setAttribute('tabindex','0'); first.focus(); }
    const live = document.getElementById('statusLive');
    if (live) live.textContent = '집중 종료, 휴식 추천이 표시됩니다';
  }, 0);
}

function collapseBreakSelectionCard() {
  const card = document.getElementById('breakSelectionCard');
  const collapsed = document.getElementById('breakSelectionCollapsed');
  const expanded = document.getElementById('breakSelectionExpanded');
  if (!card || !collapsed || !expanded) return;
  
  card.style.maxHeight = '0';
  card.style.opacity = '0';
  card.classList.remove('expanded');
  collapsed.style.display = 'block';
  expanded.classList.add('hidden');
}

async function loadBreakCandidates() {
  try {
    const candKey = currentBreakSessionId ? `pendingBreakCandidates_${currentBreakSessionId}` : 'pendingBreakCandidates';
    const allKey = currentBreakSessionId ? `allBreakCandidates_${currentBreakSessionId}` : 'allBreakCandidates';
    const { [candKey]: pendingCandidates = [], [allKey]: persisted = [] } = await chrome.storage.local.get([candKey, allKey]);
    
    if (Array.isArray(persisted) && persisted.length >= 3) {
      allBreakCandidates = persisted;
      currentBreakPage = 0;
      return;
    }
    
    if (pendingCandidates && pendingCandidates.length >= 3) {
      allBreakCandidates = pendingCandidates.slice(0, 3);
      currentBreakPage = 0;
      const setObj = {}; setObj[allKey] = allBreakCandidates;
      await chrome.storage.local.set(setObj);
      return;
    }
    
    // 후보가 없으면 새로 요청
    await loadNewBreakPage();
  } catch (e) {
    console.error('[BreakSelection] loadBreakCandidates error', e);
  }
}

function renderBreakCandidates() {
  const list = document.getElementById('breakCandidateList');
  const countEl = document.getElementById('breakCandidateCount');
  const remainingEl = document.getElementById('breakRemainingCount');
  if (!list) return;
  
  const startIdx = currentBreakPage * 3;
  const pageItems = allBreakCandidates.slice(startIdx, startIdx + 3);
  
  list.innerHTML = '';
  if (!pageItems.length) {
    list.innerHTML = '<div class="text-center text-gray-500 py-8">추천을 불러오는 중...</div>';
    return;
  }
  
  pageItems.forEach((c, i) => {
    const absIdx = startIdx + i;
    const isSelected = absIdx === selectedBreakIndex;
    const div = document.createElement('div');
    // 높이를 2/3로 줄임: p-4 (16px) -> py-2.5 px-3 (10px 12px), min-h-[44px] -> min-h-[30px]
    div.className = `py-2.5 px-3 rounded-lg cursor-pointer transition-colors min-h-[30px] flex items-center ${isSelected ? 'bg-blue-500 text-white border-2 border-blue-600' : 'bg-white border border-gray-200 hover:border-blue-300'}`;
    div.addEventListener('click', async () => {
      selectedBreakIndex = absIdx;
      await onBreakCandidateSelected();
    });
    
    const content = document.createElement('div');
    content.className = 'flex-1';
    // 폰트 크기는 휴식 추천 제목과 동일하게 text-base 유지
    content.innerHTML = `<div class="font-semibold text-base mb-0.5">${c?.name || ''}</div><div class="text-xs ${isSelected ? 'text-blue-100' : 'text-gray-500'}">${c?.howTo || ''}</div>`;
    div.appendChild(content);
    
    list.appendChild(div);
  });
  
  // 후보 개수 업데이트
  if (countEl) countEl.textContent = `(${allBreakCandidates.length})`;
  
  // 남은 제안 횟수 업데이트 (비동기로 처리)
  if (remainingEl) {
    const metaKey = currentBreakSessionId ? `prebreakMeta_${currentBreakSessionId}` : 'prebreakMeta';
    chrome.storage.local.get([metaKey, 'prebreakMeta'], async ({ [metaKey]: sessionMeta = null, prebreakMeta = { otherUsed: 0, maxOther: 4 } }) => {
      // 세션별 메타 우선 사용
      const meta = sessionMeta || prebreakMeta || { otherUsed: 0, maxOther: 4 };
      const used = meta.otherUsed || 0;
      const max = meta.maxOther || 4;
      remainingEl.textContent = `${max - used}/${max}`;
    });
  }
}

async function loadNewBreakPage() {
  if (isLoadingBreaks) return;
  isLoadingBreaks = true;
  await updateBreakButtons();
  
  try {
    const excludeIds = allBreakCandidates.map(c => c.id);
    const metaKey = currentBreakSessionId ? `prebreakMeta_${currentBreakSessionId}` : 'prebreakMeta';
    const { [metaKey]: meta = {} } = await chrome.storage.local.get(metaKey);
    // breakMinutes 우선순위: meta > breakSelectionPayload > 5
    const breakMinutes = meta.breakMinutes || breakSelectionPayload?.breakMinutes || 5;
    
    const reqPayload = currentBreakSessionId ? { sessionId: currentBreakSessionId, excludeIds, breakMinutes } : { breakMinutes, excludeIds };
    
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'breet:requestNewBreaks', payload: reqPayload }, (resp) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        if (!resp || !resp.ok) {
          if (resp?.error === 'limit_reached') {
            return reject(new Error('limit_reached'));
          }
          return reject(new Error(resp?.error || 'failed'));
        }
        resolve();
      });
    });
    
    const candKey = currentBreakSessionId ? `pendingBreakCandidates_${currentBreakSessionId}` : 'pendingBreakCandidates';
    const allKey = currentBreakSessionId ? `allBreakCandidates_${currentBreakSessionId}` : 'allBreakCandidates';
    const { [candKey]: pendingCandidates = [] } = await chrome.storage.local.get(candKey);
    
    if (!Array.isArray(pendingCandidates) || pendingCandidates.length < 3) {
      throw new Error('Not enough new candidates');
    }
    
    allBreakCandidates = [...allBreakCandidates, ...pendingCandidates.slice(0, 3)];
    const setObj = {}; setObj[allKey] = allBreakCandidates;
    await chrome.storage.local.set(setObj);
    
    currentBreakPage++;
    renderBreakCandidates();
  } catch (e) {
    console.error('[BreakSelection] loadNewBreakPage error', e);
    if (e.message === 'limit_reached') {
      alert('더 이상 새로운 제안을 받을 수 없습니다. (최대 4회)');
    } else {
      alert('새로운 추천을 불러오는데 실패했습니다.');
    }
  } finally {
    isLoadingBreaks = false;
    await updateBreakButtons();
  }
}

async function updateBreakButtons() {
  const otherBtn = document.getElementById('breakOtherSuggestion');
  const confirmBtn = document.getElementById('breakSelectionConfirm');
  if (otherBtn) {
    if (isLoadingBreaks) {
      otherBtn.textContent = '생성 중...';
      otherBtn.disabled = true;
    } else {
      // 남은 제안 횟수 확인 (세션별 메타 우선)
      const metaKey = currentBreakSessionId ? `prebreakMeta_${currentBreakSessionId}` : 'prebreakMeta';
      const { [metaKey]: sessionMeta = null } = await chrome.storage.local.get(metaKey);
      const { prebreakMeta = { otherUsed: 0, maxOther: 4, breakMinutes: 5 } } = await chrome.storage.local.get('prebreakMeta');
      // 세션별 메타 우선 사용, 없으면 전역 메타 사용
      const meta = sessionMeta || prebreakMeta || { otherUsed: 0, maxOther: 4, breakMinutes: 5 };
      const used = meta.otherUsed || 0;
      const max = meta.maxOther || 4;
      if (used >= max) {
        otherBtn.textContent = '더 이상 제안 없음';
        otherBtn.disabled = true;
      } else {
        otherBtn.textContent = '다른 제안 받기';
        otherBtn.disabled = false;
      }
    }
  }
}

// 후보 선택 시 타이머 시작
async function onBreakCandidateSelected() {
  if (allBreakCandidates.length === 0 || selectedBreakIndex < 0 || selectedBreakIndex >= allBreakCandidates.length) {
    // 첫 선택이면 첫 번째 후보를 선택
    if (allBreakCandidates.length > 0) {
      selectedBreakIndex = 0;
    } else {
      return;
    }
  }
  
  const selected = allBreakCandidates[selectedBreakIndex];
  
  // 선택된 브레이크 저장
  const pendingKey = currentBreakSessionId ? `pendingBreak_${currentBreakSessionId}` : 'pendingBreak';
  await chrome.storage.local.set({ [pendingKey]: selected, pendingBreak: selected });
  
  // 세션 상태 확인 (타이머 버튼 클릭 시에만 카드가 표시되므로 selecting 단계만 처리)
  const { sessionState } = await chrome.storage.local.get('sessionState');
  
  if (sessionState?.phase === 'selecting' && breakSelectionPayload) {
    // SELECTING 단계: 작업 타이머 시작
    await chrome.runtime.sendMessage({ type: 'breet:startTimer', payload: breakSelectionPayload });
  }
  
  // 카드 닫기
  collapseBreakSelectionCard();
}


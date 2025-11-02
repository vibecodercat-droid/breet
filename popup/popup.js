import { isAuthenticated, loginWithGoogle, logout, loadAuth } from '../lib/auth.js';
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
  await renderDailyAffirmation();

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
      // 타이머 모드 클릭 시 즉시 인라인 카드로 휴식 추천 표시
      const preset = MODE_PRESETS[selectedMode] || MODE_PRESETS.pomodoro;
      const payload = { mode: selectedMode, workMinutes: preset.work, breakMinutes: preset.rest };
      // 백그라운드에 추천 요청 (완료 후 background에서 메시지로 카드 펼침 요청)
      chrome.runtime.sendMessage({ type: 'breet:prebreakSelect', payload }, async (response) => {
        // 추천 완료 후 약간의 지연을 두고 카드 펼침 (storage 동기화 대기)
        setTimeout(async () => {
          const { prebreakPayload, sessionState } = await chrome.storage.local.get(['prebreakPayload', 'sessionState']);
          if (prebreakPayload) {
            // 세션 ID 찾기
            const keys = await chrome.storage.local.get(null);
            let foundSessionId = null;
            for (const key in keys) {
              if (key.startsWith('prebreakMeta_')) {
                foundSessionId = key.replace('prebreakMeta_', '');
                break;
              }
            }
            await expandBreakSelectionCard({ ...prebreakPayload, sessionId: foundSessionId });
          }
        }, 200);
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
    chrome.runtime.sendMessage({ type: 'breet:prebreakSelect', payload }, async () => {
      // 추천 완료 후 약간의 지연을 두고 카드 펼침 (storage 동기화 대기)
      setTimeout(async () => {
        const { prebreakPayload, sessionState } = await chrome.storage.local.get(['prebreakPayload', 'sessionState']);
        if (prebreakPayload) {
          // 세션 ID 찾기
          const keys = await chrome.storage.local.get(null);
          let foundSessionId = null;
          for (const key in keys) {
            if (key.startsWith('prebreakMeta_')) {
              foundSessionId = key.replace('prebreakMeta_', '');
              break;
            }
          }
          await expandBreakSelectionCard({ ...prebreakPayload, sessionId: foundSessionId });
        }
      }, 200);
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
      expandBreakSelectionCard(message.payload).then(() => {
        if (_sendResponse) _sendResponse({ ok: true });
      }).catch(() => {
        if (_sendResponse) _sendResponse({ ok: false });
      });
      return true;
    }
    return false;
  });
  
  // 세션 상태 구독: WORK_ENDING일 때 자동 펼침
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.sessionState?.newValue) {
      const newPhase = changes.sessionState.newValue.phase;
      if (newPhase === 'work_ending') {
        setTimeout(() => expandBreakSelectionCard(), 100);
      } else if (newPhase === 'break' || newPhase === 'idle') {
        collapseBreakSelectionCard();
      }
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
    if (!b.classList.contains('bg-gray-200')) b.classList.add('bg-gray-200');
  });
  if (mode) {
    const btn = document.querySelector(`.mode-btn[data-mode="${mode}"]`);
    if (btn) {
      btn.classList.remove('bg-gray-200');
      btn.classList.add('bg-blue-500','text-white');
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
  const { userProfile = null } = await chrome.storage.local.get('userProfile');
  const card = document.getElementById('onboardingCard');
  if (!userProfile || !userProfile.onboardingCompleted) {
    card.classList.add('hidden');
    return;
  }
  // Chips helper
  const chip = (label) => {
    const el = document.createElement('span');
    el.className = 'px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-700 border border-transparent cursor-pointer select-none';
    el.textContent = label;
    return el;
  };
  // Work patterns
  const workBox = document.getElementById('onbWork');
  workBox.innerHTML = '';
  const workAll = ['coding','writing','design','meeting'];
  const WORK_LABELS = { coding: '코딩', writing: '문서작성', design: '디자인', meeting: '미팅' };
  const workSelected = new Set(userProfile.workPatterns || []);
  workAll.forEach((w) => {
    const el = chip(WORK_LABELS[w] || w);
    if (workSelected.has(w)) el.classList.add('bg-blue-50','text-blue-700','border-blue-300');
    el.dataset.category = 'workPatterns';
    el.dataset.value = w;
    el.addEventListener('click', () => onToggleOnboardingChip(el));
    workBox.appendChild(el);
  });
  // Health concerns
  const healthBox = document.getElementById('onbHealth');
  healthBox.innerHTML = '';
  const healthAll = ['eyeStrain','neckPain','backPain','stress'];
  const HEALTH_LABELS = { eyeStrain: '눈 피로', neckPain: '목 통증', backPain: '허리 통증', stress: '스트레스' };
  const healthSelected = new Set(userProfile.healthConcerns || []);
  healthAll.forEach((h) => {
    const el = chip(HEALTH_LABELS[h] || h);
    if (healthSelected.has(h)) el.classList.add('bg-blue-50','text-blue-700','border-blue-300');
    el.dataset.category = 'healthConcerns';
    el.dataset.value = h;
    el.addEventListener('click', () => onToggleOnboardingChip(el));
    healthBox.appendChild(el);
  });
  card.classList.remove('hidden');
}

function dateKey(d = new Date()) { const x = new Date(d); x.setHours(0,0,0,0); return x.toISOString().slice(0,10); }
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
  if (!el) return;
  const { sessionState } = await chrome.storage.local.get('sessionState');
  if (!sessionState || !sessionState.startTs || sessionState.phase === 'idle' || sessionState.phase === undefined) {
    el.textContent = '--:--';
    setControlsEnabled(!!selectedMode);
    return;
  }
  if (sessionState.phase === 'paused') {
    setControlsEnabled(true);
    const remain = Math.max(0, sessionState.remainingMs || 0);
    const mm = String(Math.floor(remain / 60000)).padStart(2, '0');
    const ss = String(Math.floor((remain % 60000) / 1000)).padStart(2, '0');
    el.textContent = `${mm}:${ss}`;
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
  const rows = breakHistory.filter(b => (new Date(b.timestamp)).toISOString().slice(0,10) === dk);
  if (!rows.length) { el.textContent = '오늘 기록 없음'; return; }
  const last = rows[rows.length - 1];
  const label = (() => {
    const w = last.workDuration, r = last.duration;
    if (w===25 && r===5) return '25/5';
    if (w===50 && r===10) return '50/10';
    if (w===15 && r===3) return '15/3';
    if (w===1 && r===1) return '1/1';
    return `${w||'-'}/${r}`;
  })();
  const t = new Date(last.workEndTs || (new Date(last.timestamp).getTime() - (last.duration||0)*60000));
  let h = t.getHours();
  const mm = String(t.getMinutes()).padStart(2,'0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12; const hh12 = String(h).padStart(2,'0');
  const action = last.breakName || last.breakType || '';
  el.textContent = `${label} 실행 · (${action}) · ${ampm} ${hh12}:${mm}`;
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
  
  // 초기 상태 확인 및 업데이트
  const { sessionState, prebreakPayload } = await chrome.storage.local.get(['sessionState', 'prebreakPayload']);
  if (sessionState?.phase === 'work_ending' || sessionState?.phase === 'selecting') {
    if (prebreakPayload) breakSelectionPayload = prebreakPayload;
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
    // storage에도 저장 (세션 ID가 있는 경우)
    if (payload.sessionId) {
      await chrome.storage.local.set({ prebreakPayload: payload });
    }
  } else {
    // 페이로드가 없으면 storage에서 가져오기
    const { prebreakPayload, sessionState } = await chrome.storage.local.get(['prebreakPayload', 'sessionState']);
    if (prebreakPayload) {
      breakSelectionPayload = prebreakPayload;
      // 세션 ID 추출 (storage에서 가져온 경우 세션 ID를 찾아야 함)
      const keys = await chrome.storage.local.get(null);
      for (const key in keys) {
        if (key.startsWith('prebreakMeta_')) {
          currentBreakSessionId = key.replace('prebreakMeta_', '');
          break;
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
    div.className = `p-4 rounded-lg cursor-pointer transition-colors min-h-[44px] flex items-center ${isSelected ? 'bg-blue-500 text-white border-2 border-blue-600' : 'bg-white border border-gray-200 hover:border-blue-300'}`;
    div.addEventListener('click', async () => {
      selectedBreakIndex = absIdx;
      await onBreakCandidateSelected();
    });
    
    const content = document.createElement('div');
    content.className = 'flex-1';
    content.innerHTML = `<div class="font-semibold text-base mb-1">${c?.name || ''}</div><div class="text-xs ${isSelected ? 'text-blue-100' : 'text-gray-500'}">${c?.howTo || ''}</div>`;
    div.appendChild(content);
    
    list.appendChild(div);
  });
  
  // 후보 개수 업데이트
  if (countEl) countEl.textContent = `(${allBreakCandidates.length})`;
  
  // 남은 제안 횟수 업데이트
  if (remainingEl) {
    const metaKey = currentBreakSessionId ? `prebreakMeta_${currentBreakSessionId}` : 'prebreakMeta';
    chrome.storage.local.get([metaKey], ({ [metaKey]: meta = {} }) => {
      const used = meta.otherUsed || 0;
      const max = meta.maxOther || 4;
      remainingEl.textContent = `${max - used}/${max}`;
    });
  }
}

async function loadNewBreakPage() {
  if (isLoadingBreaks) return;
  isLoadingBreaks = true;
  updateBreakButtons();
  
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
    updateBreakButtons();
  }
}

function updateBreakButtons() {
  const otherBtn = document.getElementById('breakOtherSuggestion');
  const confirmBtn = document.getElementById('breakSelectionConfirm');
  if (otherBtn) {
    if (isLoadingBreaks) {
      otherBtn.textContent = '생성 중...';
      otherBtn.disabled = true;
    } else {
      // 남은 제안 횟수 확인
      const metaKey = currentBreakSessionId ? `prebreakMeta_${currentBreakSessionId}` : 'prebreakMeta';
      chrome.storage.local.get([metaKey], ({ [metaKey]: meta = {} }) => {
        const used = meta.otherUsed || 0;
        const max = meta.maxOther || 4;
        if (used >= max) {
          otherBtn.textContent = '더 이상 제안 없음';
          otherBtn.disabled = true;
        } else {
          otherBtn.textContent = '다른 제안 받기';
          otherBtn.disabled = false;
        }
      });
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
  
  // 세션 상태 확인
  const { sessionState } = await chrome.storage.local.get('sessionState');
  
  if (sessionState?.phase === 'work_ending') {
    // WORK_ENDING 단계: 브레이크 타이머만 시작
    await chrome.runtime.sendMessage({ type: 'breet:startBreakTimer' });
  } else if (sessionState?.phase === 'selecting' && breakSelectionPayload) {
    // SELECTING 단계: 작업 타이머 시작
    await chrome.runtime.sendMessage({ type: 'breet:startTimer', payload: breakSelectionPayload });
  }
  
  // 카드 닫기
  collapseBreakSelectionCard();
}


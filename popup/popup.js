import { isAuthenticated, loginWithGoogle, logout, loadAuth } from '../lib/auth.js';
const MODE_PRESETS = {
  pomodoro: { work: 25, rest: 5 },
  long: { work: 50, rest: 10 },
  short: { work: 15, rest: 3 },
};

let selectedMode = 'pomodoro';

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

  document.getElementById('loginBtn').addEventListener('click', async () => {
    try { await loginWithGoogle(); } catch (e) { alert('로그인 실패: ' + e.message); }
    refreshAuthUI();
  });
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await logout();
    refreshAuthUI();
  });

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedMode = btn.dataset.mode;
      document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('bg-blue-500','text-white'));
      btn.classList.add('bg-blue-500','text-white');
    });
  });

  document.getElementById('startBtn').addEventListener('click', onStart);
  document.getElementById('stopBtn').addEventListener('click', onStop);
  document.getElementById('addTodo').addEventListener('click', onAddTodo);
  loadTodos();
  refreshCountdown();
  setInterval(refreshCountdown, 1000);
});

async function refreshAuthUI() {
  const ok = await isAuthenticated();
  const status = document.getElementById('authStatus');
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
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

function onStart() {
  const preset = MODE_PRESETS[selectedMode] || MODE_PRESETS.pomodoro;
  chrome.runtime.sendMessage({
    type: 'breet:startTimer',
    payload: { mode: selectedMode, workMinutes: preset.work, breakMinutes: preset.rest }
  });
}

function onStop() {
  chrome.runtime.sendMessage({ type: 'breet:stopTimer' });
}

async function refreshCountdown() {
  const el = document.getElementById('countdown');
  const { sessionState } = await chrome.storage.local.get('sessionState');
  if (!sessionState || !sessionState.startTs || sessionState.mode === 'idle') {
    el.textContent = '--:--';
    return;
  }
  const endTs = sessionState.startTs + sessionState.workDuration * 60 * 1000;
  const remain = Math.max(0, endTs - Date.now());
  const mm = String(Math.floor(remain / 60000)).padStart(2, '0');
  const ss = String(Math.floor((remain % 60000) / 1000)).padStart(2, '0');
  el.textContent = `${mm}:${ss}`;
}

async function loadTodos() {
  const { todos = [] } = await chrome.storage.local.get('todos');
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
  const del = document.createElement('button');
  del.className = 'text-xs text-gray-600 hover:text-red-600';
  del.textContent = '삭제';
  del.addEventListener('click', () => removeTodo(todo.id));
  li.appendChild(left);
  li.appendChild(del);
  return li;
}

async function onAddTodo() {
  const input = document.getElementById('todoInput');
  const text = (input.value || '').trim();
  if (!text) return;
  const { todos = [] } = await chrome.storage.local.get('todos');
  const now = Date.now();
  const next = [...todos, { id: now, text, completed: false, createdAt: now, updatedAt: now }];
  await chrome.storage.local.set({ todos: next });
  input.value = '';
  loadTodos();
}

async function toggleTodo(id) {
  const { todos = [] } = await chrome.storage.local.get('todos');
  const next = todos.map((t) => {
    if (t.id !== id) return t;
    const completed = !t.completed;
    return { ...t, completed, updatedAt: Date.now(), completedAt: completed ? Date.now() : null };
  });
  await chrome.storage.local.set({ todos: next });
  loadTodos();
}

async function removeTodo(id) {
  const { todos = [] } = await chrome.storage.local.get('todos');
  const next = todos.filter((t) => t.id !== id);
  await chrome.storage.local.set({ todos: next });
  loadTodos();
}


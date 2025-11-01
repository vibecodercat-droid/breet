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
  // Routine
  const r = userProfile.routine || { type: 'pomodoro', workDuration: 25, breakDuration: 5 };
  const routineStr = `루틴: ${r.type} (${r.workDuration}/${r.breakDuration})`;
  document.getElementById('onbRoutine').textContent = routineStr;
  // Schedule
  const s = userProfile.schedule || { startTime: '09:00', endTime: '18:00', includeWeekends: false };
  const schStr = `알림 시간대: ${s.startTime} ~ ${s.endTime} · ${s.includeWeekends ? '주말 포함' : '주말 제외'}`;
  document.getElementById('onbSchedule').textContent = schStr;
  // Chips helper
  const chip = (txt) => {
    const el = document.createElement('span');
    el.className = 'px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-700';
    el.textContent = txt;
    return el;
  };
  // Work patterns
  const workBox = document.getElementById('onbWork');
  workBox.innerHTML = '';
  (userProfile.workPatterns || []).forEach((w) => workBox.appendChild(chip(w)));
  // Health concerns
  const healthBox = document.getElementById('onbHealth');
  healthBox.innerHTML = '';
  (userProfile.healthConcerns || []).forEach((h) => healthBox.appendChild(chip(h)));
  card.classList.remove('hidden');
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


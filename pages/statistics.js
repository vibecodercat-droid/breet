import { toCsvAndDownload } from "../lib/csv.js";
import { groupByWeekdayCompletion } from "../lib/stats-manager.js";

function startOfLocalDay(ts = Date.now()) {
  const d = new Date(ts);
  d.setHours(0,0,0,0);
  return d.getTime();
}

function isSameLocalDay(tsA, tsB) {
  return startOfLocalDay(tsA) === startOfLocalDay(tsB);
}

function dateKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

// 세션(브레이크) 완료 기준 통계
async function refreshSessionStats() {
  const { breakHistory = [] } = await chrome.storage.local.get('breakHistory');
  const today = breakHistory.filter((b) => isSameLocalDay(Date.parse(b.timestamp || 0), Date.now()));
  const done = today.filter((b) => b.completed).length;
  const count = today.length; // 오늘 쉼 횟수 (브레이크 수행 횟수)
  const rate = count ? Math.round((done / count) * 100) : 0;
  document.getElementById('sessionDone').textContent = String(done);
  document.getElementById('sessionCount').textContent = String(count);
  document.getElementById('sessionRate').textContent = `${rate}%`;
}

// 투두리스트 기준 통계
async function refreshTodoStats() {
  const dk = dateKey();
  const { todosByDate = {} } = await chrome.storage.local.get('todosByDate');
  const todos = Array.isArray(todosByDate[dk]) ? todosByDate[dk] : [];
  const done = todos.filter((t) => t.completed).length;
  const total = todos.length;
  const rate = total ? Math.round((done / total) * 100) : 0;
  document.getElementById('todoDone').textContent = String(done);
  document.getElementById('todoTotal').textContent = String(total);
  document.getElementById('todoRate').textContent = `${rate}%`;
}

// 주간 막대그래프 (세션 + 투두 분리)
async function renderWeekly() {
  const { breakHistory = [], todosByDate = {} } = await chrome.storage.local.get(['breakHistory', 'todosByDate']);
  
  // 세션 기준 주간 통계
  const sessionWeekly = groupByWeekdayCompletion(breakHistory);
  const sessionData = sessionWeekly.map(w => Math.round((w.rate || 0) * 100));
  
  // 투두 기준 주간 통계
  const todoWeekly = Array.from({ length: 7 }, () => ({ total: 0, completed: 0 }));
  for (const [dateKey, todos] of Object.entries(todosByDate)) {
    if (!Array.isArray(todos)) continue;
    const d = new Date(dateKey);
    const dayOfWeek = d.getDay();
    todos.forEach(todo => {
      todoWeekly[dayOfWeek].total += 1;
      if (todo.completed) todoWeekly[dayOfWeek].completed += 1;
    });
  }
  const todoData = todoWeekly.map(w => w.total ? Math.round((w.completed / w.total) * 100) : 0);
  
  const labels = ['일','월','화','수','목','금','토'];
  const ctx = document.getElementById('weeklyChart').getContext('2d');
  
  // 기존 차트가 있으면 제거
  if (window.weeklyChartInstance) {
    window.weeklyChartInstance.destroy();
  }
  
  window.weeklyChartInstance = new window.Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '세션 완료율',
          data: sessionData,
          backgroundColor: 'rgba(59, 130, 246, 0.6)',
          borderColor: 'rgba(59, 130, 246, 1)',
          borderWidth: 1
        },
        {
          label: '투두 완료율',
          data: todoData,
          backgroundColor: 'rgba(34, 197, 94, 0.6)',
          borderColor: 'rgba(34, 197, 94, 1)',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: {
            callback: function(value) {
              return value + '%';
            }
          }
        }
      },
      plugins: {
        legend: {
          display: true,
          position: 'top'
        }
      }
    }
  });
}

// 세션 출석 캘린더
async function renderAttendanceCalendar() {
  const { breakHistory = [] } = await chrome.storage.local.get('breakHistory');
  const calendar = document.getElementById('attendanceCalendar');
  calendar.innerHTML = '';
  
  // 오늘로부터 최근 30일
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  
  // 각 날짜별 세션 완료 여부 계산
  const attendanceMap = new Map();
  for (const b of breakHistory) {
    const d = new Date(b.timestamp || 0);
    const key = dateKey(d);
    if (!attendanceMap.has(key)) {
      attendanceMap.set(key, false);
    }
    if (b.completed) {
      attendanceMap.set(key, true);
    }
  }
  
  // 요일 헤더
  const dayLabels = ['일', '월', '화', '수', '목', '금', '토'];
  dayLabels.forEach(label => {
    const header = document.createElement('div');
    header.className = 'text-xs font-semibold text-gray-600 text-center';
    header.textContent = label;
    calendar.appendChild(header);
  });
  
  // 각 날짜에 대해 빈 칸 또는 데이터 추가 (첫 번째 날의 요일에 맞춰 시작)
  const firstDay = days[0].getDay();
  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement('div');
    calendar.appendChild(empty);
  }
  
  // 날짜 셀
  days.forEach((d) => {
    const key = dateKey(d);
    const hasSession = attendanceMap.has(key);
    const completed = attendanceMap.get(key) || false;
    const isToday = dateKey(d) === dateKey();
    
    const cell = document.createElement('div');
    cell.className = `h-8 w-8 rounded text-xs flex items-center justify-center ${
      isToday ? 'ring-2 ring-blue-500' : ''
    } ${
      completed ? 'bg-blue-500 text-white' : 
      hasSession ? 'bg-gray-300' : 
      'bg-gray-100'
    }`;
    cell.textContent = d.getDate();
    cell.title = `${key}: ${completed ? '완료' : hasSession ? '시작' : '없음'}`;
    calendar.appendChild(cell);
  });
}

// 실시간 업데이트 리스너
function setupRealtimeUpdates() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    
    // breakHistory 변경 시
    if (changes.breakHistory) {
      refreshSessionStats();
      renderWeekly();
      renderAttendanceCalendar();
    }
    
    // todosByDate 변경 시
    if (changes.todosByDate) {
      refreshTodoStats();
      renderWeekly();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('exportCsv').addEventListener('click', async () => {
    const { breakHistory = [] } = await chrome.storage.local.get('breakHistory');
    toCsvAndDownload(breakHistory, `breet_break_history_${new Date().toISOString().slice(0,10)}.csv`);
  });
  
  // 초기 렌더링
  refreshSessionStats();
  refreshTodoStats();
  renderWeekly();
  renderAttendanceCalendar();
  
  // 실시간 업데이트 설정
  setupRealtimeUpdates();
});

import { toCsvAndDownload } from "../lib/csv.js";
import { groupByWeekdayCompletion } from "../lib/stats-manager.js";
import { isSameLocalDay, localDateKey, parseLocalDateKey } from "../lib/date-utils.js";

/**
 * 세션(브레이크) 완료 기준 통계 갱신
 */
async function refreshSessionStats() {
  const { breakHistory = [] } = await chrome.storage.local.get('breakHistory');
  const today = breakHistory.filter((b) => 
    isSameLocalDay(Date.parse(b.timestamp || 0), Date.now())
  );
  const done = today.filter((b) => b.completed).length;
  const count = today.length;
  const rate = count ? Math.round((done / count) * 100) : 0;
  
  const doneEl = document.getElementById('sessionDone');
  const countEl = document.getElementById('sessionCount');
  const rateEl = document.getElementById('sessionRate');
  
  if (doneEl) doneEl.textContent = String(done);
  if (countEl) countEl.textContent = String(count);
  if (rateEl) rateEl.textContent = `${rate}%`;
}

/**
 * 투두리스트 기준 통계 갱신
 */
async function refreshTodoStats() {
  const dateKey = localDateKey();
  const { todosByDate = {} } = await chrome.storage.local.get('todosByDate');
  const todos = Array.isArray(todosByDate[dateKey]) ? todosByDate[dateKey] : [];
  
  const done = todos.filter((t) => t.completed).length;
  const total = todos.length;
  const rate = total ? Math.round((done / total) * 100) : 0;
  
  const doneEl = document.getElementById('todoDone');
  const totalEl = document.getElementById('todoTotal');
  const rateEl = document.getElementById('todoRate');
  
  if (doneEl) doneEl.textContent = String(done);
  if (totalEl) totalEl.textContent = String(total);
  if (rateEl) rateEl.textContent = `${rate}%`;
}

/**
 * 주간 막대그래프 렌더링 (세션 + 투두 완료율)
 */
async function renderWeekly() {
  const { breakHistory = [], todosByDate = {} } = await chrome.storage.local.get([
    'breakHistory', 
    'todosByDate'
  ]);
  
  // 세션 기준 주간 통계
  const sessionWeekly = groupByWeekdayCompletion(breakHistory);
  const sessionData = sessionWeekly.map((w) => Math.round((w.rate || 0) * 100));
  
  // 투두 기준 주간 통계
  const todoWeekly = Array.from({ length: 7 }, () => ({ total: 0, completed: 0 }));
  for (const [dateKeyStr, todos] of Object.entries(todosByDate)) {
    if (!Array.isArray(todos)) continue;
    const ts = parseLocalDateKey(dateKeyStr);
    const dayOfWeek = new Date(ts).getDay();
    todos.forEach((todo) => {
      todoWeekly[dayOfWeek].total += 1;
      if (todo.completed) todoWeekly[dayOfWeek].completed += 1;
    });
  }
  const todoData = todoWeekly.map((w) => 
    w.total ? Math.round((w.completed / w.total) * 100) : 0
  );
  
  const canvas = document.getElementById('weeklyChart');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  // 기존 차트 업데이트 또는 새로 생성
  if (window.weeklyChartInstance) {
    window.weeklyChartInstance.data.datasets[0].data = sessionData;
    window.weeklyChartInstance.data.datasets[1].data = todoData;
    window.weeklyChartInstance.update('none');
    return;
  }
  
  window.weeklyChartInstance = new window.Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['일', '월', '화', '수', '목', '금', '토'],
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
            callback: (value) => `${value}%`
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

/**
 * 세션 출석 캘린더 렌더링 (최근 30일)
 */
async function renderAttendanceCalendar() {
  const calendar = document.getElementById('attendanceCalendar');
  if (!calendar) return;
  
  const { breakHistory = [] } = await chrome.storage.local.get('breakHistory');
  calendar.innerHTML = '';
  
  // 최근 30일 날짜 배열 생성
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    return d;
  });
  
  // 각 날짜별 세션 완료 여부 계산
  const attendanceMap = new Map();
  for (const b of breakHistory) {
    const ts = Date.parse(b.timestamp || 0);
    const key = localDateKey(ts);
    if (!attendanceMap.has(key)) {
      attendanceMap.set(key, false);
    }
    if (b.completed) {
      attendanceMap.set(key, true);
    }
  }
  
  // 요일 헤더 렌더링
  const dayLabels = ['일', '월', '화', '수', '목', '금', '토'];
  dayLabels.forEach((label) => {
    const header = document.createElement('div');
    header.className = 'h-8 w-16 text-xs font-semibold text-gray-600 flex items-center justify-center';
    header.textContent = label;
    calendar.appendChild(header);
  });
  
  // 첫 주 빈 칸 추가
  const firstDay = days[0].getDay();
  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement('div');
    empty.className = 'h-8 w-16';
    calendar.appendChild(empty);
  }
  
  // 날짜 셀 렌더링
  const todayKey = localDateKey();
  days.forEach((date) => {
    const key = localDateKey(date.getTime());
    const hasSession = attendanceMap.has(key);
    const completed = attendanceMap.get(key) || false;
    const isToday = key === todayKey;
    
    const cell = document.createElement('div');
    const bgClass = completed 
      ? 'bg-blue-500 text-white' 
      : hasSession 
      ? 'bg-gray-300' 
      : 'bg-gray-100';
    const ringClass = isToday ? 'ring-2 ring-blue-500' : '';
    
    cell.className = `h-8 w-16 rounded text-xs flex items-center justify-center ${ringClass} ${bgClass}`;
    cell.textContent = date.getDate();
    cell.title = `${key}: ${completed ? '완료' : hasSession ? '시작' : '없음'}`;
    calendar.appendChild(cell);
  });
}

/**
 * 실시간 업데이트 리스너 설정
 */
function setupRealtimeUpdates() {
  // Storage 변경 감지
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    
    if (changes.breakHistory) {
      refreshSessionStats();
      renderWeekly();
      renderAttendanceCalendar();
    }
    
    if (changes.todosByDate) {
      setTimeout(() => {
        refreshTodoStats();
        renderWeekly();
      }, 100);
    }
  });
  
  // 페이지 가시성 변경 감지
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshAllStats();
    }
  });
  
  // 페이지 포커스 감지
  window.addEventListener('focus', () => {
    refreshAllStats();
  });
}

/**
 * 모든 통계 갱신
 */
async function refreshAllStats() {
  await Promise.all([
    refreshSessionStats(),
    refreshTodoStats(),
    renderWeekly(),
    renderAttendanceCalendar()
  ]);
}

/**
 * CSV 내보내기 핸들러
 */
async function handleExportCsv() {
  const { breakHistory = [] } = await chrome.storage.local.get('breakHistory');
  const filename = `breet_break_history_${localDateKey()}.csv`;
  toCsvAndDownload(breakHistory, filename);
}

/**
 * 초기화
 */
document.addEventListener('DOMContentLoaded', () => {
  const exportBtn = document.getElementById('exportCsv');
  if (exportBtn) {
    exportBtn.addEventListener('click', handleExportCsv);
  }
  
  refreshAllStats();
  setupRealtimeUpdates();
});

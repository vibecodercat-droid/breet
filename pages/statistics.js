import { toCsvAndDownload } from "../lib/csv.js";
import { groupByWeekdayCompletion } from "../lib/stats-manager.js";
import { startOfLocalDay, isSameLocalDay, localDateKey, parseLocalDateKey } from "../lib/date-utils.js";

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
// 기준: todosByDate[YYYY-MM-DD]에서 오늘 날짜의 투두 배열
// - 오늘 완료: completed === true인 항목 수
// - 오늘 전체: 전체 투두 항목 수
// - 완료율: (완료 / 전체) * 100
async function refreshTodoStats() {
  const dk = localDateKey(); // 오늘 날짜 (YYYY-MM-DD 형식, 로컬 기준)
  const { todosByDate = {} } = await chrome.storage.local.get('todosByDate');
  
  // 디버깅: 전체 구조 확인
  console.log('[Stats] RefreshTodoStats - dateKey:', dk);
  console.log('[Stats] todosByDate keys:', Object.keys(todosByDate));
  console.log('[Stats] todosByDate[dk]:', todosByDate[dk]);
  
  const todos = Array.isArray(todosByDate[dk]) ? todosByDate[dk] : [];
  console.log('[Stats] Todos array:', todos);
  
  const done = todos.filter((t) => t.completed === true).length;
  const total = todos.length;
  const rate = total ? Math.round((done / total) * 100) : 0;
  
  console.log('[Stats] Todo stats calculated:', { dk, done, total, rate, todosCount: todos.length });
  
  const doneEl = document.getElementById('todoDone');
  const totalEl = document.getElementById('todoTotal');
  const rateEl = document.getElementById('todoRate');
  
  if (doneEl) {
    doneEl.textContent = String(done);
    console.log('[Stats] Updated todoDone element:', done);
  } else {
    console.error('[Stats] todoDone element not found!');
  }
  
  if (totalEl) {
    totalEl.textContent = String(total);
    console.log('[Stats] Updated todoTotal element:', total);
  } else {
    console.error('[Stats] todoTotal element not found!');
  }
  
  if (rateEl) {
    rateEl.textContent = `${rate}%`;
    console.log('[Stats] Updated todoRate element:', rate);
  } else {
    console.error('[Stats] todoRate element not found!');
  }
}

// 주간 막대그래프 (세션 + 투두 분리)
async function renderWeekly() {
  const { breakHistory = [], todosByDate = {} } = await chrome.storage.local.get(['breakHistory', 'todosByDate']);
  
  // 세션 기준 주간 통계
  const sessionWeekly = groupByWeekdayCompletion(breakHistory);
  const sessionData = sessionWeekly.map(w => Math.round((w.rate || 0) * 100));
  
  // 투두 기준 주간 통계
  const todoWeekly = Array.from({ length: 7 }, () => ({ total: 0, completed: 0 }));
  for (const [dateKeyStr, todos] of Object.entries(todosByDate)) {
    if (!Array.isArray(todos)) continue;
    // YYYY-MM-DD를 로컬 날짜로 파싱
    const ts = parseLocalDateKey(dateKeyStr);
    const d = new Date(ts);
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
    const ts = Date.parse(b.timestamp || 0);
    const key = localDateKey(ts);
    if (!attendanceMap.has(key)) {
      attendanceMap.set(key, false);
    }
    if (b.completed) {
      attendanceMap.set(key, true);
    }
  }
  
  // 요일 헤더 (원래 구조로 복원)
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
    const key = localDateKey(d.getTime());
    const hasSession = attendanceMap.has(key);
    const completed = attendanceMap.get(key) || false;
    const isToday = key === localDateKey();
    
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
  console.log('[Stats] Setting up real-time updates');
  
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    
    console.log('[Stats] Storage changed:', Object.keys(changes));
    console.log('[Stats] Changes details:', changes);
    
    // breakHistory 변경 시
    if (changes.breakHistory) {
      console.log('[Stats] BreakHistory changed, refreshing session stats');
      refreshSessionStats();
      renderWeekly();
      renderAttendanceCalendar();
    }
    
    // todosByDate 변경 시 (추가, 완료 토글, 삭제, 미루기 모두 포함)
    if (changes.todosByDate) {
      console.log('[Stats] TodosByDate changed, newValue:', changes.todosByDate.newValue);
      console.log('[Stats] Refreshing todo stats immediately');
      // 즉시 반영
      setTimeout(() => {
        refreshTodoStats();
        renderWeekly();
      }, 100); // 짧은 딜레이로 저장 완료 보장
    }
  });
  
  // 페이지 가시성 변경 시 새로고침 (다른 탭에서 작업한 경우)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      console.log('[Stats] Page visible, refreshing stats');
      refreshSessionStats();
      refreshTodoStats();
      renderWeekly();
      renderAttendanceCalendar();
    }
  });
  
  // 페이지 포커스 시에도 새로고침 (사용자가 다른 탭에서 투두를 완료한 경우)
  window.addEventListener('focus', () => {
    console.log('[Stats] Window focused, refreshing stats');
    refreshSessionStats();
    refreshTodoStats();
    renderWeekly();
    renderAttendanceCalendar();
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

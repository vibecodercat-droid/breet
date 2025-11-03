import { toCsvAndDownload } from "../lib/csv.js";
import { groupByWeekdayCompletion } from "../lib/stats-manager.js";
import { isSameLocalDay, localDateKey, parseLocalDateKey, startOfLocalDay } from "../lib/date-utils.js";

// 선택된 날짜 상태
let selectedDate = new Date();
selectedDate.setHours(0, 0, 0, 0);

/**
 * 선택된 날짜 표시
 */
function renderSelectedDate() {
  const dateEl = document.getElementById('selectedDate');
  if (!dateEl) return;
  
  const y = selectedDate.getFullYear();
  const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
  const d = String(selectedDate.getDate()).padStart(2, '0');
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const weekday = weekdays[selectedDate.getDay()];
  
  dateEl.textContent = `${y}.${m}.${d} (${weekday})`;
}

/**
 * 이전 날짜로 이동
 */
function goToPrevDate() {
  selectedDate.setDate(selectedDate.getDate() - 1);
  renderSelectedDate();
  refreshSessionStats();
  refreshTodoStats();
}

/**
 * 다음 날짜로 이동
 */
function goToNextDate() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(selectedDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  if (tomorrow <= today) {
    selectedDate = tomorrow;
    renderSelectedDate();
    refreshSessionStats();
    refreshTodoStats();
  }
}

/**
 * 세션(브레이크) 완료 기준 통계 갱신
 */
async function refreshSessionStats() {
  const { breakHistory = [] } = await chrome.storage.local.get('breakHistory');
  const selected = breakHistory.filter((b) => 
    isSameLocalDay(Date.parse(b.timestamp || 0), selectedDate.getTime())
  );
  const done = selected.filter((b) => b.completed).length;
  const count = selected.length;
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
  const dateKey = localDateKey(selectedDate.getTime());
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
 * 주차 정보 계산 (한국 주차 기준: 월요일 시작)
 */
function getWeekInfo(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  
  // 월요일 시작 기준으로 주의 첫날 찾기
  const dayOfWeek = d.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // 일요일이면 -6, 아니면 1-dayOfWeek
  const weekStart = new Date(d);
  weekStart.setDate(d.getDate() + diff);
  
  // 주의 마지막날 (일요일)
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  
  // 몇월 몇주차 계산
  const month = weekStart.getMonth() + 1;
  const year = weekStart.getFullYear();
  
  // 해당 월의 첫 번째 월요일 찾기
  const firstDayOfMonth = new Date(year, month - 1, 1);
  const firstMonday = new Date(firstDayOfMonth);
  const firstMondayDay = firstDayOfMonth.getDay();
  const firstMondayDiff = firstMondayDay === 0 ? 1 : 8 - firstMondayDay;
  firstMonday.setDate(1 + firstMondayDiff - 7);
  
  // 주차 계산
  const weekNumber = Math.floor((weekStart - firstMonday) / (7 * 24 * 60 * 60 * 1000)) + 1;
  
  const startStr = `${month}/${weekStart.getDate()}`;
  const endStr = `${weekEnd.getMonth() + 1}/${weekEnd.getDate()}`;
  
  return {
    text: `${year}년 ${month}월 ${weekNumber}주차 (${startStr} ~ ${endStr})`,
    start: weekStart,
    end: weekEnd
  };
}

/**
 * 주간 막대그래프 렌더링 (세션 + 투두 완료율)
 */
async function renderWeekly() {
  const { breakHistory = [], todosByDate = {} } = await chrome.storage.local.get([
    'breakHistory', 
    'todosByDate'
  ]);
  
  // 주차 정보 표시
  const weekInfo = getWeekInfo();
  const weekInfoEl = document.getElementById('weekInfo');
  if (weekInfoEl) {
    weekInfoEl.textContent = weekInfo.text;
  }
  
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
  
  const container = document.getElementById('weeklyChart');
  if (!container) return;
  const showSession = (document.getElementById('toggleSession')?.checked) !== false;
  const showTodo = (document.getElementById('toggleTodo')?.checked) !== false;

  if (window.echarts) {
    const option = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: ['세션 완료율', '투두 완료율'], selected: { '세션 완료율': showSession, '투두 완료율': showTodo } },
      grid: { left: 40, right: 20, top: 30, bottom: 30 },
      xAxis: { type: 'category', data: ['일','월','화','수','목','금','토'], axisLabel: { color: '#374151' }, axisTick: { alignWithLabel: true }, axisLine: { lineStyle: { color: '#E5E7EB' } } },
      yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%', color: '#6B7280' }, splitLine: { lineStyle: { color: '#E5E7EB' } } },
      series: [
        { name: '세션 완료율', type: 'bar', data: sessionData, itemStyle: { color: 'rgba(59,130,246,0.8)' } },
        { name: '투두 완료율', type: 'bar', data: todoData, itemStyle: { color: 'rgba(34,197,94,0.8)' } }
      ]
    };
    if (!window.weeklyEchartInstance) {
      window.weeklyEchartInstance = echarts.init(container);
    }
    window.weeklyEchartInstance.setOption(option, true);
    return;
  }

  // Fallback: Chart.js (local vendor)
  // ensure container contains a canvas for Chart.js
  if (!container.querySelector('canvas')) {
    container.innerHTML = '<canvas id="weeklyChartCanvas" height="250"></canvas>';
  }
  const canvas = document.getElementById('weeklyChartCanvas');
  const ctx = canvas.getContext('2d');
  if (window.weeklyChartInstance) {
    window.weeklyChartInstance.data.datasets[0].data = sessionData;
    window.weeklyChartInstance.data.datasets[1].data = todoData;
    window.weeklyChartInstance.data.datasets[0].hidden = !showSession;
    window.weeklyChartInstance.data.datasets[1].hidden = !showTodo;
    window.weeklyChartInstance.update('none');
    return;
  }
  window.weeklyChartInstance = new window.Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['일','월','화','수','목','금','토'],
      datasets: [
        { label: '세션 완료율', data: sessionData, backgroundColor: 'rgba(59, 130, 246, 0.6)', borderColor: 'rgba(59,130,246,1)', borderWidth: 2, hidden: !showSession },
        { label: '투두 완료율', data: todoData, backgroundColor: 'rgba(34, 197, 94, 0.6)', borderColor: 'rgba(34,197,94,1)', borderWidth: 2, hidden: !showTodo }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100, ticks: { callback: (v)=> `${v}%` } } } }
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
    cell.textContent = `${date.getMonth()+1}/${date.getDate()}`;
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
  // 인터랙티브 토글 리스너
  const ts = document.getElementById('toggleSession');
  const tt = document.getElementById('toggleTodo');
  if (ts) ts.addEventListener('change', renderWeekly);
  if (tt) tt.addEventListener('change', renderWeekly);
  // 날짜 이동 버튼 연결 및 초기 표시
  const prevBtn = document.getElementById('prevDate');
  const nextBtn = document.getElementById('nextDate');
  if (prevBtn) prevBtn.addEventListener('click', goToPrevDate);
  if (nextBtn) nextBtn.addEventListener('click', goToNextDate);
  renderSelectedDate();
  
  refreshAllStats();
  setupRealtimeUpdates();
});

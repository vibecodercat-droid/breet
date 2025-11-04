import { toCsvAndDownload } from "../lib/csv.js";
import { isSameLocalDay, localDateKey, parseLocalDateKey } from "../lib/date-utils.js";

// Chart.js 전역 래퍼: UMD 빌드에 따라 window.Chart 또는 window.Chart.Chart 형태 모두 대응
function getChartClass() {
  try {
    const ns = (typeof window !== 'undefined') ? window.Chart : undefined;
    if (!ns) return undefined;
    return ns.Chart ? ns.Chart : ns;
  } catch (_) { return undefined; }
}

function getECharts() {
  try { return (typeof window !== 'undefined') ? window.echarts : undefined; } catch (_) { return undefined; }
}

function ensureEChartContainer(canvasEl, idSuffix) {
  const parent = canvasEl.parentElement || document.body;
  const exist = parent.querySelector(`#${canvasEl.id}${idSuffix}`);
  if (exist) return exist;
  const div = document.createElement('div');
  div.id = `${canvasEl.id}${idSuffix}`;
  // 캔버스 크기 기준으로 컨테이너 사이즈 설정
  const w = canvasEl.offsetWidth || canvasEl.clientWidth || canvasEl.width || 600;
  const h = canvasEl.offsetHeight || canvasEl.clientHeight || canvasEl.height || 250;
  div.style.width = w + 'px';
  div.style.height = h + 'px';
  // 캔버스 바로 뒤에 삽입
  if (canvasEl.nextSibling) parent.insertBefore(div, canvasEl.nextSibling); else parent.appendChild(div);
  return div;
}

function getApexCharts(){ try { return (typeof window !== 'undefined') ? window.ApexCharts : undefined; } catch(_) { return undefined; } }

function ensureApexContainer(canvasEl, idSuffix) {
  const parent = canvasEl.parentElement || document.body;
  const exist = parent.querySelector(`#${canvasEl.id}${idSuffix}`);
  if (exist) return exist;
  const div = document.createElement('div');
  div.id = `${canvasEl.id}${idSuffix}`;
  const rect = canvasEl.getBoundingClientRect();
  const w = rect.width || canvasEl.width || canvasEl.clientWidth || 600;
  const h = rect.height || canvasEl.height || canvasEl.clientHeight || 250;
  div.style.width = w + 'px';
  div.style.height = h + 'px';
  div.style.display = 'block';
  div.style.minWidth = '300px';
  if (canvasEl.nextSibling) parent.insertBefore(div, canvasEl.nextSibling); else parent.appendChild(div);
  return div;
}

// 선택된 날짜 상태
let selectedDate = new Date();
selectedDate.setHours(0, 0, 0, 0);
// 호환성: 과거 코드에서 참조하던 전역(안쓰이더라도 정의해 에러 방지)
var periodMode = 'week';
var monthOffset = 0;
// window 전역에도 노출 (module 스코프 참조 이슈 대비)
try { if (typeof window !== 'undefined') { window.periodMode = window.periodMode || periodMode; window.monthOffset = window.monthOffset || monthOffset; } } catch (_) {}
// 주 네비게이션(주간 완료율/히트맵)
let weekOffset = 0;
let weeklyMode = 'week'; // 'week' | 'month' (완료율 섹션 전용)
let monthOffsetWeekly = 0; // 완료율 섹션 월간 네비 전용
// 세션 완료수 섹션 상태
let sessionMode = 'week';
let sessionWeekOffset = 0;
let sessionMonthOffset = 0;
// 브레이크 타입 분포 전용 기간/네비게이션 상태
let typeMode = 'week'; // 'week' | 'month'
let typeWeekOffset = 0;
let typeMonthOffset = 0;
// 시간대별 활동 전용 기간/네비게이션 상태
let heatMode = 'week'; // 'week' | 'month'
let heatWeekOffset = 0;
let heatMonthOffset = 0;
// 출석 달 네비게이션
let attendMonthOffset = 0;

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
  // 누적 시간 계산 (분 단위)
  const workMinTotal = selected.reduce((sum, b) => sum + (b.workDuration || 0), 0);
  const breakMinTotal = selected.reduce((sum, b) => sum + (b.duration || 0), 0);
  
  const doneEl = document.getElementById('sessionDone');
  const countEl = document.getElementById('sessionCount');
  const workEl = document.getElementById('sessionWorkTime');
  const breakEl = document.getElementById('sessionBreakTime');
  
  if (doneEl) doneEl.textContent = String(done);
  if (countEl) countEl.textContent = String(count);
  const fmt = (m)=>{ const h=Math.floor(m/60), mm=m%60; if(h>0){ return `${h}시간 ${mm}분`; } return `${mm}분`; };
  if (workEl) workEl.textContent = fmt(workMinTotal);
  if (breakEl) breakEl.textContent = fmt(breakMinTotal);
}

/**
 * 투두리스트 기준 통계 갱신
 */
async function refreshTodoStats() {
  const dateKey = localDateKey(selectedDate.getTime());
  const all = await chrome.storage.local.get(['todosByDate','todos']);
  const todosByDate = all.todosByDate || {};
  let todos = Array.isArray(todosByDate[dateKey]) ? todosByDate[dateKey] : [];
  // 폴백: 날짜별 구조가 없고 구형 'todos'만 있을 때 오늘 통계에 반영
  if ((!todos || todos.length === 0) && Array.isArray(all.todos)) {
    todos = all.todos;
  }
  
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
function getWeekInfo(date = new Date(), offset = 0) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  
  // 월요일 시작 기준으로 주의 첫날 찾기
  const dayOfWeek = d.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // 일요일이면 -6, 아니면 1-dayOfWeek
  const weekStart = new Date(d);
  weekStart.setDate(d.getDate() + diff + (offset * 7));
  
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
  
  const weekInfoEl = document.getElementById('weekInfo');
  let labels = [];
  let todoData = [];
  if (weeklyMode === 'week') {
    const weekInfo = getWeekInfo(new Date(), weekOffset);
    const startTs = weekInfo.start.getTime();
    const endTs = new Date(weekInfo.end.getFullYear(), weekInfo.end.getMonth(), weekInfo.end.getDate(), 23,59,59,999).getTime();
    if (weekInfoEl) weekInfoEl.textContent = weekInfo.text;
    labels = ['월','화','수','목','금','토','일'];
    const bucketLen = 7;
    const todoWeekly = Array.from({ length: bucketLen }, () => ({ total: 0, completed: 0 }));
    for (const [dateKeyStr, todos] of Object.entries(todosByDate)) {
      if (!Array.isArray(todos)) continue;
      const ts = parseLocalDateKey(dateKeyStr);
      if (!(ts >= startTs && ts <= endTs)) continue;
      const dayOfWeek = new Date(ts).getDay();
      const idx = (dayOfWeek === 0) ? 6 : (dayOfWeek - 1);
      todos.forEach((todo) => {
        todoWeekly[idx].total += 1;
        if (todo.completed) todoWeekly[idx].completed += 1;
      });
    }
    todoData = todoWeekly.map((w) => w.total ? Math.round((w.completed / w.total) * 100) : 0);
  } else {
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth()+monthOffsetWeekly, 1);
    const mStart = new Date(base.getFullYear(), base.getMonth(), 1);
    const mEnd = new Date(base.getFullYear(), base.getMonth()+1, 0);
    const startTs = mStart.getTime();
    const endTs = new Date(mEnd.getFullYear(), mEnd.getMonth(), mEnd.getDate(), 23,59,59,999).getTime();
    if (weekInfoEl) weekInfoEl.textContent = `${mStart.getFullYear()}년 ${mStart.getMonth()+1}월 (${mStart.getMonth()+1}/1 ~ ${mEnd.getMonth()+1}/${mEnd.getDate()})`;
    const daysInMonth = mEnd.getDate();
    labels = Array.from({length: daysInMonth}, (_,i)=> String(i+1));
    const todoMonthly = Array.from({ length: daysInMonth }, () => ({ total: 0, completed: 0 }));
    for (const [dateKeyStr, todos] of Object.entries(todosByDate)) {
      if (!Array.isArray(todos)) continue;
      const ts = parseLocalDateKey(dateKeyStr);
      if (!(ts >= startTs && ts <= endTs)) continue;
      const date = new Date(ts).getDate();
      const idx = date - 1;
      todos.forEach((todo) => {
        todoMonthly[idx].total += 1;
        if (todo.completed) todoMonthly[idx].completed += 1;
      });
    }
    todoData = todoMonthly.map((w) => w.total ? Math.round((w.completed / w.total) * 100) : 0);
  }
  const canvas = document.getElementById('weeklyChart');
  if (!canvas) return;
  const ApexChartsClass = getApexCharts();
  const ECharts = getECharts();
  const ChartClass = getChartClass();
  // ApexCharts 우선
  if (ApexChartsClass) {
    try {
      // 기존 Chart.js/ECharts 인스턴스 정리
      try { if (ChartClass && typeof ChartClass.getChart === 'function') { const prev = ChartClass.getChart(canvas); if (prev) prev.destroy(); } } catch(_) {}
      try { const ecd = document.getElementById(`${canvas.id}__ec`); if (ecd && ECharts) { const inst = ECharts.getInstanceByDom(ecd); if (inst) inst.dispose(); } } catch(_) {}
      const el = ensureApexContainer(canvas, '__apex');
      el.style.display = 'block';
      if (window.apexWeekly) { try { window.apexWeekly.destroy(); } catch(_) {} }
      const opts = {
        chart: { type: 'line', height: el.clientHeight || 250, animations: { enabled: true }, events: {
          mounted: (ctx)=>{ try{ const paths = ctx.el.querySelectorAll('.apexcharts-series path'); paths.forEach(p=>{ p.setAttribute('stroke','rgba(66,66,66,0.5)'); p.style.stroke = 'rgba(66,66,66,0.5)'; }); } catch(_){} },
          updated: (ctx)=>{ try{ const paths = ctx.el.querySelectorAll('.apexcharts-series path'); paths.forEach(p=>{ p.setAttribute('stroke','rgba(66,66,66,0.5)'); p.style.stroke = 'rgba(66,66,66,0.5)'; }); } catch(_){} }
        } },
        series: [{ name: '투두 완료율', data: todoData }],
        xaxis: { categories: labels },
        yaxis: { min: 0, max: 100, labels: { formatter: (v)=> `${Math.round(v)}%` } },
        dataLabels: { enabled: true, formatter: (v)=> `${v}%`, offsetY: -8, style: { fontSize: '11px', colors: ['#22c55e'] } },
        stroke: { width: 3, curve: 'smooth' },
        markers: { size: 4, colors: ['#22c55e'], strokeColors: '#d1d5db', strokeOpacity: 1, fillOpacity: 1 },
        tooltip: { enabled: true, y: { formatter: (v)=> `${v}%` } },
        grid: { borderColor: 'rgba(0,0,0,0.05)', strokeDashArray: 2 },
        colors: ['rgba(66,66,66,0.5)'],
        fill: { type: 'solid', opacity: 0 }
      };
      const chart = new ApexChartsClass(el, opts);
      chart.render();
      try { chart.resize(); } catch(_) {}
      window.apexWeekly = chart;
      canvas.style.display = 'none';
      return;
    } catch (e) { console.error('[weeklyChart][apex] init error', e); }
  }
  // ECharts 폴백
  if (ECharts) {
    try {
      // 기존 Chart.js 인스턴스 정리
      try { if (ChartClass && typeof ChartClass.getChart === 'function') { const prev = ChartClass.getChart(canvas); if (prev) prev.destroy(); } } catch(_) {}
      // 컨테이너 준비
      const ecDom = ensureEChartContainer(canvas, '__ec');
      // 이전 ECharts 인스턴스 dispose
      try { const inst = ECharts.getInstanceByDom(ecDom); if (inst) inst.dispose(); } catch(_) {}
      const instance = ECharts.init(ecDom);
      window.weeklyEChart = instance;
      const option = {
        tooltip: { trigger: 'axis' },
        grid: { left: 32, right: 16, top: 16, bottom: 24 },
        xAxis: { type: 'category', data: labels, boundaryGap: false, axisLine:{lineStyle:{color:'#94a3b8'}}, axisTick:{show:false} },
        yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' }, splitLine:{lineStyle:{color:'rgba(0,0,0,0.05)'}} },
        series: [{ name: '투두 완료율', type: 'line', data: todoData, smooth: true, symbolSize: 6, areaStyle: { opacity: 0.15 }, lineStyle: { width: 3, color: '#22c55e' }, itemStyle: { color: '#22c55e' } }]
      };
      instance.setOption(option, true);
      // 캔버스는 숨김(폴백용 유지)
      canvas.style.display = 'none';
      return;
    } catch (e) { console.error('[weeklyChart][echarts] init error', e); }
  }
  // 폴백: Chart.js
  const ctx = canvas.getContext('2d');
  if (window.weeklyChartInstance) { try { window.weeklyChartInstance.destroy(); } catch(_) {} }
  try { if (ChartClass && typeof ChartClass.getChart === 'function') { const prev = ChartClass.getChart(canvas); if (prev) prev.destroy(); } } catch(_) {}
  // 포인트 라벨 플러그인은 이벤트 간섭 이슈가 있어 제거
  const weeklyConfig = {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: '투두 완료율',
        data: todoData,
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34, 197, 94, 0.1)',
        borderWidth: 3,
        tension: 0.4,
        pointRadius: 6,
        pointHoverRadius: 8,
        pointBackgroundColor: '#22c55e',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointHoverBackgroundColor: '#16a34a',
        pointHoverBorderColor: '#fff',
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          padding: 12,
          titleFont: { size: 14 },
          bodyFont: { size: 13 },
          callbacks: {
            label: function(context){ return '완료율: ' + context.parsed.y + '%'; }
          }
        }
      },
      scales: {
        y: { beginAtZero: true, max: 100, grid:{ color:'rgba(0,0,0,0.05)' }, ticks: { callback: function(v){ return String(v) + '%'; } } },
        x: { grid: { display:false } }
      }
    }
  };
  const buildWeekly = ()=>{
    try {
      // 전역 기본값 충돌 방지: 라인 강제
      if (ChartClass && ChartClass.defaults) {
        ChartClass.defaults.type = 'line';
        try { if (ChartClass.defaults.datasets && ChartClass.defaults.datasets.bar) { delete ChartClass.defaults.datasets.bar; } } catch(_){}}
      // 데이터셋 타입도 라인으로 강제 고정
      try { (weeklyConfig.data?.datasets||[]).forEach(d=>{ d.type = 'line'; }); } catch(_){}
      window.weeklyChartInstance = new ChartClass(ctx, weeklyConfig);
      // 숨김 상태 초기화 시 사이즈 재계산
      setTimeout(()=>{ try{ window.weeklyChartInstance && window.weeklyChartInstance.resize(); }catch(_){} }, 0);
    } catch(e){ console.error('[weeklyChart] init error', e); }
  };
  if (document.visibilityState !== 'visible' || canvas.offsetParent === null || canvas.clientWidth === 0) {
    const onVis = ()=>{ if(document.visibilityState==='visible'){ buildWeekly(); document.removeEventListener('visibilitychange', onVis); } };
    document.addEventListener('visibilitychange', onVis);
  } else {
    buildWeekly();
  }
}

/**
 * 세션 출석 캘린더 렌더링 (최근 30일)
 */
async function renderAttendanceCalendar() {
  const calendar = document.getElementById('attendanceCalendar');
  if (!calendar) return;
  
  const { breakHistory = [] } = await chrome.storage.local.get('breakHistory');
  calendar.innerHTML = '';
  
  // 월 기준 달력 날짜 생성
  const base = new Date();
  base.setMonth(base.getMonth() + attendMonthOffset);
  base.setDate(1);
  const monthStart = new Date(base.getFullYear(), base.getMonth(), 1);
  const monthEnd = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  const days = Array.from({ length: monthEnd.getDate() }, (_, i) => new Date(base.getFullYear(), base.getMonth(), i+1));
  
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
  let presentDays = 0;
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
    if (completed) presentDays++;
  });

  // 상단 정보 및 출석율 표시
  const info = document.getElementById('attendInfo');
  if (info) info.textContent = `${monthStart.getFullYear()}년 ${monthStart.getMonth()+1}월`;
  const rateEl = document.getElementById('attendanceRate');
  if (rateEl) {
    const rate = days.length ? Math.round((presentDays / days.length) * 100) : 0;
    rateEl.textContent = `(출석율 ${rate}%)`;
  }
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
    renderSessionCompletion();
      renderAttendanceCalendar();
      renderTypeDistribution();
      renderHourlyHeatmap();
      renderStreak();
    }
    
    if (changes.todosByDate || changes.todos) {
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
    renderSessionCompletion(),
    renderAttendanceCalendar(),
    renderTypeDistribution(),
    renderHourlyHeatmap(),
    renderStreak()
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
  // 날짜 이동 버튼 연결 및 초기 표시
  const prevBtn = document.getElementById('prevDate');
  const nextBtn = document.getElementById('nextDate');
  if (prevBtn) prevBtn.addEventListener('click', goToPrevDate);
  if (nextBtn) nextBtn.addEventListener('click', goToNextDate);
  renderSelectedDate();
  // 주 이동 버튼 연결
  const prevWeekBtn = document.getElementById('prevWeek');
  const nextWeekBtn = document.getElementById('nextWeek');
  const prevWeekHeat = document.getElementById('prevWeekHeat');
  const nextWeekHeat = document.getElementById('nextWeekHeat');
  function moveWeeklyPeriod(delta){ if(weeklyMode==='week'){ weekOffset = Math.min(0, weekOffset + delta);} else { monthOffsetWeekly = Math.min(0, monthOffsetWeekly + delta);} renderWeekly(); }
  if (prevWeekBtn) prevWeekBtn.addEventListener('click', ()=>moveWeeklyPeriod(-1));
  if (nextWeekBtn) nextWeekBtn.addEventListener('click', ()=>moveWeeklyPeriod(1));
  // 시간대별 활동 네비게이션 (주/월 독립)
  function moveHeat(delta){ if(heatMode==='week'){ heatWeekOffset=Math.min(0, heatWeekOffset+delta);} else { heatMonthOffset=Math.min(0, heatMonthOffset+delta);} renderHourlyHeatmap(); }
  if (prevWeekHeat) prevWeekHeat.addEventListener('click', ()=>moveHeat(-1));
  if (nextWeekHeat) nextWeekHeat.addEventListener('click', ()=>moveHeat(1));

  // 타입 분포 전용 토글/네비게이션
  function setTypeMode(mode){ typeMode = mode; updateTypeButtons(); renderTypeDistribution(); }
  function updateTypeButtons(){
    const tw=document.getElementById('typeModeWeek'); const tm=document.getElementById('typeModeMonth');
    if (tw && tm){ if (typeMode==='week'){ tw.classList.add('bg-white'); tm.classList.remove('bg-white'); } else { tm.classList.add('bg-white'); tw.classList.remove('bg-white'); } }
  }
  const tmw=document.getElementById('typeModeWeek'); if(tmw) tmw.addEventListener('click', ()=>setTypeMode('week'));
  const tmm=document.getElementById('typeModeMonth'); if(tmm) tmm.addEventListener('click', ()=>setTypeMode('month'));
  const prevType=document.getElementById('prevType'); const nextType=document.getElementById('nextType');
  function moveType(delta){ if(typeMode==='week'){ typeWeekOffset=Math.min(0, typeWeekOffset+delta);} else { typeMonthOffset=Math.min(0, typeMonthOffset+delta);} renderTypeDistribution(); }
  if(prevType) prevType.addEventListener('click', ()=>moveType(-1));
  if(nextType) nextType.addEventListener('click', ()=>moveType(1));
  updateTypeButtons();
  // 완료율(주/월) 모드 토글
  function setWeeklyMode(mode){ weeklyMode = mode; updateWeeklyButtons(); renderWeekly(); }
  function updateWeeklyButtons(){ const w=document.getElementById('weeklyModeWeek'); const m=document.getElementById('weeklyModeMonth'); if(w&&m){ if(weeklyMode==='week'){ w.classList.add('bg-white'); m.classList.remove('bg-white'); } else { m.classList.add('bg-white'); w.classList.remove('bg-white'); } } }
  const wmW=document.getElementById('weeklyModeWeek'); if(wmW) wmW.addEventListener('click', ()=>setWeeklyMode('week'));
  const wmM=document.getElementById('weeklyModeMonth'); if(wmM) wmM.addEventListener('click', ()=>setWeeklyMode('month'));
  updateWeeklyButtons();
  // 세션 완료수 섹션 토글/네비게이션
  function setSessionMode(mode){ sessionMode = mode; updateSessionButtons(); renderSessionCompletion(); }
  function updateSessionButtons(){ const w=document.getElementById('sessionModeWeek'); const m=document.getElementById('sessionModeMonth'); if(w&&m){ if(sessionMode==='week'){ w.classList.add('bg-white'); m.classList.remove('bg-white'); } else { m.classList.add('bg-white'); w.classList.remove('bg-white'); } } }
  const smw=document.getElementById('sessionModeWeek'); if(smw) smw.addEventListener('click', ()=>setSessionMode('week'));
  const smm=document.getElementById('sessionModeMonth'); if(smm) smm.addEventListener('click', ()=>setSessionMode('month'));
  const prevSession=document.getElementById('prevSession'); const nextSession=document.getElementById('nextSession');
  function moveSession(delta){ if(sessionMode==='week'){ sessionWeekOffset=Math.min(0, sessionWeekOffset+delta);} else { sessionMonthOffset=Math.min(0, sessionMonthOffset+delta);} renderSessionCompletion(); }
  if(prevSession) prevSession.addEventListener('click', ()=>moveSession(-1));
  if(nextSession) nextSession.addEventListener('click', ()=>moveSession(1));
  updateSessionButtons();
  // 시간대별 활동 모드 토글
  function setHeatMode(mode){ heatMode = mode; updateHeatButtons(); renderHourlyHeatmap(); }
  function updateHeatButtons(){
    const hw=document.getElementById('heatModeWeek'); const hm=document.getElementById('heatModeMonth');
    if (hw && hm){ if (heatMode==='week'){ hw.classList.add('bg-white'); hm.classList.remove('bg-white'); } else { hm.classList.add('bg-white'); hw.classList.remove('bg-white'); } }
  }
  const heatWeekBtn=document.getElementById('heatModeWeek'); if(heatWeekBtn) heatWeekBtn.addEventListener('click', ()=>setHeatMode('week'));
  const heatMonthBtn=document.getElementById('heatModeMonth'); if(heatMonthBtn) heatMonthBtn.addEventListener('click', ()=>setHeatMode('month'));
  updateHeatButtons();
  // 출석 달 네비게이션
  const prevAttend=document.getElementById('prevAttend');
  const nextAttend=document.getElementById('nextAttend');
  function moveAttend(delta){ attendMonthOffset = Math.min(0, attendMonthOffset + delta); renderAttendanceCalendar(); }
  if(prevAttend) prevAttend.addEventListener('click', ()=>moveAttend(-1));
  if(nextAttend) nextAttend.addEventListener('click', ()=>moveAttend(1));
  
  refreshAllStats();
  setupRealtimeUpdates();
});

// ----------- 추가 시각화 -----------

/* async function collectAnalysisData() {
  const { breakHistory = [], todosByDate = {} } = await chrome.storage.local.get(['breakHistory','todosByDate']);
  const now = Date.now();
  const weekAgo = now - 7*24*60*60*1000;
  const twoWeeksAgo = now - 14*24*60*60*1000;
  const thisWeek = breakHistory.filter(b => Date.parse(b.timestamp||0) >= weekAgo);
  const lastWeek = breakHistory.filter(b => { const ts = Date.parse(b.timestamp||0); return ts >= twoWeeksAgo && ts < weekAgo; });
  const rate = (arr)=> arr.length? arr.filter(b=>b.completed).length/arr.length : 0;
  const weekdayStats = Array(7).fill(0).map(()=>({total:0, completed:0}));
  thisWeek.forEach(b=>{ const d=new Date(b.timestamp).getDay(); weekdayStats[d].total++; if(b.completed) weekdayStats[d].completed++; });
  const typeDistribution = {}; thisWeek.filter(b=>b.completed).forEach(b=>{ typeDistribution[b.breakType] = (typeDistribution[b.breakType]||0)+1; });
  const todoCounts = { total:0, completed:0 };
  Object.values(todosByDate).forEach(tl=>{ if(!Array.isArray(tl)) return; tl.forEach(t=>{ todoCounts.total++; if(t.completed) todoCounts.completed++; }); });
  return {
    thisWeek:{ total:thisWeek.length, completed:thisWeek.filter(b=>b.completed).length, rate:rate(thisWeek) },
    lastWeek:{ total:lastWeek.length, completed:lastWeek.filter(b=>b.completed).length, rate:rate(lastWeek) },
    weekdayStats, typeDistribution, todoCounts, trend: rate(thisWeek)-rate(lastWeek)
  };
} */

/* function generateRuleBasedAnalysis(data){
  const thisRate = Math.round((data.thisWeek.rate||0)*100);
  const trend = Math.round((data.trend||0)*100);
  let weeklySummary = thisRate>=80? `훌륭해요! 이번 주 ${thisRate}% 완료 🎉` : thisRate>=60? `좋아요! 이번 주 ${thisRate}% 완료 👍` : thisRate>=40? `꾸준히 가는 중, ${thisRate}% 완료 💪` : `이번 주 다시 시작해봐요 ${thisRate}% 완료 🌱`;
  const best = data.weekdayStats.map((s,i)=>({i, r: s.total? s.completed/s.total:0})).sort((a,b)=>b.r-a.r)[0]||{i:0};
  const names=['일요일','월요일','화요일','수요일','목요일','금요일','토요일'];
  let pattern = trend>10? `지난주 대비 ${trend}%p 향상! ${names[best.i]} 집중력이 좋아요.` : trend<-10? `지난주 대비 ${Math.abs(trend)}%p 하락. ${names[best.i]} 패턴을 살려보세요.` : `안정적이에요. ${names[best.i]}이 베스트 데이.`;
  const suggestions=[]; if(thisRate<60){ suggestions.push('알림 시간을 조정해보세요'); suggestions.push('짧은 타이머(15/3)로 시작'); } else { suggestions.push('현재 루틴 유지'); suggestions.push('긴 타이머(50/10)에 도전'); }
  const types = { eyeExercise:'눈 운동', stretching:'스트레칭', breathing:'호흡', hydration:'수분 섭취', movement:'움직임' };
  const least = Object.keys(types).find(t=>!data.typeDistribution[t]); if(least) suggestions.push(`${types[least]}을 더 자주 시도`);
  return { weeklySummary, pattern, suggestions: suggestions.slice(0,3) };
} */

/* async function generateAIAnalysis(){
  const loading=document.getElementById('analysisLoading'); const weekly=document.querySelector('#weeklyInsight p'); const pattern=document.querySelector('#patternInsight p'); const sug=document.querySelector('#suggestionInsight ul');
  if(loading) loading.classList.remove('hidden');
  try{
    const data = await collectAnalysisData();
    const out = generateRuleBasedAnalysis(data); // 폴백(기본)
    if(weekly) weekly.textContent = out.weeklySummary;
    if(pattern) pattern.textContent = out.pattern;
    if(sug){ sug.innerHTML=''; out.suggestions.forEach(t=>{ const li=document.createElement('li'); li.textContent=t; sug.appendChild(li); }); }
  }catch(e){ console.error('[AI Analysis] error', e); }
  finally{ if(loading) loading.classList.add('hidden'); }
} */

async function renderTypeDistribution(){
  const { breakHistory=[] } = await chrome.storage.local.get('breakHistory');
  const now=new Date();
  const wInfo=getWeekInfo(new Date(), typeWeekOffset);
  const mBase=new Date(now.getFullYear(), now.getMonth()+typeMonthOffset, 1);
  const mStart=new Date(mBase.getFullYear(), mBase.getMonth(), 1);
  const mEnd=new Date(mBase.getFullYear(), mBase.getMonth()+1, 0);
  const sTs=(typeMode==='week'?wInfo.start:mStart).getTime();
  const eRef=(typeMode==='week'?wInfo.end:mEnd);
  const eTs=new Date(eRef.getFullYear(), eRef.getMonth(), eRef.getDate(), 23,59,59,999).getTime();
  const counts={}; const names={eyeExercise:'눈 운동',stretching:'스트레칭',breathing:'호흡',hydration:'수분',movement:'움직임'};
  breakHistory.filter(b=>b.completed).forEach(b=>{ const ts=Date.parse(b.timestamp||0); if(!(ts>=sTs&&ts<=eTs)) return; const k=names[b.breakType]||b.breakType||'기타'; counts[k]=(counts[k]||0)+1; });
  const canvas=document.getElementById('typeDistributionChart'); if(!canvas) return;
  // 카드형 + 아이콘 + 퍼센트 시각화
  if(window.typeChart){ try{ window.typeChart.destroy(); } catch(_){} }
  canvas.style.display = 'none';
  const parent = canvas.parentElement || canvas;
  // 기존 숫자 뷰 제거
  const oldNum = parent.querySelector('#typeDistributionNumbers'); if(oldNum) oldNum.remove();
  let grid = parent.querySelector('#typeDistributionCards');
  if(!grid){ grid = document.createElement('div'); grid.id='typeDistributionCards'; parent.appendChild(grid); }
  const entries = Object.entries(counts);
  const total = entries.reduce((s,[,v])=> s+v, 0);
  const sorted = entries.sort((a,b)=> b[1]-a[1]);
  grid.className = 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3';
  grid.innerHTML = '';
  if (total === 0) {
    const empty = document.createElement('div');
    empty.className = 'text-sm text-gray-500';
    empty.textContent = '아직 완료된 세션이 없어요.';
    grid.appendChild(empty);
  } else {
    const palette = {
      '눈 운동': { bg: 'rgba(14,165,233,0.12)', fg: '#0284c7', icon: '👀' },
      '스트레칭': { bg: 'rgba(16,185,129,0.12)', fg: '#059669', icon: '🧘' },
      '호흡': { bg: 'rgba(99,102,241,0.12)', fg: '#4f46e5', icon: '😮‍💨' },
      '수분': { bg: 'rgba(59,130,246,0.12)', fg: '#2563eb', icon: '💧' },
      '움직임': { bg: 'rgba(234,179,8,0.15)', fg: '#b45309', icon: '🚶' },
      '기타': { bg: 'rgba(107,114,128,0.12)', fg: '#374151', icon: '✨' }
    };
    const cardEls = [];
    sorted.forEach(([label, value])=>{
      const pct = total ? Math.round((value/total)*100) : 0;
      const c = palette[label] || palette['기타'];
      const card = document.createElement('div');
      card.className = 'rounded-md p-3 flex items-center gap-3';
      card.style.backgroundColor = c.bg;
      const icon = document.createElement('div');
      icon.className = 'w-9 h-9 flex items-center justify-center rounded-full text-lg';
      icon.style.backgroundColor = 'rgba(255,255,255,0.8)';
      icon.style.color = c.fg;
      icon.textContent = c.icon;
      const body = document.createElement('div');
      body.className = 'flex-1 min-w-0';
      const top = document.createElement('div');
      top.className = 'flex items-baseline justify-between';
      const name = document.createElement('div');
      name.className = 'text-sm font-medium';
      name.style.color = c.fg;
      name.textContent = label;
      const stat = document.createElement('div');
      stat.className = 'text-sm';
      stat.innerHTML = `<span class="font-semibold" style="color:${c.fg}">${value}</span>회 · ${pct}%`;
      top.appendChild(name); top.appendChild(stat);
      const barWrap = document.createElement('div');
      barWrap.className = 'mt-2 h-2 w-full rounded bg-white/70 overflow-hidden';
      const bar = document.createElement('div'); bar.className='h-full rounded'; bar.style.backgroundColor=c.fg; bar.style.width = pct + '%';
      barWrap.appendChild(bar);
      body.appendChild(top); body.appendChild(barWrap);
      card.appendChild(icon); card.appendChild(body);
      grid.appendChild(card);
      cardEls.push(card);
    });
    // 모든 카드의 높이를 동일하게(가장 큰 카드 기준) 맞춤
    try {
      requestAnimationFrame(()=>{
        let maxH = 0;
        cardEls.forEach(el=>{ const h=el.getBoundingClientRect().height||0; if(h>maxH) maxH=h; });
        if(maxH>0){ cardEls.forEach(el=>{ el.style.minHeight = maxH + 'px'; }); }
      });
    } catch (_) {}
  }
  const infoEl=document.getElementById('typeInfo');
  if(infoEl){
    const periodText = (typeMode==='week') ? wInfo.text : `${mStart.getFullYear()}년 ${mStart.getMonth()+1}월 (${mStart.getMonth()+1}/1 ~ ${mEnd.getMonth()+1}/${mEnd.getDate()})`;
    infoEl.textContent = `${periodText}`;
  }
}

async function renderHourlyHeatmap(){
  const { breakHistory=[] } = await chrome.storage.local.get('breakHistory');
  let startTs, endTs, labelText;
  if (heatMode==='week') {
    const info = getWeekInfo(new Date(), heatWeekOffset);
    startTs = info.start.getTime();
    endTs = new Date(info.end.getFullYear(), info.end.getMonth(), info.end.getDate(), 23,59,59,999).getTime();
    labelText = info.text;
  } else {
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth()+heatMonthOffset, 1);
    const mStart = new Date(base.getFullYear(), base.getMonth(), 1);
    const mEnd = new Date(base.getFullYear(), base.getMonth()+1, 0);
    startTs = mStart.getTime();
    endTs = new Date(mEnd.getFullYear(), mEnd.getMonth(), mEnd.getDate(), 23,59,59,999).getTime();
    labelText = `${mStart.getFullYear()}년 ${mStart.getMonth()+1}월 (${mStart.getMonth()+1}/1 ~ ${mEnd.getMonth()+1}/${mEnd.getDate()})`;
  }
  const grid=Array(7).fill(0).map(()=>Array(24).fill(0));
  breakHistory.filter(b=>b.completed).forEach(b=>{ const ts=Date.parse(b.timestamp||0); if(!(ts>=startTs && ts<=endTs)) return; const d=new Date(ts); const idx=(d.getDay()===0)?6:(d.getDay()-1); grid[idx][d.getHours()]++; });
  const container=document.getElementById('hourlyHeatmap'); if(!container) return; const max=Math.max(0,...grid.flat());
  const days=['월','화','수','목','금','토','일'];
  const boxW = 16*1.69; // 너비를 추가로 1.3배 확장 (총 1.69배)
  const boxH = 16;     // 높이는 기존 유지
  let html='<div class="inline-flex flex-col gap-1">';
  // 시간대 헤더
  html+='<div class="flex gap-1 items-end">';
  html+='<div class="w-8"></div>';
  for(let h=0; h<24; h++){ html+=`<div class="text-[10px] text-gray-500 text-center" style="width:${boxW}px">${h}시</div>`; }
  html+='</div>';
  // 데이터 행
  days.forEach((day,di)=>{ html+='<div class="flex gap-1">'; html+=`<div class="w-8 text-xs flex items-center justify-end pr-1">${day}</div>`; for(let h=0;h<24;h++){ const c=grid[di][h]; const t=max?c/max:0; const color=t===0?'#f3f4f6': t<0.33?'#dbeafe': t<0.66?'#93c5fd':'#3b82f6'; html+=`<div class="rounded-sm" style=\"width:${boxW}px;height:${boxH}px;background-color:${color}\" title=\"${day} ${h}시: ${c}회\"></div>`;} html+='</div>'; }); html+='</div>';
  container.innerHTML=html;
  const weekInfoHeat = document.getElementById('weekInfoHeat'); if (weekInfoHeat) weekInfoHeat.textContent = labelText;
}

// trend chart removed

// 세션 완료수 (주간/월간) 렌더링
async function renderSessionCompletion(){
  const { breakHistory=[] } = await chrome.storage.local.get('breakHistory');
  let labels = [];
  let data = [];
  const infoEl = document.getElementById('sessionInfo');
  if (sessionMode==='week'){
    const info=getWeekInfo(new Date(), sessionWeekOffset);
    if(infoEl) infoEl.textContent = info.text;
    labels = ['월','화','수','목','금','토','일'];
    const bucket=Array(7).fill(0);
    const s=info.start.getTime(); const e=new Date(info.end.getFullYear(), info.end.getMonth(), info.end.getDate(),23,59,59,999).getTime();
    breakHistory.forEach(b=>{ const ts=Date.parse(b.timestamp||0); if(!(ts>=s&&ts<=e)) return; if(!b.completed) return; const d=new Date(ts).getDay(); const idx=(d===0)?6:(d-1); bucket[idx]++; });
    data = bucket;
  } else {
    const now=new Date(); const base=new Date(now.getFullYear(), now.getMonth()+sessionMonthOffset,1);
    const mStart=new Date(base.getFullYear(), base.getMonth(),1); const mEnd=new Date(base.getFullYear(), base.getMonth()+1,0);
    if(infoEl) infoEl.textContent = `${mStart.getFullYear()}년 ${mStart.getMonth()+1}월 (${mStart.getMonth()+1}/1 ~ ${mEnd.getMonth()+1}/${mEnd.getDate()})`;
    const s=mStart.getTime(); const e=new Date(mEnd.getFullYear(), mEnd.getMonth(), mEnd.getDate(),23,59,59,999).getTime();
    const days=mEnd.getDate(); labels = Array.from({length:days},(_,i)=>String(i+1));
    const bucket=Array(days).fill(0);
    breakHistory.forEach(b=>{ const ts=Date.parse(b.timestamp||0); if(!(ts>=s&&ts<=e)) return; if(!b.completed) return; const d=new Date(ts).getDate(); bucket[d-1]++; });
    data=bucket;
  }
  const canvas=document.getElementById('sessionCompletionChart'); if(!canvas) return;
  const ApexChartsClass = getApexCharts();
  const ECharts = getECharts();
  const ChartClass = getChartClass();
  if (ApexChartsClass) {
    try {
      try { if (ChartClass && typeof ChartClass.getChart === 'function') { const prev = ChartClass.getChart(canvas); if (prev) prev.destroy(); } } catch(_) {}
      try { const ecd = document.getElementById(`${canvas.id}__ec`); if (ecd && ECharts) { const inst = ECharts.getInstanceByDom(ecd); if (inst) inst.dispose(); } } catch(_) {}
      const el = ensureApexContainer(canvas, '__apex');
      el.style.display = 'block';
      if (window.apexSession) { try { window.apexSession.destroy(); } catch(_) {} }
      const opts = {
        chart: { type: 'line', height: el.clientHeight || 250, animations: { enabled: true }, events: {
          mounted: (ctx)=>{ try{ const paths = ctx.el.querySelectorAll('.apexcharts-series path'); paths.forEach(p=>{ p.setAttribute('stroke','rgba(66,66,66,0.5)'); p.style.stroke = 'rgba(66,66,66,0.5)'; }); } catch(_){} },
          updated: (ctx)=>{ try{ const paths = ctx.el.querySelectorAll('.apexcharts-series path'); paths.forEach(p=>{ p.setAttribute('stroke','rgba(66,66,66,0.5)'); p.style.stroke = 'rgba(66,66,66,0.5)'; }); } catch(_){} }
        } },
        series: [{ name: '완료수', data: data }],
        xaxis: { categories: labels },
        yaxis: { min: 0, labels: { formatter: (v)=> `${Math.round(v)}회` } },
        dataLabels: { enabled: true, formatter: (v)=> `${v}회`, offsetY: -8, style: { fontSize: '11px', colors: ['#3b82f6'] } },
        stroke: { width: 3, curve: 'smooth' },
        markers: { size: 4, colors: ['#3b82f6'], strokeColors: '#d1d5db', strokeOpacity: 1, fillOpacity: 1 },
        tooltip: { enabled: true, y: { formatter: (v)=> `${v}회` } },
        grid: { borderColor: 'rgba(0,0,0,0.05)', strokeDashArray: 2 },
        colors: ['rgba(66,66,66,0.5)'],
        fill: { type: 'solid', opacity: 0 }
      };
      const chart = new ApexChartsClass(el, opts);
      chart.render();
      try { chart.resize(); } catch(_) {}
      window.apexSession = chart;
      canvas.style.display = 'none';
      return;
    } catch (e) { console.error('[sessionChart][apex] init error', e); }
  }
  if (ECharts) {
    try {
      try { if (ChartClass && typeof ChartClass.getChart === 'function') { const prev = ChartClass.getChart(canvas); if (prev) prev.destroy(); } } catch(_) {}
      const ecDom = ensureEChartContainer(canvas, '__ec');
      try { const inst = ECharts.getInstanceByDom(ecDom); if (inst) inst.dispose(); } catch(_) {}
      const instance = ECharts.init(ecDom);
      window.sessionEChart = instance;
      const option = {
        tooltip: { trigger: 'axis' },
        grid: { left: 32, right: 16, top: 16, bottom: 24 },
        xAxis: { type: 'category', data: labels, boundaryGap: false, axisLine:{lineStyle:{color:'#94a3b8'}}, axisTick:{show:false} },
        yAxis: { type: 'value', min: 0, axisLabel: { formatter: '{value}회' }, splitLine:{lineStyle:{color:'rgba(0,0,0,0.05)'}} },
        series: [{ name: '완료수', type: 'line', data: data, smooth: true, symbolSize: 6, areaStyle: { opacity: 0.15 }, lineStyle: { width: 3, color: '#3b82f6' }, itemStyle: { color: '#3b82f6' } }]
      };
      instance.setOption(option, true);
      canvas.style.display = 'none';
      return;
    } catch (e) { console.error('[sessionChart][echarts] init error', e); }
  }
  const ctx=canvas.getContext('2d');
  if(window.sessionChart){ try{ window.sessionChart.destroy(); }catch(_){} }
  try { if (ChartClass && typeof ChartClass.getChart === 'function') { const prev = ChartClass.getChart(canvas); if (prev) prev.destroy(); } } catch(_) {}
  // 세션 차트도 포인트 라벨 플러그인 제거
  const sessConfig = {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '완료수',
        data,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        borderWidth: 3,
        tension: 0.4,
        pointRadius: 6,
        pointHoverRadius: 8,
        pointBackgroundColor: '#3b82f6',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointHoverBackgroundColor: '#2563eb',
        pointHoverBorderColor: '#fff',
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          padding: 12,
          titleFont: { size: 14 },
          bodyFont: { size: 13 },
          callbacks: {
            label: function(context){ return '완료수: ' + context.parsed.y + '회'; }
          }
        }
      },
      scales: {
        y: { beginAtZero: true, grid:{ color:'rgba(0,0,0,0.05)' } },
        x: { grid: { display:false } }
      }
    }
  };
  const buildSess = ()=>{
    try {
      // 전역 기본값 충돌 방지: 라인 강제
      if (ChartClass && ChartClass.defaults) {
        ChartClass.defaults.type = 'line';
        try { if (ChartClass.defaults.datasets && ChartClass.defaults.datasets.bar) { delete ChartClass.defaults.datasets.bar; } } catch(_){}
      }
      // 데이터셋 타입도 라인으로 강제 고정
      try { (sessConfig.data?.datasets||[]).forEach(d=>{ d.type = 'line'; }); } catch(_){}
      window.sessionChart = new ChartClass(ctx, sessConfig);
      setTimeout(()=>{ try{ window.sessionChart && window.sessionChart.resize(); }catch(_){} }, 0);
    } catch(e){ console.error('[sessionChart] init error', e); }
  };
  if (document.visibilityState !== 'visible' || canvas.offsetParent === null || canvas.clientWidth === 0) {
    const onVis2 = ()=>{ if(document.visibilityState==='visible'){ buildSess(); document.removeEventListener('visibilitychange', onVis2); } };
    document.addEventListener('visibilitychange', onVis2);
  } else {
    buildSess();
  }
}

async function renderStreak(){
  const { breakHistory=[] } = await chrome.storage.local.get('breakHistory');
  const set=new Set(); breakHistory.filter(b=>b.completed).forEach(b=> set.add(localDateKey(Date.parse(b.timestamp||0))) );
  let current=0; let d=new Date(); d.setHours(0,0,0,0); while(set.has(localDateKey(d.getTime()))){ current++; d.setDate(d.getDate()-1); }
  const sorted=[...set].sort(); let longest=0, tmp=0; for(let i=0;i<sorted.length;i++){ if(i===0){ tmp=1; } else { const diff=(parseLocalDateKey(sorted[i])-parseLocalDateKey(sorted[i-1]))/(24*60*60*1000); if(diff===1) tmp++; else { longest=Math.max(longest,tmp); tmp=1; } } } longest=Math.max(longest,tmp);
  const curEl=document.getElementById('currentStreak'); const longEl=document.getElementById('longestStreak'); if(curEl) curEl.textContent=current; if(longEl) longEl.textContent=longest;
}



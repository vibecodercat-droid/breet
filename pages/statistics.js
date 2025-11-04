import { toCsvAndDownload } from "../lib/csv.js";
import { isSameLocalDay, localDateKey, parseLocalDateKey } from "../lib/date-utils.js";

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
  const ctx = canvas.getContext('2d');
  if (window.weeklyChartInstance) {
    const inst = window.weeklyChartInstance;
    const sameLen = inst && inst.data && Array.isArray(inst.data.labels) && inst.data.labels.length === labels.length;
    if (sameLen) {
      inst.data.labels = labels;
      inst.data.datasets[0].data = todoData;
      inst.update('none');
      return;
    } else {
      try { inst.destroy(); } catch(_) {}
      window.weeklyChartInstance = null;
    }
  }
  window.weeklyChartInstance = new window.Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        { label: '투두 완료율', data: todoData, backgroundColor: 'rgba(34, 197, 94, 0.6)', borderColor: 'rgba(34,197,94,1)', borderWidth: 2 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100, ticks: { callback: function(v){ return String(v) + '%'; } } } } }
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
  // 숫자형 뷰로 렌더링 (막대/파이 대신)
  if(window.typeChart){ try{ window.typeChart.destroy(); } catch(_){} }
  canvas.style.display = 'none';
  const parent = canvas.parentElement || canvas;
  let box = parent.querySelector('#typeDistributionNumbers');
  if(!box){ box = document.createElement('div'); box.id = 'typeDistributionNumbers'; parent.appendChild(box); }
  const sorted = Object.entries(counts).sort((a,b)=> b[1] - a[1]);
  box.className = 'h-full flex items-end gap-10';
  box.innerHTML = '';
  sorted.forEach(([label, value]) => {
    const wrap = document.createElement('div');
    wrap.className = 'flex flex-col items-center justify-end';
    const num = document.createElement('div');
    num.className = 'text-4xl font-bold text-blue-600';
    num.textContent = String(value);
    const cap = document.createElement('div');
    cap.className = 'text-xs text-gray-600 mt-1';
    cap.textContent = label;
    wrap.appendChild(num);
    wrap.appendChild(cap);
    box.appendChild(wrap);
  });
  const infoEl=document.getElementById('typeInfo'); if(infoEl){ infoEl.textContent = (typeMode==='week') ? wInfo.text : `${mStart.getFullYear()}년 ${mStart.getMonth()+1}월 (${mStart.getMonth()+1}/1 ~ ${mEnd.getMonth()+1}/${mEnd.getDate()})`; }
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
  const canvas=document.getElementById('sessionCompletionChart'); if(!canvas) return; const ctx=canvas.getContext('2d');
  if(window.sessionChart){ try{ window.sessionChart.destroy(); }catch(_){} }
  window.sessionChart = new Chart(ctx,{ type:'bar', data:{ labels, datasets:[{ label:'완료수', data, backgroundColor:'rgba(59,130,246,0.6)', borderColor:'rgba(59,130,246,1)', borderWidth:2 }] }, options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{ beginAtZero:true } } } });
}

async function renderStreak(){
  const { breakHistory=[] } = await chrome.storage.local.get('breakHistory');
  const set=new Set(); breakHistory.filter(b=>b.completed).forEach(b=> set.add(localDateKey(Date.parse(b.timestamp||0))) );
  let current=0; let d=new Date(); d.setHours(0,0,0,0); while(set.has(localDateKey(d.getTime()))){ current++; d.setDate(d.getDate()-1); }
  const sorted=[...set].sort(); let longest=0, tmp=0; for(let i=0;i<sorted.length;i++){ if(i===0){ tmp=1; } else { const diff=(parseLocalDateKey(sorted[i])-parseLocalDateKey(sorted[i-1]))/(24*60*60*1000); if(diff===1) tmp++; else { longest=Math.max(longest,tmp); tmp=1; } } } longest=Math.max(longest,tmp);
  const curEl=document.getElementById('currentStreak'); const longEl=document.getElementById('longestStreak'); if(curEl) curEl.textContent=current; if(longEl) longEl.textContent=longest;
}



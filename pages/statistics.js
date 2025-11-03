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
  
  const canvas = document.getElementById('weeklyChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  // 기존 Chart.js 인스턴스가 정상일 경우 업데이트, 아니면 재생성
  if (window.weeklyChartInstance) {
    const inst = window.weeklyChartInstance;
    const canUpdate = inst && inst.data && Array.isArray(inst.data.datasets) && inst.data.datasets.length >= 2;
    if (canUpdate) {
      inst.data.datasets[0].data = sessionData;
      inst.data.datasets[1].data = todoData;
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
      labels: ['일','월','화','수','목','금','토'],
      datasets: [
        { label: '세션 완료율', data: sessionData, backgroundColor: 'rgba(59, 130, 246, 0.6)', borderColor: 'rgba(59,130,246,1)', borderWidth: 2 },
        { label: '투두 완료율', data: todoData, backgroundColor: 'rgba(34, 197, 94, 0.6)', borderColor: 'rgba(34,197,94,1)', borderWidth: 2 }
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
      renderTypeDistribution();
      renderTrendChart();
      renderHourlyHeatmap();
      renderStreak();
      generateAIAnalysis();
    }
    
    if (changes.todosByDate) {
      setTimeout(() => {
        refreshTodoStats();
        renderWeekly();
        generateAIAnalysis();
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
    renderAttendanceCalendar(),
    renderTypeDistribution(),
    renderTrendChart(),
    renderHourlyHeatmap(),
    renderStreak(),
    generateAIAnalysis()
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
  
  refreshAllStats();
  setupRealtimeUpdates();
  // AI 분석 새로고침 버튼
  const refreshBtn = document.getElementById('refreshAnalysis');
  if (refreshBtn) refreshBtn.addEventListener('click', generateAIAnalysis);

  // 데모 데이터 적용(비어있을 때만)
  ensureDemoDataThenRender();
});

// ----------- AI 분석 및 추가 시각화 -----------

async function collectAnalysisData() {
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
}

function generateRuleBasedAnalysis(data){
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
}

async function generateAIAnalysis(){
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
}

async function renderTypeDistribution(){
  const { breakHistory=[] } = await chrome.storage.local.get('breakHistory');
  const counts={}; const names={eyeExercise:'눈 운동',stretching:'스트레칭',breathing:'호흡',hydration:'수분',movement:'움직임'};
  breakHistory.filter(b=>b.completed).forEach(b=>{ const k=names[b.breakType]||b.breakType||'기타'; counts[k]=(counts[k]||0)+1; });
  const canvas=document.getElementById('typeDistributionChart'); if(!canvas) return; const ctx=canvas.getContext('2d');
  if(window.typeChart) { window.typeChart.destroy(); }
  window.typeChart = new Chart(ctx,{ type:'doughnut', data:{ labels:Object.keys(counts), datasets:[{ data:Object.values(counts), backgroundColor:['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6'] }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' } } } });
}

async function renderHourlyHeatmap(){
  const { breakHistory=[] } = await chrome.storage.local.get('breakHistory');
  const grid=Array(7).fill(0).map(()=>Array(24).fill(0));
  breakHistory.filter(b=>b.completed).forEach(b=>{ const d=new Date(b.timestamp); grid[d.getDay()][d.getHours()]++; });
  const container=document.getElementById('hourlyHeatmap'); if(!container) return; const max=Math.max(0,...grid.flat());
  const days=['일','월','화','수','목','금','토']; let html='<div class="inline-flex flex-col gap-1">';
  days.forEach((day,di)=>{ html+='<div class="flex gap-1">'; html+=`<div class="w-8 text-xs flex items-center justify-end pr-1">${day}</div>`; for(let h=0;h<24;h++){ const c=grid[di][h]; const t=max?c/max:0; const color=t===0?'#f3f4f6': t<0.33?'#dbeafe': t<0.66?'#93c5fd':'#3b82f6'; html+=`<div class="w-4 h-4 rounded-sm" style="background-color:${color}" title="${day} ${h}시: ${c}회"></div>`;} html+='</div>'; }); html+='</div>';
  container.innerHTML=html;
}

async function renderTrendChart(){
  const { breakHistory=[] } = await chrome.storage.local.get('breakHistory');
  const daysArr=Array.from({length:30},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()-(29-i)); d.setHours(0,0,0,0); return d; });
  const rates=daysArr.map(d=>{ const day=breakHistory.filter(b=> isSameLocalDay(Date.parse(b.timestamp||0), d.getTime())); const total=day.length; const comp=day.filter(b=>b.completed).length; return total? Math.round(comp/total*100):0; });
  const canvas=document.getElementById('trendChart'); if(!canvas) return; const ctx=canvas.getContext('2d'); if(window.trendChart){ window.trendChart.destroy(); }
  window.trendChart=new Chart(ctx,{ type:'line', data:{ labels:daysArr.map(d=>`${d.getMonth()+1}/${d.getDate()}`), datasets:[{ label:'완료율 (%)', data:rates, borderColor:'#3b82f6', backgroundColor:'rgba(59,130,246,0.1)', fill:true, tension:0.4 }] }, options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{ beginAtZero:true, max:100 } }, plugins:{ legend:{ display:false } } });
}

async function renderStreak(){
  const { breakHistory=[] } = await chrome.storage.local.get('breakHistory');
  const set=new Set(); breakHistory.filter(b=>b.completed).forEach(b=> set.add(localDateKey(Date.parse(b.timestamp||0))) );
  let current=0; let d=new Date(); d.setHours(0,0,0,0); while(set.has(localDateKey(d.getTime()))){ current++; d.setDate(d.getDate()-1); }
  const sorted=[...set].sort(); let longest=0, tmp=0; for(let i=0;i<sorted.length;i++){ if(i===0){ tmp=1; } else { const diff=(parseLocalDateKey(sorted[i])-parseLocalDateKey(sorted[i-1]))/(24*60*60*1000); if(diff===1) tmp++; else { longest=Math.max(longest,tmp); tmp=1; } } } longest=Math.max(longest,tmp);
  const curEl=document.getElementById('currentStreak'); const longEl=document.getElementById('longestStreak'); if(curEl) curEl.textContent=current; if(longEl) longEl.textContent=longest;
}

// 비어있을 경우 데모 데이터 자동 생성 후 렌더
async function ensureDemoDataThenRender(){
  const { breakHistory=[], todosByDate={} } = await chrome.storage.local.get(['breakHistory','todosByDate']);
  const todoCount = Object.values(todosByDate||{}).reduce((acc,arr)=>acc+(Array.isArray(arr)?arr.length:0),0);
  if ((breakHistory?.length||0) === 0 && todoCount === 0) {
    await generateTestData();
    await refreshAllStats();
  }
}

// ------------------ 🧪 테스트 데이터 생성기 ------------------
async function generateTestData(){
  const now=Date.now(); const types=['eyeExercise','stretching','breathing','hydration','movement'];
  const typeNames={ eyeExercise:'눈 운동 20-20-20', stretching:'목 스트레칭', breathing:'박스 호흡', hydration:'물 마시기', movement:'제자리 걷기' };
  const breakHistory=[];
  for(let day=0; day<30; day++){
    const date=new Date(now-(29-day)*24*60*60*1000); const isWeekend=[0,6].includes(date.getDay());
    const sessions=isWeekend? (Math.floor(Math.random()*3)+1) : (Math.floor(Math.random()*6)+3);
    for(let s=0; s<sessions; s++){
      const hour=9+Math.floor(Math.random()*9); const minute=Math.floor(Math.random()*60);
      const ts=new Date(date); ts.setHours(hour,minute,0,0);
      const recentBonus=(day/30)*0.2; const base=0.6+recentBonus; const completed=Math.random()<base;
      const type=types[Math.floor(Math.random()*types.length)]; const workDur=[25,50,15,1][Math.floor(Math.random()*4)];
      const breakDur= workDur===25?5: workDur===50?10: workDur===15?3:1;
      breakHistory.push({ id:ts.getTime()+s, breakId:`${type}_${s}`, breakType:type, breakName:`${breakDur}분 ${typeNames[type]}`, duration:breakDur, workDuration:workDur, label:`${workDur}/${breakDur}`, completed, timestamp:ts.toISOString(), workEndTs:new Date(ts.getTime()-breakDur*60*1000).toISOString(), recommendationSource: Math.random()>0.5?'ai':'rule', recId: Math.random()>0.7?`rec_${Math.random().toString(36).substr(2,9)}`:null });
    }
  }
  const todosByDate={};
  for(let day=0; day<7; day++){
    const date=new Date(now-(6-day)*24*60*60*1000); date.setHours(0,0,0,0);
    const key=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    const count=Math.floor(Math.random()*6)+5; const templates=['이메일 확인하기','회의 준비','보고서 작성','코드 리뷰','디자인 피드백','문서 정리','테스트 코드 작성','버그 수정','기획서 검토','데이터 분석','프로젝트 미팅','운동하기','독서','명상','산책'];
    const todos=[]; for(let i=0;i<count;i++){ const createdAt=date.getTime()+Math.random()*24*60*60*1000; const completed=Math.random()<0.65; todos.push({ id:createdAt+i, text:templates[Math.floor(Math.random()*templates.length)] + (i>0?` ${i+1}`:''), completed, createdAt, updatedAt: createdAt+(completed? 3600000:0), completedAt: completed? createdAt + 3600000*Math.random()*8 : null }); }
    todosByDate[key]=todos;
  }
  const userProfile={ onboardingCompleted:true, onboardingDate: now-30*24*60*60*1000, workPatterns:['coding','writing'], healthConcerns:['eyeStrain','stress'], preferredBreakTypes:['eyeExercise','breathing'], routine:{type:'pomodoro', workDuration:25, breakDuration:5}, schedule:{ startTime:'09:00', endTime:'18:00', includeWeekends:false } };
  await chrome.storage.local.set({ breakHistory, todosByDate, userProfile });
}

async function exportTestData(){
  const data=await chrome.storage.local.get(null); const json=JSON.stringify(data,null,2); const blob=new Blob([json],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`breet_test_data_${Date.now()}.json`; a.click(); URL.revokeObjectURL(url);
}
async function importTestData(refreshAfter=false){ const input=document.createElement('input'); input.type='file'; input.accept='.json'; input.onchange= async (e)=>{ const f=e.target.files[0]; if(!f) return; const text=await f.text(); const data=JSON.parse(text); await chrome.storage.local.set(data); if(refreshAfter){ await refreshAllStats(); alert('데이터 가져오기 완료!'); } }; input.click(); }

async function generatePerfectUserData(){ const breakHistory=[]; const now=Date.now(); for(let day=0; day<30; day++){ const date=new Date(now-(29-day)*24*60*60*1000); const sessions=8; for(let s=0; s<sessions; s++){ const hour=9+s; const ts=new Date(date); ts.setHours(hour,0,0,0); breakHistory.push({ id:ts.getTime()+s, breakType:['eyeExercise','stretching','breathing'][s%3], duration:5, workDuration:25, completed: Math.random()<0.95, timestamp: ts.toISOString(), workEndTs: new Date(ts.getTime()-5*60*1000).toISOString() }); } } await chrome.storage.local.set({ breakHistory }); }
async function generateBeginnerUserData(){ const breakHistory=[]; const now=Date.now(); for(let day=0; day<30; day++){ const date=new Date(now-(29-day)*24*60*60*1000); const sessions=Math.floor(Math.random()*3)+2; for(let s=0;s<sessions;s++){ const hour=9+Math.floor(Math.random()*8); const ts=new Date(date); ts.setHours(hour,0,0,0); breakHistory.push({ id:ts.getTime()+s, breakType:'eyeExercise', duration:5, workDuration:25, completed: Math.random()<0.35, timestamp: ts.toISOString(), workEndTs: new Date(ts.getTime()-5*60*1000).toISOString() }); } } await chrome.storage.local.set({ breakHistory }); }
async function generateImprovingUserData(){ const breakHistory=[]; const now=Date.now(); for(let day=0; day<30; day++){ const date=new Date(now-(29-day)*24*60*60*1000); const rate=0.4 + (day/30)*0.5; const sessions=6; for(let s=0; s<sessions; s++){ const hour=9+s; const ts=new Date(date); ts.setHours(hour,0,0,0); breakHistory.push({ id:ts.getTime()+s, breakType:['eyeExercise','stretching','breathing'][s%3], duration:5, workDuration:25, completed: Math.random()<rate, timestamp: ts.toISOString(), workEndTs: new Date(ts.getTime()-5*60*1000).toISOString() }); } } await chrome.storage.local.set({ breakHistory }); }
async function generateMondayUserData(){ const breakHistory=[]; const now=Date.now(); for(let day=0; day<30; day++){ const date=new Date(now-(29-day)*24*60*60*1000); const isMon=date.getDay()===1; const sessions=isMon?10:2; const rate=isMon?0.9:0.3; for(let s=0;s<sessions;s++){ const hour=9+Math.floor(Math.random()*8); const ts=new Date(date); ts.setHours(hour,s*5,0,0); breakHistory.push({ id:ts.getTime()+s, breakType:['eyeExercise','stretching'][s%2], duration:5, workDuration:25, completed: Math.random()<rate, timestamp: ts.toISOString(), workEndTs: new Date(ts.getTime()-5*60*1000).toISOString() }); } } await chrome.storage.local.set({ breakHistory }); }

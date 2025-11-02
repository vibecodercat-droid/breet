// Background Service Worker (MV3)
// Manages timers, alarms, notifications, and cross-page state.

const STORAGE_KEYS = {
  SESSION: 'sessionState',
  PROFILE: 'userProfile',
  PENDING_BREAK: 'pendingBreak',
};

const ALARM_NAMES = {
  WORK: 'breet_work_timer',
  BREAK: 'breet_break_timer',
  TOAST: 'breet_toast_timer',
  DAILY_REFRESH: 'breet_daily_refresh',
};

const PHASES = {
  IDLE: 'idle',
  SELECTING: 'selecting',
  WORK: 'work',
  WORK_ENDING: 'work_ending',
  BREAK: 'break',
  BREAK_ENDING: 'break_ending',
  PAUSED: 'paused',
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    [STORAGE_KEYS.SESSION]: {
      phase: PHASES.IDLE,
      mode: null,
      startTs: null,
      endTs: null,
      pausedAt: null,
      remainingMs: null,
      workDuration: 25,
      breakDuration: 5,
    }
  });
  // 00시마다 dailyAffirmation과 timerDescription 생성
  scheduleDailyRefresh();
});

// 다음 00시까지 남은 시간 계산
function getNextMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  midnight.setDate(midnight.getDate() + 1); // 다음 날 00시
  return midnight.getTime();
}

// 일일 새로고침 알람 스케줄
async function scheduleDailyRefresh() {
  const when = getNextMidnight();
  await chrome.alarms.create(ALARM_NAMES.DAILY_REFRESH, { when });
  console.log('[Background] Scheduled daily refresh at', new Date(when).toISOString());
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm || !alarm.name) return;
  if (alarm.name === ALARM_NAMES.WORK) {
    handleWorkEnd();
  } else if (alarm.name === ALARM_NAMES.TOAST) {
    handleToastEnd();
  } else if (alarm.name === ALARM_NAMES.BREAK) {
    handleBreakEnd();
  } else if (alarm.name === ALARM_NAMES.DAILY_REFRESH) {
    handleDailyRefresh().then(() => {
      // 다음 날 00시 알람 다시 설정
      scheduleDailyRefresh();
    }).catch((e) => {
      console.error('[Background] Daily refresh error', e);
      scheduleDailyRefresh(); // 에러가 나도 다음 알람은 설정
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return;
  if (message.type === 'breet:prebreakSelect') {
    const { mode, workMinutes, breakMinutes } = message.payload || {};
    openPreBreakSelection({ mode, workMinutes, breakMinutes })
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (message.type === 'breet:startTimer') {
    const { mode, workMinutes, breakMinutes } = message.payload || {};
    startWorkTimer(mode, workMinutes, breakMinutes).then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (message.type === 'breet:pauseTimer') {
    pauseTimer().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (message.type === 'breet:resumeTimer') {
    resumeTimer().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (message.type === 'breet:stopTimer') {
    stopAllTimers().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (message.type === 'breet:requestNewBreaks') {
    const { breakMinutes, excludeIds = [], sessionId = null } = message.payload || {};
    (async () => {
      try {
        const metaKey = sessionId ? `prebreakMeta_${sessionId}` : 'prebreakMeta';
        // 세션별 메타데이터 우선 사용 (새 세션마다 리셋됨)
        const { [metaKey]: sessionMeta = null } = await chrome.storage.local.get(metaKey);
        // 세션별 메타가 없으면 전역 메타 사용 (기본값: otherUsed=0, maxOther=4)
        const { prebreakMeta = { otherUsed: 0, maxOther: 4, breakMinutes: 5 } } = await chrome.storage.local.get('prebreakMeta');
        // 세션별 메타 우선 사용 (타이머 버튼 클릭 시마다 리셋됨)
        const preMeta = sessionMeta || prebreakMeta || { otherUsed: 0, maxOther: 4, breakMinutes: 5 };
        
        // otherUsed 체크 (세션별로 독립적)
        if ((preMeta.otherUsed || 0) >= (preMeta.maxOther || 4)) {
          sendResponse({ ok: false, error: 'limit_reached' });
          return;
        }
        
        // breakMinutes 우선순위: payload > meta > 5
        const bm = breakMinutes ?? preMeta.breakMinutes ?? 5;
        await recommendNextBreakWithAI(bm, excludeIds);
        
        // Copy generic candidates into session-namespaced keys if sessionId provided
        if (sessionId) {
          const { pendingBreakCandidates = [], pendingBreak = null } = await chrome.storage.local.get(['pendingBreakCandidates','pendingBreak']);
          const ns = {}; ns[`pendingBreakCandidates_${sessionId}`] = pendingBreakCandidates; ns[`pendingBreak_${sessionId}`] = pendingBreak;
          await chrome.storage.local.set(ns);
        }
        
        // 메타데이터 업데이트: otherUsed 증가
        const newMeta = { ...preMeta, otherUsed: (preMeta.otherUsed || 0) + 1, breakMinutes: bm };
        const toSet = {}; 
        // 세션별 메타 업데이트 (세션별로 독립적으로 관리)
        toSet[metaKey] = newMeta;
        // 세션 ID가 있으면 전역 메타도 업데이트 (세션별 메타와 동기화)
        if (sessionId) {
          toSet['prebreakMeta'] = newMeta;
        } else {
          // 세션 ID가 없으면 전역 메타만 업데이트
          toSet['prebreakMeta'] = newMeta;
        }
        await chrome.storage.local.set(toSet);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
  if (message.type === 'breet:breakCompleted') {
    handleBreakCompleted(message.payload).then(() => sendResponse({ ok: true })).catch((e)=>sendResponse({ ok:false, error:String(e)}));
    return true;
  }
  if (message.type === 'breet:startBreakTimer') {
    startBreakTimer().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (message.type === 'breet:skipBreak') {
    stopAllTimers().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});

async function startWorkTimer(mode, workMinutes = 25, breakMinutes = 5) {
  try {
    await clearAllTimers();
    const startTs = Date.now();
    const endTs = startTs + workMinutes * 60 * 1000;
    await chrome.alarms.create(ALARM_NAMES.WORK, { when: endTs });
    await chrome.storage.local.set({
      [STORAGE_KEYS.SESSION]: {
        phase: PHASES.WORK,
        mode: mode || 'pomodoro',
        startTs,
        endTs,
        pausedAt: null,
        remainingMs: null,
        workDuration: workMinutes,
        breakDuration: breakMinutes,
      }
    });
  } catch (e) { console.error('[Timer] startWorkTimer error', e); }
}

async function stopAllTimers() {
  await clearAllTimers();
  await chrome.storage.local.set({
    [STORAGE_KEYS.SESSION]: {
      phase: PHASES.IDLE,
      mode: null,
      startTs: null,
      endTs: null,
      pausedAt: null,
      remainingMs: null,
      workDuration: 25,
      breakDuration: 5,
    }
  });
}

async function pauseTimer() {
  const { sessionState } = await chrome.storage.local.get(STORAGE_KEYS.SESSION);
  if (!sessionState?.endTs) return;
  const remain = Math.max(0, sessionState.endTs - Date.now());
  const alarmName = sessionState.phase === PHASES.BREAK ? ALARM_NAMES.BREAK : ALARM_NAMES.WORK;
  await chrome.alarms.clear(alarmName);
  await chrome.storage.local.set({
    [STORAGE_KEYS.SESSION]: { ...sessionState, phase: PHASES.PAUSED, pausedAt: Date.now(), remainingMs: remain }
  });
}

async function resumeTimer() {
  const { sessionState } = await chrome.storage.local.get(STORAGE_KEYS.SESSION);
  if (sessionState?.phase !== PHASES.PAUSED) return;
  const remain = sessionState.remainingMs || 0;
  const now = Date.now();
  const alarmName = (sessionState.mode === 'break' || sessionState.phase === PHASES.BREAK) ? ALARM_NAMES.BREAK : ALARM_NAMES.WORK;
  await chrome.alarms.create(alarmName, { when: now + remain });
  await chrome.storage.local.set({
    [STORAGE_KEYS.SESSION]: { ...sessionState, phase: (alarmName === ALARM_NAMES.BREAK ? PHASES.BREAK : PHASES.WORK), startTs: now, endTs: now + remain, pausedAt: null, remainingMs: null }
  });
}

async function startBreakTimer() {
  const { sessionState } = await chrome.storage.local.get(STORAGE_KEYS.SESSION);
  const breakMinutes = sessionState?.breakDuration || 5;
  const startTs = Date.now();
  const endTs = startTs + breakMinutes * 60 * 1000;
  await chrome.alarms.create(ALARM_NAMES.BREAK, { when: endTs });
  await chrome.storage.local.set({
    [STORAGE_KEYS.SESSION]: {
      ...sessionState,
      phase: PHASES.BREAK,
      startTs,
      endTs,
    }
  });
  chrome.windows.create({ url: chrome.runtime.getURL('content/break-overlay.html'), type: 'popup', width: 500, height: 650, focused: true });
}

async function shouldDelayNotification() {
  const now = new Date();
  // Check idle state (user away) – if idle/locked, delay
  const idleState = await new Promise((resolve) => chrome.idle.queryState(60, resolve));
  if (idleState === 'locked' || idleState === 'idle') return true;

  // Check schedule window from userProfile
  const { userProfile = {} } = await chrome.storage.local.get('userProfile');
  const schedule = userProfile.schedule || { startTime: '09:00', endTime: '18:00', includeWeekends: false };
  const [sh, sm] = (schedule.startTime || '09:00').split(':').map(n=>parseInt(n,10));
  const [eh, em] = (schedule.endTime || '18:00').split(':').map(n=>parseInt(n,10));
  const start = new Date(now); start.setHours(sh||0, sm||0, 0, 0);
  const end = new Date(now); end.setHours(eh||0, em||0, 0, 0);
  const within = now >= start && now <= end;
  const isWeekend = [0,6].includes(now.getDay());
  if (!within) return true;
  if (!schedule.includeWeekends && isWeekend) return true;
  return false;
}

import { recommendNextBreakWithAI } from '../lib/recommender.js';

function createBreakNotification() {
  const icon = chrome.runtime.getURL('icons/icon48.png');
  recommendNextBreakWithAI().then(async (rec) => {
    await chrome.storage.local.set({ pendingBreak: rec });
    const detail = rec?.name ? `${rec.name} · ${rec.duration}분` : '추천 브레이크';
    chrome.notifications.create(`breet:break:${Date.now()}`, {
      type: 'basic',
      iconUrl: icon,
      title: '브레이크 타임',
      message: detail,
      buttons: [ { title: '시작' }, { title: '나중에' } ],
      priority: 0,
    });
  }).catch(() => {
    chrome.notifications.create(`breet:break:${Date.now()}`, {
      type: 'basic', iconUrl: icon, title: '브레이크 타임', message: '잠깐 쉬어볼까요?', buttons: [{ title: '시작' }, { title: '나중에' }], priority: 0,
    });
  });
}

chrome.notifications.onButtonClicked.addListener(async (notifId, btnIdx) => {
  if (notifId.startsWith('breet:break:')) {
    if (btnIdx === 0) {
      // Start overlay via a new tab pointing to overlay page.
      chrome.tabs.create({ url: chrome.runtime.getURL('content/break-overlay.html') });
    }
    return;
  }
  if (notifId.startsWith('breet:prebreak:')) {
    const { pendingBreakCandidates = [], pendingBreak = null, prebreakPayload = null } = await chrome.storage.local.get(['pendingBreakCandidates','pendingBreak','prebreakPayload']);
    if (btnIdx === 0 && prebreakPayload) {
      // confirm and start work timer
      await chrome.storage.local.set({ pendingBreak });
      await startWorkTimer(prebreakPayload.mode, prebreakPayload.workMinutes, prebreakPayload.breakMinutes);
    } else if (btnIdx === 1 && pendingBreakCandidates.length) {
      // rotate suggestion
      const idx = Math.max(0, pendingBreakCandidates.findIndex(c => c?.id === pendingBreak?.id));
      const next = pendingBreakCandidates[(idx + 1) % pendingBreakCandidates.length];
      await chrome.storage.local.set({ pendingBreak: next });
      const icon = chrome.runtime.getURL('icons/icon48.png');
      chrome.notifications.create(`breet:prebreak:${Date.now()}`, {
        type: 'basic', iconUrl: icon, title: '예정 휴식 선택', message: `${next.name} · ${next.duration}분`, buttons: [ { title: '이걸로 시작' }, { title: '다른 제안' } ], priority: 0
      });
    }
  }
});

function notifyToast(title, message, durationMs = 10000) {
  const icon = chrome.runtime.getURL('icons/icon48.png');
  const id = `breet:toast:${Date.now()}`;
  chrome.notifications.create(id, {
    type: 'basic', iconUrl: icon, title, message, priority: 0
  });
  setTimeout(() => chrome.notifications.clear(id), durationMs);
}

async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: 'Play short notification sounds when timers end.'
    });
  } catch {}
}

async function playSound(path) {
  try {
    await ensureOffscreen();
    const url = chrome.runtime.getURL(path);
    chrome.runtime.sendMessage({ type: 'offscreen:play', url, volume: 0.5 });
  } catch {}
}

async function openPreBreakSelection(payload) {
  // 이전 세션 데이터 완전히 정리
  const allKeys = await chrome.storage.local.get(null);
  const keysToRemove = [];
  for (const key in allKeys) {
    if (key.startsWith('prebreakMeta_') || key.startsWith('pendingBreak_') || key.startsWith('pendingBreakCandidates_') || key.startsWith('allBreakCandidates_')) {
      keysToRemove.push(key);
    }
  }
  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove);
  }
  
  // 새로운 세션 시작
  const sessionId = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  // breakMinutes는 payload에서 명확히 가져오기 (5, 10, 3 중 하나)
  const breakMinutes = payload?.breakMinutes || 5;
  
  // 올바른 breakMinutes로 추천 생성
  const rec = await recommendNextBreakWithAI(breakMinutes);
  // 세션별 네임스페이스에 복사 저장
  const { pendingBreakCandidates = [] } = await chrome.storage.local.get('pendingBreakCandidates');
  
  // 새 세션의 메타데이터: otherUsed를 0으로 명확히 리셋
  const freshMeta = { otherUsed: 0, maxOther: 4, breakMinutes: breakMinutes };
  
  const ns = {}; 
  ns[`pendingBreak_${sessionId}`] = rec; 
  ns[`pendingBreakCandidates_${sessionId}`] = pendingBreakCandidates; 
  ns[`allBreakCandidates_${sessionId}`] = pendingBreakCandidates; // 초기 후보도 저장
  ns[`prebreakMeta_${sessionId}`] = freshMeta;
  await chrome.storage.local.set(ns);
  
  // 전역 prebreakMeta도 명확히 0으로 리셋 (타이머 버튼 클릭 시마다 4번 기회 보장)
  await chrome.storage.local.set({
    prebreakPayload: { ...payload, breakMinutes: breakMinutes },
    prebreakMeta: { ...freshMeta }, // 항상 0으로 리셋
    pendingBreak: rec,
    pendingBreakCandidates: pendingBreakCandidates,
    [STORAGE_KEYS.SESSION]: { phase: PHASES.SELECTING, mode: payload?.mode || 'pomodoro', startTs: null, endTs: null, pausedAt: null, remainingMs: null, workDuration: payload?.workMinutes || 25, breakDuration: breakMinutes }
  });
  // 팝업 대신 메시지 전송하여 인라인 카드 펼침 (세션 ID 포함)
  chrome.runtime.sendMessage({ type: 'breet:expandBreakSelection', payload: { ...payload, sessionId, breakMinutes } }).catch(() => {});
}

async function handleWorkEnd() {
  try {
    const { sessionState } = await chrome.storage.local.get(STORAGE_KEYS.SESSION);
    if (sessionState?.phase !== PHASES.WORK) return;
    await playSound('bgm/task_complete_bgm.mp3');
    notifyToast('과업 시간이 끝났습니다!', '쉬는 시간을 시작합니다.', 10000);
    const now = Date.now();
    const breakMinutes = sessionState?.breakDuration || 5;
    await chrome.storage.local.set({ lastWorkEndTs: now, [STORAGE_KEYS.SESSION]: { ...sessionState, phase: PHASES.WORK_ENDING, startTs: now, endTs: now + 10000 } });
    await chrome.alarms.create(ALARM_NAMES.TOAST, { when: Date.now() + 10000 });
    // WORK_ENDING에서는 카드를 자동 펼치지 않음 (타이머 버튼 클릭 시에만 표시)
  } catch (e) { console.error('[Timer] handleWorkEnd error', e); }
}

async function handleToastEnd() {
  try {
    // 사용자가 브레이크를 선택했는지 확인
    const { pendingBreak, sessionState } = await chrome.storage.local.get(['pendingBreak', STORAGE_KEYS.SESSION]);
    // WORK_ENDING 단계에서 사용자가 브레이크를 선택했으면 타이머 시작
    if (sessionState?.phase === PHASES.WORK_ENDING && pendingBreak) {
      await startBreakTimer();
    }
    // 선택하지 않았으면 카드는 그대로 유지 (사용자가 선택할 때까지 대기)
  } catch (e) { console.error('[Timer] handleToastEnd error', e); }
}

async function handleBreakEnd() {
  try {
    const { sessionState } = await chrome.storage.local.get(STORAGE_KEYS.SESSION);
    if (sessionState?.phase !== PHASES.BREAK) return;
    await playSound('bgm/rest_complete_bgm.mp3');
    notifyToast('쉬는 시간이 끝났습니다!', '다시 집중을 시작해볼까요?', 5000);
    await saveBreakHistory(true, sessionState.breakDuration);
    await stopAllTimers();
  } catch (e) { console.error('[Timer] handleBreakEnd error', e); }
}

async function handleBreakCompleted(payload) {
  try {
    const { completed = true, actualDuration = 0 } = payload || {};
    await chrome.alarms.clear(ALARM_NAMES.BREAK);
    await saveBreakHistory(!!completed, actualDuration || undefined);
    await stopAllTimers();
  } catch (e) { console.error('[Timer] handleBreakCompleted error', e); }
}

// 일일 새로고침: 00시에 dailyAffirmation과 timerDescription 생성
async function handleDailyRefresh() {
  try {
    const { userProfile = {} } = await chrome.storage.local.get('userProfile');
    const dk = dateKey();
    
    // dailyAffirmation 생성
    let affirmationText = '';
    try {
      const apiBase = await getApiBase();
      const res = await fetch(`${apiBase}/api/ai/dailyQuote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          context: { 
            workPatterns: userProfile.workPatterns || [], 
            healthConcerns: userProfile.healthConcerns || [] 
          }, 
          constraints: { 
            minChars: 6, 
            maxChars: 15, 
            tone: 'warm', 
            witty: true, 
            suffixEmoji: true, 
            seedPhrase: '쉬면서 일해야 능률이 올라가요!' 
          } 
        }),
      });
      if (res.ok) {
        const data = await res.json();
        affirmationText = data?.text || '';
      }
    } catch (e) {
      console.error('[Background] Daily affirmation generation error', e);
    }
    
    // timerDescription 생성 (같은 API 사용)
    let timerDescText = '';
    try {
      const apiBase = await getApiBase();
      const res = await fetch(`${apiBase}/api/ai/dailyQuote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          context: { 
            workPatterns: userProfile.workPatterns || [], 
            healthConcerns: userProfile.healthConcerns || [] 
          }, 
          constraints: { 
            minChars: 10, 
            maxChars: 28, 
            tone: 'warm', 
            witty: true, 
            suffixEmoji: true, 
            seedPhrase: '쉬면서 일해야 건강하고 행복해요!' 
          } 
        }),
      });
      if (res.ok) {
        const data = await res.json();
        timerDescText = data?.text || '';
      }
    } catch (e) {
      console.error('[Background] Timer description generation error', e);
    }
    
    // 저장
    const toSave = {};
    if (affirmationText) {
      toSave.dailyAffirmation = { dateKey: dk, text: affirmationText };
    }
    if (timerDescText) {
      toSave.timerDescription = { dateKey: dk, text: timerDescText };
    }
    
    if (Object.keys(toSave).length > 0) {
      await chrome.storage.local.set(toSave);
      console.log('[Background] Daily refresh completed', { dk, hasAffirmation: !!affirmationText, hasTimerDesc: !!timerDescText });
    }
  } catch (e) {
    console.error('[Background] handleDailyRefresh error', e);
    throw e;
  }
}

// 날짜 키 생성 (YYYY-MM-DD 형식)
function dateKey(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

// API 베이스 URL 가져오기 (auth.js와 동일한 로직)
async function getApiBase() {
  try {
    const { apiBase = 'http://localhost:8080' } = await chrome.storage.local.get('apiBase');
    return apiBase;
  } catch {
    return 'http://localhost:8080';
  }
}

async function clearAllTimers() {
  await chrome.alarms.clear(ALARM_NAMES.WORK);
  await chrome.alarms.clear(ALARM_NAMES.BREAK);
  await chrome.alarms.clear(ALARM_NAMES.TOAST);
}

// 브레이크 엔트리 생성자 (스키마 통일)
function makeBreakEntry({
  pendingBreak,
  completed,
  durationMin,
  workDuration = null,
  source = 'rule',
  recId = null,
  finishedTs = Date.now(),
  workEndTs = null
}) {
  const label =
    (workDuration === 25 && durationMin === 5) ? '25/5' :
    (workDuration === 50 && durationMin === 10) ? '50/10' :
    (workDuration === 15 && durationMin === 3) ? '15/3' :
    (workDuration === 1 && durationMin === 1) ? '1/1' :
    `${workDuration || '-'}/${durationMin}`;
  
  const wEnd = workEndTs ?? (finishedTs - durationMin * 60 * 1000);
  
  return {
    id: finishedTs,
    breakId: pendingBreak?.id ?? 'manual',
    breakType: pendingBreak?.type ?? 'unknown',
    breakName: pendingBreak?.name ?? null,
    duration: durationMin,
    workDuration: workDuration ?? null,
    label,
    completed: !!completed,
    timestamp: new Date(finishedTs).toISOString(),
    workEndTs: new Date(wEnd).toISOString(),
    recommendationSource: source,
    recId: recId ?? null
  };
}

// 단일 저장 경로 (background에서만 저장)
async function appendBreakHistory(entry) {
  try {
    const { breakHistory = [] } = await chrome.storage.local.get('breakHistory');
    await chrome.storage.local.set({ breakHistory: [...breakHistory, entry] });
  } catch (e) {
    console.error('[Timer] appendBreakHistory error', e);
  }
}

async function saveBreakHistory(completed, actualDuration) {
  try {
    const { pendingBreak } = await chrome.storage.local.get(STORAGE_KEYS.PENDING_BREAK);
    const { sessionState, lastWorkEndTs = null } = await chrome.storage.local.get([STORAGE_KEYS.SESSION, 'lastWorkEndTs']);
    if (!pendingBreak) return;
    const duration = Number(actualDuration) || sessionState?.breakDuration || 5;
    const workDur = sessionState?.workDuration || null;
    const finishedTs = Date.now();
    const workEndTs = lastWorkEndTs || (finishedTs - duration * 60 * 1000);
    
    const entry = makeBreakEntry({
      pendingBreak,
      completed: !!completed,
      durationMin: duration,
      workDuration: workDur,
      source: pendingBreak.source || 'rule',
      recId: pendingBreak.recId || null,
      finishedTs,
      workEndTs
    });
    
    await appendBreakHistory(entry);
  } catch (e) {
    console.error('[Timer] saveBreakHistory error', e);
  }
}


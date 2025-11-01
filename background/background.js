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
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm || !alarm.name) return;
  if (alarm.name === ALARM_NAMES.WORK) {
    handleWorkEnd();
  } else if (alarm.name === ALARM_NAMES.TOAST) {
    handleToastEnd();
  } else if (alarm.name === ALARM_NAMES.BREAK) {
    handleBreakEnd();
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
        const { [metaKey]: metaFallback = null } = await chrome.storage.local.get(metaKey);
        const { prebreakMeta = { otherUsed: 0, maxOther: 4, breakMinutes: breakMinutes || 5 } } = await chrome.storage.local.get('prebreakMeta');
        const preMeta = metaFallback || prebreakMeta || { otherUsed: 0, maxOther: 4, breakMinutes: breakMinutes || 5 };
        if ((preMeta.otherUsed || 0) >= (preMeta.maxOther || 4)) {
          sendResponse({ ok: false, error: 'limit_reached' });
          return;
        }
        const bm = breakMinutes ?? preMeta.breakMinutes ?? 5;
        await recommendNextBreakWithAI(bm, excludeIds);
        // Copy generic candidates into session-namespaced keys if sessionId provided
        if (sessionId) {
          const { pendingBreakCandidates = [], pendingBreak = null } = await chrome.storage.local.get(['pendingBreakCandidates','pendingBreak']);
          const ns = {}; ns[`pendingBreakCandidates_${sessionId}`] = pendingBreakCandidates; ns[`pendingBreak_${sessionId}`] = pendingBreak;
          await chrome.storage.local.set(ns);
        }
        const newMeta = { ...preMeta, otherUsed: (preMeta.otherUsed || 0) + 1, breakMinutes: bm };
        const toSet = {}; toSet[metaKey] = newMeta; toSet['prebreakMeta'] = newMeta; await chrome.storage.local.set(toSet);
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
  // 이전 후보/선택값 초기화 후, 현재 모드의 분수로 새 후보 생성
  const sessionId = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  await chrome.storage.local.set({ pendingBreak: null, pendingBreakCandidates: [] });
  const rec = await recommendNextBreakWithAI(payload?.breakMinutes);
  // 세션별 네임스페이스에 복사 저장
  const { pendingBreakCandidates = [] } = await chrome.storage.local.get('pendingBreakCandidates');
  const ns = {}; ns[`pendingBreak_${sessionId}`] = rec; ns[`pendingBreakCandidates_${sessionId}`] = pendingBreakCandidates; ns[`prebreakMeta_${sessionId}`] = { otherUsed: 0, maxOther: 4, breakMinutes: payload?.breakMinutes || 5 };
  await chrome.storage.local.set(ns);
  await chrome.storage.local.set({
    prebreakPayload: payload,
    prebreakMeta: { otherUsed: 0, maxOther: 4, breakMinutes: payload?.breakMinutes || 5 },
    pendingBreak: rec,
    [STORAGE_KEYS.SESSION]: { phase: PHASES.SELECTING, mode: payload?.mode || 'pomodoro', startTs: null, endTs: null, pausedAt: null, remainingMs: null, workDuration: payload?.workMinutes || 25, breakDuration: payload?.breakMinutes || 5 }
  });
  // 휴식시간에 따라 전용 팝업 파일 선택(동일 디자인, 파일만 분리)
  const page = (payload?.breakMinutes === 10) ? 'break-selection-10.html' : (payload?.breakMinutes === 3 ? 'break-selection-3.html' : 'break-selection-5.html');
  const url = chrome.runtime.getURL(`pages/${page}?sid=${sessionId}`);
  chrome.windows.create({ url, type: 'popup', width: 450, height: 500 });
}

async function handleWorkEnd() {
  try {
    const { sessionState } = await chrome.storage.local.get(STORAGE_KEYS.SESSION);
    if (sessionState?.phase !== PHASES.WORK) return;
    await playSound('bgm/task_complete_bgm.mp3');
    notifyToast('과업 시간이 끝났습니다!', '쉬는 시간을 시작합니다.', 10000);
    await chrome.storage.local.set({ [STORAGE_KEYS.SESSION]: { ...sessionState, phase: PHASES.WORK_ENDING, startTs: Date.now(), endTs: Date.now() + 10000 } });
    await chrome.alarms.create(ALARM_NAMES.TOAST, { when: Date.now() + 10000 });
  } catch (e) { console.error('[Timer] handleWorkEnd error', e); }
}

async function handleToastEnd() {
  try { await startBreakTimer(); } catch (e) { console.error('[Timer] handleToastEnd error', e); }
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

async function clearAllTimers() {
  await chrome.alarms.clear(ALARM_NAMES.WORK);
  await chrome.alarms.clear(ALARM_NAMES.BREAK);
  await chrome.alarms.clear(ALARM_NAMES.TOAST);
}

async function saveBreakHistory(completed, actualDuration) {
  try {
    const { pendingBreak } = await chrome.storage.local.get(STORAGE_KEYS.PENDING_BREAK);
    const { sessionState } = await chrome.storage.local.get(STORAGE_KEYS.SESSION);
    if (!pendingBreak) return;
    const duration = Number(actualDuration) || sessionState?.breakDuration || 5;
    const workDur = sessionState?.workDuration || null;
    const entry = {
      id: Date.now(),
      breakId: pendingBreak.id,
      breakType: pendingBreak.type,
      duration,
      workDuration: workDur,
      completed: !!completed,
      timestamp: new Date().toISOString(),
      recommendationSource: pendingBreak.source || 'rule',
    };
    const { breakHistory = [] } = await chrome.storage.local.get('breakHistory');
    await chrome.storage.local.set({ breakHistory: [...breakHistory, entry] });
  } catch (e) { console.error('[Timer] saveBreakHistory error', e); }
}


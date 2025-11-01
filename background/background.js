// Background Service Worker (MV3)
// Manages timers, alarms, notifications, and cross-page state.

const STORAGE_KEYS = {
  SESSION: 'sessionState',
  PROFILE: 'userProfile',
};

chrome.runtime.onInstalled.addListener(() => {
  // Initialize default session state on install/update
  chrome.storage.local.set({
    [STORAGE_KEYS.SESSION]: {
      mode: 'idle',
      startTs: null,
      workDuration: 25,
      breakDuration: 5,
    }
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm || !alarm.name) return;
  if (alarm.name.startsWith('breet:work:end:')) {
    shouldDelayNotification().then((delay) => {
      if (delay) {
        // Snooze 5 minutes
        chrome.alarms.create(`breet:snooze:${Date.now()}`, { when: Date.now() + 5 * 60 * 1000 });
      } else {
        createBreakNotification();
      }
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return;
  if (message.type === 'breet:startTimer') {
    const { mode, workMinutes, breakMinutes } = message.payload || {};
    startWorkTimer(mode, workMinutes, breakMinutes).then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (message.type === 'breet:stopTimer') {
    stopAllTimers().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});

async function startWorkTimer(mode, workMinutes = 25, breakMinutes = 5) {
  const startTs = Date.now();
  const when = Date.now() + workMinutes * 60 * 1000;
  await chrome.alarms.clearAll();
  await chrome.alarms.create(`breet:work:end:${startTs}`, { when });
  await chrome.storage.local.set({
    [STORAGE_KEYS.SESSION]: {
      mode: mode || 'pomodoro',
      startTs,
      workDuration: workMinutes,
      breakDuration: breakMinutes,
    }
  });
}

async function stopAllTimers() {
  await chrome.alarms.clearAll();
  await chrome.storage.local.set({
    [STORAGE_KEYS.SESSION]: {
      mode: 'idle',
      startTs: null,
      workDuration: 25,
      breakDuration: 5,
    }
  });
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

chrome.notifications.onButtonClicked.addListener((notifId, btnIdx) => {
  if (!notifId.startsWith('breet:break:')) return;
  if (btnIdx === 0) {
    // Start overlay via a new tab pointing to overlay page.
    chrome.tabs.create({ url: chrome.runtime.getURL('content/break-overlay.html') });
  }
});


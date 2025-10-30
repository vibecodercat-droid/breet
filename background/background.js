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
    createBreakNotification();
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

function createBreakNotification() {
  chrome.notifications.create(`breet:break:${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: '브레이크 타임',
    message: '잠깐 쉬어볼까요? 시작을 눌러 진행하세요.',
    buttons: [
      { title: '시작' },
      { title: '나중에' }
    ],
    priority: 0,
  });
}

chrome.notifications.onButtonClicked.addListener((notifId, btnIdx) => {
  if (!notifId.startsWith('breet:break:')) return;
  if (btnIdx === 0) {
    // Start overlay via a new tab pointing to overlay page.
    chrome.tabs.create({ url: chrome.runtime.getURL('content/break-overlay.html') });
  }
});


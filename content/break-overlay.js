let remainingSec = 60; // Default 1 min placeholder
let currentRec = null; // { id, type, duration, name, source, recId }

function fmt(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function tick() {
  const el = document.getElementById('timer');
  el.textContent = fmt(remainingSec);
  if (remainingSec > 0) {
    remainingSec -= 1;
    setTimeout(tick, 1000);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('complete').addEventListener('click', () => finish(true));
  document.getElementById('skip').addEventListener('click', () => finish(false));
  try {
    const { pendingBreak = null } = await chrome.storage.local.get('pendingBreak');
    if (pendingBreak && pendingBreak.duration) {
      currentRec = pendingBreak;
      remainingSec = Math.max(10, pendingBreak.duration * 60);
      // paint title/desc
      document.getElementById('breakName').textContent = pendingBreak.name || '브레이크';
    }
  } catch {}
  tick();
});

async function finish(completed) {
  const used = currentRec || { id: 'eye_20_20_20', type: 'eyeExercise', duration: 1, source: 'manual' };
  const minutesDone = Math.max(1, Math.round(((used.duration * 60) - remainingSec) / 60));
  const finishedTs = Date.now();
  
  // background에서 sessionState 정보 가져오기
  const { sessionState = null } = await chrome.storage.local.get('sessionState');
  const workDur = sessionState?.workDuration || null;
  const lastWorkEndTs = await chrome.storage.local.get('lastWorkEndTs').then(r => r.lastWorkEndTs || null);
  
  // entry 생성 (background의 makeBreakEntry와 동일한 스키마)
  const entry = {
    id: finishedTs,
    breakId: used.id,
    breakType: used.type,
    breakName: used.name || null,
    duration: minutesDone,
    workDuration: workDur,
    label: (workDur === 25 && minutesDone === 5) ? '25/5' :
           (workDur === 50 && minutesDone === 10) ? '50/10' :
           (workDur === 15 && minutesDone === 3) ? '15/3' :
           (workDur === 1 && minutesDone === 1) ? '1/1' :
           `${workDur || '-'}/${minutesDone}`,
    completed: !!completed,
    timestamp: new Date(finishedTs).toISOString(),
    workEndTs: lastWorkEndTs ? new Date(lastWorkEndTs).toISOString() : new Date(finishedTs - minutesDone * 60 * 1000).toISOString(),
    recommendationSource: used.source || 'manual',
    recId: used.recId || null
  };
  
  // background로 메시지 전송하여 저장 (단일 저장 경로)
  chrome.runtime.sendMessage({
    type: 'breet:saveBreakHistory',
    entry
  }).catch(err => {
    console.error('[BreakOverlay] Failed to send save message:', err);
    // 폴백: 직접 저장 (하지만 스키마 통일을 위해 background 저장 권장)
    chrome.storage.local.get('breakHistory').then(({ breakHistory = [] }) => {
      chrome.storage.local.set({ breakHistory: [...breakHistory, entry] });
    });
  });
  
  // reset session state to idle so popup can return to default UI
  await chrome.storage.local.set({ sessionState: { mode: 'idle', startTs: null, workDuration: 25, breakDuration: 5 } });
  await chrome.storage.local.remove('pendingBreak');
  window.close();
}


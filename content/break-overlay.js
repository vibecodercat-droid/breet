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
  const entry = {
    id: Date.now(),
    breakId: used.id,
    breakType: used.type,
    duration: minutesDone,
    completed,
    timestamp: new Date().toISOString(),
    recommendationSource: used.source || 'manual',
    recId: used.recId || null,
  };
  const { breakHistory = [] } = await chrome.storage.local.get('breakHistory');
  await chrome.storage.local.set({ breakHistory: [...breakHistory, entry] });
  // reset session state to idle so popup can return to default UI
  await chrome.storage.local.set({ sessionState: { mode: 'idle', startTs: null, workDuration: 25, breakDuration: 5 } });
  await chrome.storage.local.remove('pendingBreak');
  window.close();
}


let remainingSec = 60; // Default 1 min placeholder

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
  tick();
});

async function finish(completed) {
  const entry = {
    id: Date.now(),
    breakId: 'eye_20_20_20',
    breakType: 'eyeExercise',
    duration: Math.round((60 - remainingSec) / 60),
    completed,
    timestamp: new Date().toISOString(),
  };
  const { breakHistory = [] } = await chrome.storage.local.get('breakHistory');
  await chrome.storage.local.set({ breakHistory: [...breakHistory, entry] });
  window.close();
}


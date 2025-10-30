function parseTimeHHmm(v) {
  const m = /^([0-2]\d):(\d{2})$/.exec(String(v || '').trim());
  if (!m) return null;
  const hh = Math.min(23, parseInt(m[1], 10));
  const mm = Math.min(59, parseInt(m[2], 10));
  return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
}

document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const workPatterns = Array.from(form.querySelectorAll('input[name="workPatterns"]:checked')).map(i => i.value);
  const healthConcerns = Array.from(form.querySelectorAll('input[name="healthConcerns"]:checked')).map(i => i.value);
  const routineType = form.querySelector('input[name="routineType"]:checked').value;
  const startTime = parseTimeHHmm(document.getElementById('startTime').value) || '09:00';
  const endTime = parseTimeHHmm(document.getElementById('endTime').value) || '18:00';
  const includeWeekends = !!document.getElementById('includeWeekends').checked;

  const routineMap = {
    pomodoro: { type: 'pomodoro', workDuration: 25, breakDuration: 5 },
    long: { type: 'long', workDuration: 50, breakDuration: 10 },
    short: { type: 'short', workDuration: 15, breakDuration: 3 },
  };

  const userProfile = {
    onboardingCompleted: true,
    onboardingDate: Date.now(),
    workPatterns,
    healthConcerns,
    preferredBreakTypes: [],
    routine: routineMap[routineType] || routineMap.pomodoro,
    schedule: { startTime, endTime, includeWeekends }
  };

  await chrome.storage.local.set({ userProfile });
  window.location.href = chrome.runtime.getURL('../popup/popup.html');
});


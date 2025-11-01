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
  const startTime = parseTimeHHmm(document.getElementById('startTime').value) || '09:00';
  const endTime = parseTimeHHmm(document.getElementById('endTime').value) || '18:00';
  const includeWeekends = !!document.getElementById('includeWeekends').checked;

  // 루틴 설정 UI 제거 → 기본값을 사용(포모도로 25/5)
  const defaultRoutine = { type: 'pomodoro', workDuration: 25, breakDuration: 5 };

  const userProfile = {
    onboardingCompleted: true,
    onboardingDate: Date.now(),
    workPatterns,
    healthConcerns,
    preferredBreakTypes: [],
    routine: defaultRoutine,
    schedule: { startTime, endTime, includeWeekends }
  };

  await chrome.storage.local.set({ userProfile });
  window.location.href = chrome.runtime.getURL('../popup/popup.html');
});


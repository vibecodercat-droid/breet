import { toCsvAndDownload } from "../lib/csv.js";

function parseTimeHHmm(v) {
  const m = /^([0-2]\d):(\d{2})$/.exec(String(v || '').trim());
  if (!m) return null;
  const hh = Math.min(23, parseInt(m[1], 10));
  const mm = Math.min(59, parseInt(m[2], 10));
  return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
}

document.addEventListener('DOMContentLoaded', async () => {
  const { userProfile = {} } = await chrome.storage.local.get('userProfile');
  const sched = userProfile.schedule || { startTime: '09:00', endTime: '18:00', includeWeekends: false };
  document.getElementById('startTime').value = sched.startTime;
  document.getElementById('endTime').value = sched.endTime;
  document.getElementById('includeWeekends').checked = !!sched.includeWeekends;

  document.getElementById('save').addEventListener('click', async () => {
    const startTime = parseTimeHHmm(document.getElementById('startTime').value) || '09:00';
    const endTime = parseTimeHHmm(document.getElementById('endTime').value) || '18:00';
    const includeWeekends = !!document.getElementById('includeWeekends').checked;
    const next = {
      ...(userProfile || {}),
      schedule: { startTime, endTime, includeWeekends },
    };
    await chrome.storage.local.set({ userProfile: next });
    alert('저장되었습니다.');
  });

  document.getElementById('export').addEventListener('click', async () => {
    const { breakHistory = [] } = await chrome.storage.local.get('breakHistory');
    toCsvAndDownload(breakHistory, `breet_break_history_${new Date().toISOString().slice(0,10)}.csv`);
  });

  document.getElementById('clear').addEventListener('click', async () => {
    if (!confirm('정말로 모든 데이터를 삭제할까요?')) return;
    await chrome.storage.local.clear();
    alert('삭제되었습니다.');
  });
});


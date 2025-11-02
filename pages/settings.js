import { toCsvAndDownload } from "../lib/csv.js";

function parseTimeHHmm(v) {
  const m = /^([0-2]\d):(\d{2})$/.exec(String(v || '').trim());
  if (!m) return null;
  const hh = Math.min(23, parseInt(m[1], 10));
  const mm = Math.min(59, parseInt(m[2], 10));
  return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
}

// Chips helper
function createChip(label, isSelected) {
  const el = document.createElement('span');
  el.className = 'px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-700 border border-transparent cursor-pointer select-none';
  if (isSelected) {
    el.classList.add('bg-blue-50','text-blue-700','border-blue-300');
  }
  el.textContent = label;
  return el;
}

async function renderWorkPatterns() {
  const { userProfile = {} } = await chrome.storage.local.get('userProfile');
  const workBox = document.getElementById('workPatterns');
  if (!workBox) return;
  
  workBox.innerHTML = '';
  const workAll = ['coding','writing','design','meeting'];
  const WORK_LABELS = { coding: '코딩', writing: '문서작성', design: '디자인', meeting: '미팅' };
  const workSelected = new Set(userProfile.workPatterns || []);
  
  workAll.forEach((w) => {
    const el = createChip(WORK_LABELS[w] || w, workSelected.has(w));
    el.dataset.value = w;
    el.addEventListener('click', async () => {
      const { userProfile = {} } = await chrome.storage.local.get('userProfile');
      const current = new Set(userProfile.workPatterns || []);
      if (current.has(w)) {
        current.delete(w);
        el.classList.remove('bg-blue-50','text-blue-700','border-blue-300');
      } else {
        current.add(w);
        el.classList.add('bg-blue-50','text-blue-700','border-blue-300');
      }
      const next = {
        ...userProfile,
        workPatterns: Array.from(current),
      };
      await chrome.storage.local.set({ userProfile: next });
    });
    workBox.appendChild(el);
  });
}

async function renderHealthConcerns() {
  const { userProfile = {} } = await chrome.storage.local.get('userProfile');
  const healthBox = document.getElementById('healthConcerns');
  if (!healthBox) return;
  
  healthBox.innerHTML = '';
  const healthAll = ['eyeStrain','neckPain','backPain','stress'];
  const HEALTH_LABELS = { eyeStrain: '눈 피로', neckPain: '목 통증', backPain: '허리 통증', stress: '스트레스' };
  const healthSelected = new Set(userProfile.healthConcerns || []);
  
  healthAll.forEach((h) => {
    const el = createChip(HEALTH_LABELS[h] || h, healthSelected.has(h));
    el.dataset.value = h;
    el.addEventListener('click', async () => {
      const { userProfile = {} } = await chrome.storage.local.get('userProfile');
      const current = new Set(userProfile.healthConcerns || []);
      if (current.has(h)) {
        current.delete(h);
        el.classList.remove('bg-blue-50','text-blue-700','border-blue-300');
      } else {
        current.add(h);
        el.classList.add('bg-blue-50','text-blue-700','border-blue-300');
      }
      const next = {
        ...userProfile,
        healthConcerns: Array.from(current),
      };
      await chrome.storage.local.set({ userProfile: next });
    });
    healthBox.appendChild(el);
  });
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

  // 작업 유형 및 건강 관심사 렌더링
  await renderWorkPatterns();
  await renderHealthConcerns();
});


document.addEventListener('DOMContentLoaded', () => {
  load();
  document.getElementById('confirm').addEventListener('click', onConfirm);
  document.getElementById('next').addEventListener('click', onNext);
});

async function load() {
  const { pendingBreak = null, pendingBreakCandidates = [], prebreakPayload = null } = await chrome.storage.local.get(['pendingBreak','pendingBreakCandidates','prebreakPayload']);
  window._cands = (pendingBreakCandidates && pendingBreakCandidates.length ? pendingBreakCandidates : (pendingBreak ? [pendingBreak] : [])).slice(0,3);
  window._selIdx = 0;
  window._payload = prebreakPayload;
  render();
}

function render(){
  const box = document.getElementById('list');
  if (!box) return;
  box.innerHTML = '';
  (window._cands||[]).forEach((c, i) => {
    const div = document.createElement('div');
    div.className = 'p-3 bg-white rounded-lg shadow-sm flex items-center justify-between cursor-pointer ' + (i===window._selIdx ? 'ring-2 ring-blue-500' : '');
    div.addEventListener('click', ()=>{ window._selIdx = i; render(); });
    const left = document.createElement('div');
    left.innerHTML = `<div class="font-semibold">${c?.name||''}</div><div class="text-sm text-gray-600">${c?.type||''}</div>`;
    div.appendChild(left);
    box.appendChild(div);
  });
}

async function onConfirm() {
  const sel = (window._cands||[])[window._selIdx];
  if (sel) await chrome.storage.local.set({ pendingBreak: sel });
  if (window._payload) chrome.runtime.sendMessage({ type: 'breet:startTimer', payload: window._payload });
  window.close();
}

async function onNext() {
  const list = window._cands || []; if (!list.length) return;
  window._selIdx = (window._selIdx + 1) % list.length;
  await chrome.storage.local.set({ pendingBreak: list[window._selIdx] });
  render();
}



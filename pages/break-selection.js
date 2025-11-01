let usedIds = new Set();

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
  (window._cands||[]).forEach(c => { if (c?.id) usedIds.add(c.id); });
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
    // 한글 설명만 표시
    left.innerHTML = `<div class="font-semibold">${c?.name||''}</div>`;
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
  const nextBtn = document.getElementById('next');
  if (nextBtn) { nextBtn.disabled = true; nextBtn.textContent = '생성 중...'; }
  try {
    const excludeIds = Array.from(usedIds);
    const bm = window._payload?.breakMinutes || 5;
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'breet:requestNewBreaks', payload: { breakMinutes: bm, excludeIds } }, (resp) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        if (!resp || !resp.ok) return reject(new Error(resp?.error || 'failed'));
        resolve();
      });
    });
    const { pendingBreakCandidates = [] } = await chrome.storage.local.get('pendingBreakCandidates');
    window._cands = (pendingBreakCandidates || []).slice(0,3);
    window._selIdx = 0;
    (window._cands||[]).forEach(c => { if (c?.id) usedIds.add(c.id); });
    render();
  } catch (e) {
    console.error('[Selection] next error', e);
  } finally {
    if (nextBtn) { nextBtn.disabled = false; nextBtn.textContent = '다른 제안 받기'; }
  }
}



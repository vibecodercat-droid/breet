let allCandidates = [];
let currentPage = 0;
let selectedIndex = 0; // absolute index in allCandidates
const maxPages = 5;
let payload = null;
let isLoading = false;

document.addEventListener('DOMContentLoaded', async () => {
  await initialize();
  document.getElementById('confirm').addEventListener('click', onConfirm);
  const prev = document.getElementById('prev'); if (prev) prev.addEventListener('click', onPrev);
  document.getElementById('next').addEventListener('click', onNext);
});

async function initialize() {
  try {
    const { pendingBreakCandidates = [], prebreakPayload = null, allBreakCandidates = [] } = await chrome.storage.local.get(['pendingBreakCandidates','prebreakPayload','allBreakCandidates']);
    payload = prebreakPayload;
    if (Array.isArray(allBreakCandidates) && allBreakCandidates.length >= 3) {
      allCandidates = allBreakCandidates; currentPage = 0; render(); return;
    }
    if (pendingBreakCandidates && pendingBreakCandidates.length >= 3) {
      allCandidates = pendingBreakCandidates.slice(0,3); currentPage = 0; await chrome.storage.local.set({ allBreakCandidates: allCandidates }); render(); return;
    }
    await loadNewPage();
  } catch (e) {
    console.error('[Selection] init error', e); showError('초기화 실패. 다시 시도해주세요.');
  }
}

function render(){
  const box = document.getElementById('list'); if (!box) return;
  const startIdx = currentPage * 3; const pageItems = allCandidates.slice(startIdx, startIdx + 3);
  box.innerHTML = '';
  if (!pageItems.length) {
    box.innerHTML = '<div class="text-center text-gray-500 py-8">추천을 불러오는 중...</div>';
  } else {
    pageItems.forEach((c, i) => {
      const div = document.createElement('div');
      const isSel = (startIdx + i) === selectedIndex;
      div.className = 'p-4 rounded-lg shadow-sm cursor-pointer transition-colors ' + (isSel ? 'border-2 border-blue-500 bg-blue-50' : 'bg-white');
      div.addEventListener('click', () => { selectedIndex = startIdx + i; render(); });
      const left = document.createElement('div');
      left.innerHTML = `<div class=\"font-semibold text-gray-900 text-base mb-1\">${c?.name||''}</div>`;
      div.appendChild(left);
      box.appendChild(div);
    });
  }
  updateButtons();
}

function updateButtons() {
  const confirmBtn = document.getElementById('confirm');
  const prevBtn = document.getElementById('prev');
  const nextBtn = document.getElementById('next');
  const pageInfo = document.getElementById('pageInfo');
  const currentItems = allCandidates.slice(currentPage * 3, currentPage * 3 + 3);
  if (confirmBtn) confirmBtn.disabled = currentItems.length === 0 || isLoading;
  if (prevBtn) prevBtn.disabled = currentPage === 0 || isLoading;
  if (nextBtn) {
    const hasNextPage = (currentPage + 1) * 3 < allCandidates.length;
    const canLoadMore = currentPage < maxPages - 1;
    nextBtn.disabled = isLoading || (!hasNextPage && !canLoadMore);
    if (isLoading) nextBtn.textContent = '생성 중...';
    else if (hasNextPage) nextBtn.textContent = '다음 제안';
    else if (canLoadMore) nextBtn.textContent = '새 제안 받기';
    else nextBtn.textContent = '마지막 제안';
  }
  if (pageInfo) {
    const totalPages = Math.min(Math.ceil(allCandidates.length / 3), maxPages);
    pageInfo.textContent = `${currentPage + 1} / ${totalPages || 1}`;
  }
}

async function onConfirm() {
  const startIdx = currentPage * 3; const pageItems = allCandidates.slice(startIdx, startIdx + 3);
  if (!pageItems.length) return;
  const relativeIdx = Math.max(0, Math.min(2, selectedIndex - startIdx));
  const sel = pageItems[relativeIdx];
  await chrome.storage.local.set({ pendingBreak: sel });
  if (payload) chrome.runtime.sendMessage({ type: 'breet:startTimer', payload });
  await chrome.storage.local.remove('allBreakCandidates');
  window.close();
}

async function onPrev() { if (currentPage <= 0) return; currentPage--; render(); }

async function onNext() {
  try {
    const hasNextPage = (currentPage + 1) * 3 < allCandidates.length;
    if (hasNextPage) { currentPage++; render(); return; }
    if (currentPage >= maxPages - 1) return;
    await loadNewPage();
  } catch (e) { console.error('[Selection] next error', e); }
}

async function loadNewPage() {
  if (isLoading) return; isLoading = true; updateButtons();
  try {
    const excludeIds = allCandidates.map(c => c.id);
    const bm = payload?.breakMinutes || 5;
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'breet:requestNewBreaks', payload: { breakMinutes: bm, excludeIds } }, (resp) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        if (!resp || !resp.ok) return reject(new Error(resp?.error || 'failed'));
        resolve();
      });
    });
    const { pendingBreakCandidates = [] } = await chrome.storage.local.get('pendingBreakCandidates');
    if (!Array.isArray(pendingBreakCandidates) || pendingBreakCandidates.length < 3) throw new Error('Not enough new candidates');
    allCandidates = [...allCandidates, ...pendingBreakCandidates.slice(0,3)];
    await chrome.storage.local.set({ allBreakCandidates: allCandidates });
    currentPage++;
    render();
  } catch (e) {
    console.error('[Selection] Load new page error', e); showError('새로운 추천을 불러오는데 실패했습니다.');
  } finally { isLoading = false; updateButtons(); }
}

function showError(message) {
  const list = document.getElementById('list');
  if (!list) return;
  list.innerHTML = `<div class="text-center py-8"><div class="text-red-500 mb-3">${message}</div><button id="retryBtn" class="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300">다시 시도</button></div>`;
  const btn = document.getElementById('retryBtn');
  if (btn) btn.addEventListener('click', () => location.reload());
}

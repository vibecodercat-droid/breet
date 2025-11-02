import { toCsvAndDownload } from "../lib/csv.js";
import { groupByWeekdayCompletion } from "../lib/stats-manager.js";

function startOfLocalDay(ts = Date.now()) {
  const d = new Date(ts);
  d.setHours(0,0,0,0);
  return d.getTime();
}

function isSameLocalDay(tsA, tsB) {
  return startOfLocalDay(tsA) === startOfLocalDay(tsB);
}

// 세션(브레이크) 완료 기준 통계
async function refreshSessionStats() {
  const { breakHistory = [] } = await chrome.storage.local.get('breakHistory');
  const today = breakHistory.filter((b) => isSameLocalDay(Date.parse(b.timestamp || 0), Date.now()));
  const done = today.filter((b) => b.completed).length;
  const suggested = today.length;
  const rate = suggested ? Math.round((done / suggested) * 100) : 0;
  document.getElementById('sessionDone').textContent = String(done);
  document.getElementById('sessionSuggested').textContent = String(suggested);
  document.getElementById('sessionRate').textContent = `${rate}%`;
}

// 투두리스트 기준 통계
async function refreshTodoStats() {
  const dk = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const { todosByDate = {} } = await chrome.storage.local.get('todosByDate');
  const todos = Array.isArray(todosByDate[dk]) ? todosByDate[dk] : [];
  const done = todos.filter((t) => t.completed).length;
  const total = todos.length;
  const rate = total ? Math.round((done / total) * 100) : 0;
  document.getElementById('todoDone').textContent = String(done);
  document.getElementById('todoTotal').textContent = String(total);
  document.getElementById('todoRate').textContent = `${rate}%`;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('exportCsv').addEventListener('click', async () => {
    const { breakHistory = [] } = await chrome.storage.local.get('breakHistory');
    toCsvAndDownload(breakHistory, `breet_break_history_${new Date().toISOString().slice(0,10)}.csv`);
  });
  refreshSessionStats();
  refreshTodoStats();
  renderWeekly();
});

async function renderWeekly(){
  const { breakHistory = [] } = await chrome.storage.local.get('breakHistory');
  const weekly = groupByWeekdayCompletion(breakHistory);
  const labels = ['일','월','화','수','목','금','토'];
  const data = weekly.map(w => Math.round((w.rate||0)*100));
  const ctx = document.getElementById('weeklyChart').getContext('2d');
  // Minimal vendor renders bars
  new window.Chart(ctx, { data: { labels, datasets: [{ data }] } });
}


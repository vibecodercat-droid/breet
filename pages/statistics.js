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

async function refreshToday() {
  const { breakHistory = [] } = await chrome.storage.local.get('breakHistory');
  const today = breakHistory.filter((b) => isSameLocalDay(Date.parse(b.timestamp || 0), Date.now()));
  const done = today.filter((b) => b.completed).length;
  const suggested = today.length;
  const rate = suggested ? Math.round((done / suggested) * 100) : 0;
  document.getElementById('todayDone').textContent = String(done);
  document.getElementById('todaySuggested').textContent = String(suggested);
  document.getElementById('todayRate').textContent = `${rate}%`;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('exportCsv').addEventListener('click', async () => {
    const { breakHistory = [] } = await chrome.storage.local.get('breakHistory');
    toCsvAndDownload(breakHistory, `breet_break_history_${new Date().toISOString().slice(0,10)}.csv`);
  });
  refreshToday();
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


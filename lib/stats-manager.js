import { startOfLocalDay } from './date-utils.js';

export function computeDailyStats(breakHistory = [], date = new Date()) {
  const start = startOfLocalDay(+date);
  const end = start + 24 * 60 * 60 * 1000; // 다음 날 00:00:00
  const items = breakHistory.filter((b) => {
    const t = Date.parse(b.timestamp || 0);
    return t >= start && t < end;
  });
  const total = items.length;
  const completed = items.filter((b) => b.completed).length;
  return { total, completed, rate: total ? completed / total : 0 };
}

export function groupByWeekdayCompletion(breakHistory = []) {
  const counts = Array.from({ length: 7 }, () => ({ total: 0, completed: 0 }));
  for (const b of breakHistory) {
    const t = Date.parse(b.timestamp || 0);
    const d = new Date(t); // 로컬 시간대로 해석
    const i = d.getDay(); // 로컬 요일 (0=일요일)
    counts[i].total += 1;
    if (b.completed) counts[i].completed += 1;
  }
  return counts.map((c) => ({ ...c, rate: c.total ? c.completed / c.total : 0 }));
}


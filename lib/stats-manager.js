export function computeDailyStats(breakHistory = [], date = new Date()) {
  const start = new Date(date); start.setHours(0,0,0,0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const items = breakHistory.filter((b) => {
    const t = Date.parse(b.timestamp || 0);
    return t >= start.getTime() && t < end.getTime();
  });
  const total = items.length;
  const completed = items.filter((b) => b.completed).length;
  return { total, completed, rate: total ? completed / total : 0 };
}

export function groupByWeekdayCompletion(breakHistory = []) {
  const counts = Array.from({ length: 7 }, () => ({ total: 0, completed: 0 }));
  for (const b of breakHistory) {
    const d = new Date(b.timestamp || 0);
    const i = d.getDay();
    counts[i].total += 1;
    if (b.completed) counts[i].completed += 1;
  }
  return counts.map((c) => ({ ...c, rate: c.total ? c.completed / c.total : 0 }));
}


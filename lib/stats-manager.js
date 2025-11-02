import { startOfLocalDay } from './date-utils.js';

/**
 * 특정 날짜의 일별 통계 계산
 * @param {Array} breakHistory - 브레이크 기록 배열
 * @param {Date|number} date - 계산할 날짜
 * @returns {{total: number, completed: number, rate: number}}
 */
export function computeDailyStats(breakHistory = [], date = new Date()) {
  const start = startOfLocalDay(+date);
  const end = start + 24 * 60 * 60 * 1000;
  
  const items = breakHistory.filter((b) => {
    const t = Date.parse(b.timestamp || 0);
    return t >= start && t < end;
  });
  
  const total = items.length;
  const completed = items.filter((b) => b.completed).length;
  const rate = total ? completed / total : 0;
  
  return { total, completed, rate };
}

/**
 * 요일별 완료율 그룹화
 * @param {Array} breakHistory - 브레이크 기록 배열
 * @returns {Array<{total: number, completed: number, rate: number}>} 요일별 통계 (0=일요일, 6=토요일)
 */
export function groupByWeekdayCompletion(breakHistory = []) {
  const counts = Array.from({ length: 7 }, () => ({ total: 0, completed: 0 }));
  
  for (const b of breakHistory) {
    const t = Date.parse(b.timestamp || 0);
    const dayOfWeek = new Date(t).getDay();
    counts[dayOfWeek].total += 1;
    if (b.completed) {
      counts[dayOfWeek].completed += 1;
    }
  }
  
  return counts.map((c) => ({
    ...c,
    rate: c.total ? c.completed / c.total : 0
  }));
}


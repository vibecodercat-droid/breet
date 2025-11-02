// 날짜 유틸리티 - 항상 로컬 기준으로 처리

/**
 * 로컬 날짜의 시작 시각 (00:00:00) 반환
 * @param {number} ts - 타임스탬프 (ms)
 * @returns {number} 로컬 00:00:00의 타임스탬프
 */
export function startOfLocalDay(ts = Date.now()) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 로컬 날짜 키 (YYYY-MM-DD 형식)
 * @param {number|Date} ts - 타임스탬프 또는 Date 객체
 * @returns {string} YYYY-MM-DD (로컬 기준)
 */
export function localDateKey(ts = Date.now()) {
  const d = ts instanceof Date ? ts : new Date(ts);
  d.setHours(0, 0, 0, 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 두 타임스탬프가 같은 로컬 날짜인지 확인
 * @param {number} tsA - 첫 번째 타임스탬프
 * @param {number} tsB - 두 번째 타임스탬프
 * @returns {boolean}
 */
export function isSameLocalDay(tsA, tsB) {
  return startOfLocalDay(tsA) === startOfLocalDay(tsB);
}

/**
 * YYYY-MM-DD 문자열을 로컬 타임스탬프로 변환
 * @param {string} dateKey - YYYY-MM-DD 형식
 * @returns {number} 해당 날짜 로컬 00:00:00의 타임스탬프
 */
export function parseLocalDateKey(dateKey) {
  // YYYY-MM-DD를 로컬 날짜로 해석 (UTC가 아닌)
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d, 0, 0, 0, 0);
  return date.getTime();
}


export const BREAKS = [
  { id: 'eye_20_20_20', name: '눈 운동 20-20-20', duration: 1, type: 'eyeExercise', description: '20초간 먼 곳 보기', instructions: ['20초 동안 6m 이상 먼 곳 보기'] },
  { id: 'neck_stretch_3', name: '목 스트레칭', duration: 3, type: 'stretching', description: '천천히 좌우/앞뒤', instructions: ['좌/우 각각 10초', '앞/뒤 각각 10초'] },
  { id: 'box_breath_4', name: '박스 호흡', duration: 4, type: 'breathing', description: '4-4-4-4', instructions: ['들이마시기 4', '멈추기 4', '내쉬기 4', '멈추기 4'] },
  { id: 'drink_water_1', name: '물 마시기', duration: 1, type: 'hydration', description: '물을 한 컵 마셔요', instructions: ['물을 준비하고 천천히 마시기'] },
  { id: 'walk_in_place_3', name: '제자리 걷기', duration: 3, type: 'movement', description: '가볍게 몸을 풀어요', instructions: ['가볍게 3분 걷기'] },
];

export function getBreakById(id) {
  return BREAKS.find((b) => b.id === id) || null;
}

export function getNextBreak(prevBreakId, preferredTypes = [], recentHistory = []) {
  const avoidId = prevBreakId || (recentHistory.length ? recentHistory[recentHistory.length - 1].breakId : null);
  const pool = BREAKS.filter((b) => b.id !== avoidId);
  const preferredPool = preferredTypes.length ? pool.filter((b) => preferredTypes.includes(b.type)) : pool;
  return preferredPool[0] || pool[0] || BREAKS[0];
}


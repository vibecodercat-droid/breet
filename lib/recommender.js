import { requestAiRecommendation } from './ai-client.js';
import { BREAKS, getBreakById } from './break-library.js';

function sanitizeDuration(min) {
  const n = Number(min);
  if (!isFinite(n) || n <= 0) return 1;
  return Math.min(15, Math.max(1, Math.round(n)));
}

function normalizeToLibrary(rec) {
  if (!rec) return null;
  if (rec.id && getBreakById(rec.id)) {
    const b = getBreakById(rec.id);
    return { id: b.id, type: b.type, duration: sanitizeDuration(rec.duration || b.duration), name: b.name };
  }
  // fallback by type
  if (rec.type) {
    const byType = BREAKS.find(b => b.type === rec.type) || BREAKS[0];
    return { id: byType.id, type: byType.type, duration: sanitizeDuration(rec.duration || byType.duration), name: byType.name };
  }
  const def = BREAKS[0];
  return { id: def.id, type: def.type, duration: def.duration, name: def.name };
}

function isSameLocalDay(tsA, tsB) {
  const a = new Date(tsA); a.setHours(0,0,0,0);
  const b = new Date(tsB); b.setHours(0,0,0,0);
  return a.getTime() === b.getTime();
}

const TYPE_DESCRIPTIONS = {
  eyeExercise: [
    '멀리 보며 눈 근육 이완하기',
    '눈 피로 해소를 위한 휴식',
    '화면에서 눈 떼고 먼 곳 응시',
    '눈 건강을 위한 간단한 운동'
  ],
  stretching: [
    '목과 어깨의 긴장을 풀어주기',
    '굳은 근육을 부드럽게 펴기',
    '상체를 천천히 스트레칭하기',
    '몸의 뭉친 부분을 풀어주기'
  ],
  breathing: [
    '깊게 호흡하며 마음 안정시키기',
    '천천히 숨 쉬며 스트레스를 풀기',
    '호흡에 집중하며 긴장 풀기',
    '심호흡으로 몸과 마음 이완하기'
  ],
  hydration: [
    '물 한 잔 마시며 수분 보충하기',
    '천천히 물을 마시며 휴식하기',
    '건강을 위해 충분한 수분 섭취',
    '물을 마시며 잠깐 쉬어가기'
  ],
  movement: [
    '가볍게 몸을 움직이며 활력 찾기',
    '제자리에서 걷기나 스트레칭',
    '앉아있던 자세에서 벗어나기',
    '몸을 가볍게 풀어주는 시간'
  ]
};

function getRandomDescription(type) {
  const list = TYPE_DESCRIPTIONS[type] || TYPE_DESCRIPTIONS.eyeExercise;
  return list[Math.floor(Math.random() * list.length)];
}

function isValidKoreanDescription(s) {
  if (!s || typeof s !== 'string') return false;
  const t = s.trim();
  if (t.length < 6 || t.length > 20) return false;
  return /^[가-힣\s·]+$/.test(t);
}

function pickRuleBasedSet(requiredCount, allowedDuration, preferredTypes = [], recentHistory = [], excludeIds = []) {
  const recentTypes = recentHistory.slice(-3).map(r => r.breakType);
  // de-dup by id, avoid recent types, prefer preferredTypes
  const pool = BREAKS.filter(b => !recentTypes.includes(b.type) && !excludeIds.includes(b.id));
  const prioritized = [
    ...pool.filter(b => preferredTypes.includes(b.type)),
    ...pool.filter(b => !preferredTypes.includes(b.type))
  ];
  const picked = [];
  const used = new Set();
  for (const b of prioritized) {
    if (picked.length >= requiredCount) break;
    if (used.has(b.id)) continue;
    used.add(b.id);
    picked.push({ id: b.id, type: b.type, duration: allowedDuration, name: `${allowedDuration}분 ${getRandomDescription(b.type)}` });
  }
  // pad if not enough
  for (const b of BREAKS) {
    if (picked.length >= requiredCount) break;
    if (used.has(b.id)) continue;
    if (excludeIds.includes(b.id)) continue;
    used.add(b.id);
    picked.push({ id: b.id, type: b.type, duration: allowedDuration, name: `${allowedDuration}분 ${getRandomDescription(b.type)}` });
  }
  return picked.slice(0, requiredCount);
}

function fillToRequired(cands, requiredCount, allowedDuration, excludeIds = []) {
  const out = [...cands];
  const usedIds = new Set([...(out.map(c => c.id)), ...excludeIds]);
  const types = ['eyeExercise','stretching','breathing','hydration','movement'];
  let i = 0; let seed = Date.now();
  while (out.length < requiredCount) {
    const type = types[i % types.length]; i++;
    let id = `gen_${seed++}_${type}`;
    while (usedIds.has(id)) { id = `gen_${seed++}_${type}`; }
    usedIds.add(id);
    out.push({ id, type, duration: allowedDuration, name: `${allowedDuration}분 ${getRandomDescription(type)}`, rationale: '새로운 추천입니다.' });
  }
  return out.slice(0, requiredCount);
}

export async function recommendNextBreakWithAI(expectedBreakMinutes, excludeIds = []) {
  const { userProfile = {} } = await chrome.storage.local.get('userProfile');
  const { breakHistory = [] } = await chrome.storage.local.get('breakHistory');
  const { sessionState = null } = await chrome.storage.local.get('sessionState');
  const { quickEdits = [] } = await chrome.storage.local.get('quickEdits');
  const { todos = [] } = await chrome.storage.local.get('todos');
  const recent = breakHistory.slice(-10);
  const preferred = userProfile.preferredBreakTypes || [];
  const today = new Date();
  const todayTodos = todos.filter(t => !t.completed).map(t => t.text);
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayCompleted = todos.filter(t => t.completed && t.completedAt && isSameLocalDay(t.completedAt, yesterday)).map(t => t.text);

  const allowedDurations = expectedBreakMinutes ? [expectedBreakMinutes] : (sessionState && sessionState.breakDuration ? [sessionState.breakDuration] : [5]);
  const allowedDuration = sanitizeDuration(allowedDurations[0]);

  const context = {
    profile: {
      workPatterns: userProfile.workPatterns || [],
      healthConcerns: userProfile.healthConcerns || [],
      preferredBreakTypes: preferred,
      routine: userProfile.routine || null,
      schedule: userProfile.schedule || null,
    },
    session: sessionState,
    recentHistory: recent.map(({ breakId, breakType, completed, timestamp }) => ({ breakId, breakType, completed, timestamp })),
    todos: { today: todayTodos, yesterdayCompleted },
    quickEdits,
    constraints: { allowedDurations, excludeIds },
  };

  const instructions = [
    '당신은 브레이크 코치입니다.',
    `아래 제약에 맞춰 추천 후보 정확히 3개를 JSON으로만 반환하세요: {"suggestions":[{id,type,duration,description,rationale}]}.`,
    '- duration은 allowedDurations 중 하나만 사용(분 단위).',
    `- description은 한글로만 6-20자, 활동 설명 문장으로 작성.`,
    `- 다음 ID는 제외하세요: ${excludeIds.join(', ') || '없음'}.`,
    '- 최근 동일 타입 반복은 피하고, 사용자의 preferredBreakTypes를 우선.',
    '- 작업/건강 관심사, 오늘/어제 투두 내용을 고려하여 눈/목/스트레스 관련 다양하게 제안.',
  ].join(' ');

  try {
    const ai = await requestAiRecommendation({ context, instructions }, { timeoutMs: 3000 });
    const list = Array.isArray(ai?.suggestions) ? ai.suggestions : [];
    const normalized = list.slice(0, 3).map((s) => {
      const base = normalizeToLibrary(s);
      if (!base) return null;
      if (excludeIds.includes(base.id)) return null;
      const desc = isValidKoreanDescription(s?.description) ? s.description.trim() : getRandomDescription(base.type);
      return { id: base.id, type: base.type, duration: allowedDuration, name: `${allowedDuration}분 ${desc}`, rationale: s?.rationale || desc };
    }).filter(Boolean);

    let filled = normalized.length < 3
      ? [...normalized, ...pickRuleBasedSet(3 - normalized.length, allowedDuration, preferred, recent, excludeIds)]
      : normalized;
    if (filled.length < 3) filled = fillToRequired(filled, 3, allowedDuration, excludeIds);

    const top = filled[0] || pickRuleBasedSet(1, allowedDuration, preferred, recent, excludeIds)[0];
    await chrome.storage.local.set({ pendingBreakCandidates: filled, pendingBreak: top });
    return { source: 'ai', recId: (ai?.suggestions?.[0]?.recId)||null, ...top };
  } catch (e) {
    // fallback to rules: produce 3
    let fallbackSet = pickRuleBasedSet(3, allowedDuration, preferred, recent, excludeIds);
    if (fallbackSet.length < 3) fallbackSet = fillToRequired(fallbackSet, 3, allowedDuration, excludeIds);
    const top = fallbackSet[0];
    await chrome.storage.local.set({ pendingBreakCandidates: fallbackSet, pendingBreak: top });
    return { source: 'rule', recId: null, ...top };
  }
}


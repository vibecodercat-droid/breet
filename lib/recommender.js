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

// 한국어 맞춤법 검증: 한글, 공백, 중점만 허용, 이상한 문자 조합 차단
function isValidKoreanDescription(s) {
  if (!s || typeof s !== 'string') return false;
  const t = s.trim();
  if (t.length < 6 || t.length > 20) return false;
  
  // 한글, 공백, 중점만 허용
  if (!/^[가-힣\s·]+$/.test(t)) return false;
  
  // 명사형 검증: 동사 어미, 문장형 제외
  // 동사 어미: ~세요, ~하세요, ~해요, ~하기, ~하다, ~해라 등
  const verbEndings = /(세요|하세요|해요|하기|하다|해라|하라|하자|해주세요|해주|해보세요|해보|하세요)$/;
  if (verbEndings.test(t)) return false;
  
  // 이상한 문자 조합 차단: 반복되는 자음이나 모음, 의미없는 조합
  // 예: "하녕명호운는로를세요" 같은 경우
  const suspiciousPatterns = [
    /[ㄱ-ㅎ]{3,}/, // 자음 3개 이상 연속
    /[ㅏ-ㅣ]{3,}/, // 모음 3개 이상 연속
    /[가-힣]{1}[ㄱ-ㅎ]{2,}/, // 한글 + 자음 연속
    /[가-힣]{1}[ㅏ-ㅣ]{2,}/, // 한글 + 모음 연속
    /(세요|하세요|해요|하기|하다|해라|하라|하자|해주세요)/, // 동사 어미
  ];
  if (suspiciousPatterns.some(p => p.test(t))) return false;
  
  // 명사형 지시사 확인: "을 위한", "을 위한", "를 위한", "을", "를", "의" 등
  // 명사형은 보통 "을/를", "의", "을 위한" 등의 조사가 붙음
  // 하지만 동사형이 아닌 것만 확인
  return true;
}

function isValidHowTo(s) {
  if (!s || typeof s !== 'string') return false;
  const t = s.trim();
  if (t.length < 8 || t.length > 16) return false;
  return /^[가-힣\s·]+$/.test(t);
}

// AI description 필터링: 더 엄격한 검증
function filterAiDescription(s, fallback = null) {
  if (!s || typeof s !== 'string') return fallback;
  const t = s.trim();
  
  // 기본 검증
  if (!isValidKoreanDescription(t)) return fallback;
  
  // 명사형 강제: "~을/를 위한", "~하기", "~하기 위한" 같은 패턴은 허용하되, 동사 어미는 제거
  let cleaned = t;
  // "~하기" 같은 동사형을 "~"로 변환 (예: "눈 건강하기" -> "눈 건강")
  cleaned = cleaned.replace(/하기$/, '');
  cleaned = cleaned.replace(/하다$/, '');
  cleaned = cleaned.replace(/해요$/, '');
  cleaned = cleaned.replace(/하세요$/, '');
  cleaned = cleaned.replace(/세요$/, '');
  
  // 최종 검증
  if (!isValidKoreanDescription(cleaned)) return fallback;
  
  return cleaned.trim();
}

function polishKoreanName(name, minutes) {
  if (!name) return `${minutes}분 휴식`;
  let s = String(name).replace(/\s+/g, ' ').trim();
  if (!s.startsWith(`${minutes}분`)) s = `${minutes}분 ${s.replace(/^\d+분\s*/, '')}`;
  s = s.replace(/[\.\s]+$/, '');
  return s;
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
  
  // 최적화: 최근 히스토리를 3개로 제한
  const recent = breakHistory.slice(-3);
  const preferred = userProfile.preferredBreakTypes || [];
  
  // 최적화: todos를 요약 (최대 5개만)
  const todayTodos = todos.filter(t => !t.completed).slice(0, 5).map(t => t.text);
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayCompleted = todos.filter(t => t.completed && t.completedAt && isSameLocalDay(t.completedAt, yesterday)).slice(0, 5).map(t => t.text);
  
  // 최적화: quickEdits를 최근 3개만
  const recentQuickEdits = quickEdits.slice(-3);

  // prebreakPayload 우선 → 명시 인자 → 세션 → 온보딩 → 기본
  const { prebreakPayload = null } = await chrome.storage.local.get('prebreakPayload');
  const allowedDuration = sanitizeDuration(
    expectedBreakMinutes ?? prebreakPayload?.breakMinutes ?? sessionState?.breakDuration ?? userProfile?.routine?.breakDuration ?? 5
  );
  const allowedDurations = [allowedDuration];

  // 최적화: context 크기 줄이기 - 필요한 정보만 포함
  const context = {
    // profile: 필요한 최소 정보만
    profile: {
      workPatterns: (userProfile.workPatterns || []).slice(0, 3), // 최대 3개만
      healthConcerns: (userProfile.healthConcerns || []).slice(0, 3), // 최대 3개만
      preferredBreakTypes: preferred.slice(0, 3), // 최대 3개만
    },
    // session: 전체가 아닌 필요한 필드만
    session: sessionState ? { 
      mode: sessionState.mode, 
      breakDuration: sessionState.breakDuration 
    } : null,
    // recentHistory: 최근 3개만, 간소화
    recentHistory: recent.map(({ breakType, completed }) => ({ breakType, completed })),
    // todos: 요약 정보만
    todos: { 
      todayCount: todayTodos.length,
      today: todayTodos,
      yesterdayCount: yesterdayCompleted.length,
      yesterdayCompleted 
    },
    // quickEdits: 최근 3개만
    quickEdits: recentQuickEdits,
    constraints: { allowedDurations, excludeIds },
  };

  // 최적화: instructions 간소화 + 명사형 + 과업행동 1개만
  // 엄격한 형식: 명사형만 허용, 동사형/문장형 금지
  const instructions = [
    '브레이크 코치. JSON만: {"suggestions":[{id,type,duration,description}]}',
    `duration:${allowedDuration}분. description:8~20자 한국어 명사형만(예: "눈 건강을 위한 간단한 운동", "목 스트레칭", "깊은 호흡").`,
    `금지: 동사형(~세요,~하기,~하다), 문장형, 이상한 조합.`,
    `과업: ${todayTodos.length > 0 ? todayTodos[0] : '없음'}`,
    `제외: ${excludeIds.join(',') || '없음'}`,
  ].join(' ');

  try {
    const ai = await requestAiRecommendation({ context, instructions }, { timeoutMs: 3000 });
    const list = Array.isArray(ai?.suggestions) ? ai.suggestions : [];
    let normalized = list.slice(0, 3).map((s) => {
      const base = normalizeToLibrary(s);
      if (!base) return null;
      if (excludeIds.includes(base.id)) return null;
      
      // 엄격한 필터링 적용
      const rawDesc = s?.description ? String(s.description).trim() : '';
      const filteredDesc = filterAiDescription(rawDesc, getRandomDescription(base.type));
      const name = polishKoreanName(filteredDesc, allowedDuration);
      
      return { id: base.id, type: base.type, duration: allowedDuration, name };
    }).filter(Boolean);

    // 타입 다양성 보장
    const seenType = new Set();
    normalized = normalized.filter(c => { if (seenType.has(c.type)) return false; seenType.add(c.type); return true; });

    let filled = normalized.length < 3
      ? [...normalized, ...pickRuleBasedSet(3 - normalized.length, allowedDuration, preferred, recent, excludeIds)]
      : normalized;
    if (filled.length < 3) filled = fillToRequired(filled, 3, allowedDuration, excludeIds);

    const top = filled[0] || pickRuleBasedSet(1, allowedDuration, preferred, recent, excludeIds)[0];
    await chrome.storage.local.set({ pendingBreakCandidates: filled, pendingBreak: top, aiSource: 'ai', debugLastContext: { allowedDuration, profile: context.profile } });
    return { source: 'ai', recId: (ai?.suggestions?.[0]?.recId)||null, ...top };
  } catch (e) {
    // fallback to rules: produce 3
    let fallbackSet = pickRuleBasedSet(3, allowedDuration, preferred, recent, excludeIds);
    if (fallbackSet.length < 3) fallbackSet = fillToRequired(fallbackSet, 3, allowedDuration, excludeIds);
    const top = fallbackSet[0];
    await chrome.storage.local.set({ pendingBreakCandidates: fallbackSet, pendingBreak: top, aiSource: 'rule', debugLastContext: { allowedDuration, profile: context.profile } });
    return { source: 'rule', recId: null, ...top };
  }
}


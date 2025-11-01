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

function pickRuleBasedSet(requiredCount, allowedDuration, preferredTypes = [], recentHistory = []) {
  const recentTypes = recentHistory.slice(-3).map(r => r.breakType);
  // de-dup by id, avoid recent types, prefer preferredTypes
  const pool = BREAKS.filter(b => !recentTypes.includes(b.type));
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
    picked.push({ id: b.id, type: b.type, duration: allowedDuration, name: `${allowedDuration}분 + ${b.name}` });
  }
  // pad if not enough
  for (const b of BREAKS) {
    if (picked.length >= requiredCount) break;
    if (used.has(b.id)) continue;
    used.add(b.id);
    picked.push({ id: b.id, type: b.type, duration: allowedDuration, name: `${allowedDuration}분 + ${b.name}` });
  }
  return picked.slice(0, requiredCount);
}

export async function recommendNextBreakWithAI(expectedBreakMinutes) {
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
    constraints: { allowedDurations },
  };

  const instructions = [
    '당신은 브레이크 코치입니다.',
    `아래 제약에 맞춰 추천 후보 정확히 3개를 JSON으로만 반환하세요: {"suggestions":[{id,type,duration,name,rationale}]}.`,
    '- duration은 allowedDurations 중 하나만 사용(분 단위). 다른 길이 금지.',
    `- name 형식은 반드시 "${allowedDuration}분 + [활동명]". 다른 텍스트/설명 금지.`,
    '- 최근 동일 타입 반복은 피하고, 사용자의 preferredBreakTypes를 우선.',
    '- 작업/건강 관심사, 오늘/어제 투두 내용을 고려하여 눈/목/스트레스 관련 다양하게 제안.',
  ].join(' ');

  try {
    const ai = await requestAiRecommendation({ context, instructions }, { timeoutMs: 2500 });
    const list = Array.isArray(ai?.suggestions) ? ai.suggestions : [];
    // normalize to library items then enforce name format and duration
    const normalized = list.slice(0, 3).map((s) => {
      const base = normalizeToLibrary(s);
      if (!base) return null;
      return { id: base.id, type: base.type, duration: allowedDuration, name: `${allowedDuration}분 + ${getBreakById(base.id)?.name || base.name}` };
    }).filter(Boolean);

    // ensure 3 candidates
    const filled = normalized.length < 3
      ? [...normalized, ...pickRuleBasedSet(3 - normalized.length, allowedDuration, preferred, recent)]
      : normalized;

    const top = filled[0] || pickRuleBasedSet(1, allowedDuration, preferred, recent)[0];
    await chrome.storage.local.set({ pendingBreakCandidates: filled, pendingBreak: top });
    return { source: 'ai', recId: (ai?.suggestions?.[0]?.recId)||null, ...top };
  } catch (e) {
    // fallback to rules: produce 3
    const fallbackSet = pickRuleBasedSet(3, allowedDuration, preferred, recent);
    const top = fallbackSet[0];
    await chrome.storage.local.set({ pendingBreakCandidates: fallbackSet, pendingBreak: top });
    return { source: 'rule', recId: null, ...top };
  }
}


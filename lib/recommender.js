import { requestAiRecommendation } from './ai-client.js';
import { recommendNextBreak as ruleRecommend } from './rules.js';
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

export async function recommendNextBreakWithAI() {
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

  const allowedDurations = sessionState && sessionState.breakDuration ? [sessionState.breakDuration] : [5];

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
    `아래 제약에 맞춰 추천 후보 5개를 JSON으로만 반환하세요: {"suggestions":[{id,type,duration,name,rationale}]}.`,
    '- duration은 allowedDurations 중 하나만 사용(분 단위).',
    `- 형식: "N분 + 웰빙 브레이크 행동"을 name에 반영(예: "${allowedDurations[0]}분 + 박스 호흡").`,
    '- 최근 동일 타입 반복은 피하고, 사용자의 preferredBreakTypes를 우선.',
    '- 작업/건강 관심사, 오늘/어제 투두 내용을 고려하여 눈/목/스트레스 관련 다양하게 제안.',
  ].join(' ');

  try {
    const ai = await requestAiRecommendation({ context, instructions }, { timeoutMs: 2000 });
    const list = Array.isArray(ai?.suggestions) ? ai.suggestions : (ai ? [ai] : []);
    const normalized = list.slice(0, 5).map(s => normalizeToLibrary(s));
    const top = normalized[0] || normalizeToLibrary(null);
    await chrome.storage.local.set({ pendingBreakCandidates: normalized });
    return { source: 'ai', recId: (ai?.suggestions?.[0]?.recId)||null, ...top };
  } catch (e) {
    // fallback to rules
    const lastId = recent.length ? recent[recent.length - 1].breakId : null;
    const rule = ruleRecommend({ lastBreakId: lastId, preferredBreakTypes: preferred, recentHistory: recent });
    return { source: 'rule', recId: null, id: rule.id, type: rule.type, duration: rule.duration, name: rule.name };
  }
}


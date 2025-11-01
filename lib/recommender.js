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

export async function recommendNextBreakWithAI() {
  const { userProfile = {} } = await chrome.storage.local.get('userProfile');
  const { breakHistory = [] } = await chrome.storage.local.get('breakHistory');
  const { sessionState = null } = await chrome.storage.local.get('sessionState');
  const recent = breakHistory.slice(-10);
  const preferred = userProfile.preferredBreakTypes || [];

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
  };

  try {
    const ai = await requestAiRecommendation(context, { timeoutMs: 2000 });
    const norm = normalizeToLibrary(ai);
    return { source: 'ai', recId: ai?.recId || null, ...norm };
  } catch (e) {
    // fallback to rules
    const lastId = recent.length ? recent[recent.length - 1].breakId : null;
    const rule = ruleRecommend({ lastBreakId: lastId, preferredBreakTypes: preferred, recentHistory: recent });
    return { source: 'rule', recId: null, id: rule.id, type: rule.type, duration: rule.duration, name: rule.name };
  }
}


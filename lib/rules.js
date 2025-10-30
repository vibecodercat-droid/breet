import { getNextBreak } from './break-library.js';

export function recommendNextBreak({ lastBreakId = null, preferredBreakTypes = [], recentHistory = [] } = {}) {
  return getNextBreak(lastBreakId, preferredBreakTypes, recentHistory);
}


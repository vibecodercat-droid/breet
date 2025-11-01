import { getApiBase } from './auth.js';

export async function requestAiRecommendation(payload, { timeoutMs = 2000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${getApiBase()}/api/ai/recommendBreak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`AI HTTP ${res.status}`);
    const data = await res.json();
    // expected: { suggestions: [{ id, type, duration, name?, rationale?, recId? }, ...] }
    return data;
  } finally {
    clearTimeout(t);
  }
}


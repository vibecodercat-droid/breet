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

export async function requestDailyAffirmation(context = {}, { timeoutMs = 1500 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${getApiBase()}/api/ai/dailyQuote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context, constraints: { exactChars: 8, tone: 'warm', witty: true, suffixEmoji: true } }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`AI HTTP ${res.status}`);
    const data = await res.json();
    // expected: { text }
    return data?.text;
  } finally { clearTimeout(t); }
}

export async function requestDailyAffirmationBatch(context = {}, count = 20, { timeoutMs = 2500 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${getApiBase()}/api/ai/dailyQuoteBatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context, count, constraints: { exactChars: 8, tone: 'warm', witty: true, suffixEmoji: true } }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`AI HTTP ${res.status}`);
    const data = await res.json();
    // expected: { texts: string[] }
    return Array.isArray(data?.texts) ? data.texts : [];
  } finally { clearTimeout(t); }
}


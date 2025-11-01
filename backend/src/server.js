import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { getPrisma } from './prisma.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

const allowOrigins = (process.env.CORS_ALLOW_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: allowOrigins.length ? allowOrigins : true }));

const PORT = process.env.PORT || 8080;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const GROQ_BASE_URL = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';

function clampText(s = '', min = 1, max = 50) {
  const t = (s || '').trim();
  if (t.length < min) return t.padEnd(min, ' ');
  return t.slice(0, max);
}

async function callGroqChat(messages, { max_tokens = 256, temperature = 0.6 } = {}) {
  if (!GROQ_API_KEY) throw new Error('Missing GROQ_API_KEY');
  const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({ model: GROQ_MODEL, messages, max_tokens, temperature })
  });
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

// Recommend Break
app.post('/api/ai/recommendBreak', async (req, res) => {
  try {
    const { context, instructions } = req.body || {};
    const allowed = context?.constraints?.allowedDurations || [5];
    // If frontend provided precise instructions, use them as-is.
    const sys = instructions && String(instructions).trim().length
      ? String(instructions)
      : `당신은 브레이크 코치입니다. 다음 스키마로 JSON만 반환하세요: {"suggestions":[{id,type,duration,description?,name?,rationale?}]}. duration은 다음 중 하나만: ${allowed.join(',')}. 라이브러리에 매핑 가능한 id/type 사용.`;
    const user = JSON.stringify(context || {});
    const started = Date.now();
    const text = await callGroqChat(
      [{ role: 'system', content: sys }, { role: 'user', content: user }],
      { max_tokens: 500, temperature: 0.6 }
    );
    const latency = Date.now() - started;
    let json;
    try { json = JSON.parse(text); } catch {
      // try to salvage JSON block
      const m = String(text).match(/\{[\s\S]*\}/);
      if (m) { try { json = JSON.parse(m[0]); } catch { json = null; } }
    }
    if (!json) json = { suggestions: [] };
    // optional logging
    try {
      const prisma = getPrisma();
      if (prisma) {
        const userId = context?.userId || req.header('x-user-id') || null;
        const rec = await prisma.aiRecommendation.create({ data: { userId, contextHash: null, requestPayload: { context, instructions }, responsePayload: json, model: GROQ_MODEL, latencyMs: latency } });
        if (json?.suggestions?.length) json.suggestions[0].recId = rec.id;
      }
    } catch {}
    return res.json(json);
  } catch (e) {
    return res.status(200).json({ suggestions: [] });
  }
});

// Daily quote single
app.post('/api/ai/dailyQuote', async (req, res) => {
  const { context, constraints = {} } = req.body || {};
  const minChars = Number(constraints.minChars ?? 6);
  const maxChars = Number(constraints.maxChars ?? 10);
  const seed = constraints.seedPhrase || '';
  const sys = `따뜻하고 위트 있게, ${minChars}~${maxChars}자 한국어 한 줄 문구만 출력. 마지막엔 이모지 하나 포함. 사용자가 건강히 쉬며 일하도록 동기부여. 예시 결:${seed}`;
  const user = JSON.stringify({ context });
  try {
    const text = await callGroqChat([{ role: 'system', content: sys }, { role: 'user', content: user }], { max_tokens: 60, temperature: 0.8 });
    return res.json({ text: clampText(text, minChars, maxChars) });
  } catch (e) {
    return res.json({ text: '' });
  }
});

// Daily quote batch
app.post('/api/ai/dailyQuoteBatch', async (req, res) => {
  const { context, count = 20, constraints = {} } = req.body || {};
  const minChars = Number(constraints.minChars ?? 6);
  const maxChars = Number(constraints.maxChars ?? 10);
  const seed = constraints.seedPhrase || '';
  const sys = `따뜻하고 위트 있게, ${minChars}~${maxChars}자 한국어 한 줄 문구만 출력. 마지막엔 이모지 하나 포함. 사용자가 건강히 쉬며 일하도록 동기부여. 예시 결:${seed}. JSON 배열로만 응답.`;
  const user = JSON.stringify({ context, count });
  try {
    const text = await callGroqChat([{ role: 'system', content: sys }, { role: 'user', content: user }], { max_tokens: 400, temperature: 0.9 });
    let arr;
    try { arr = JSON.parse(text); } catch { arr = null; }
    if (!Array.isArray(arr)) arr = String(text).split(/\n|,/).map(s => s.trim()).filter(Boolean);
    const trimmed = arr.slice(0, count).map(t => clampText(t, minChars, maxChars));
    return res.json({ texts: trimmed });
  } catch (e) {
    return res.json({ texts: [] });
  }
});

app.get('/health', (_, res) => res.json({ ok: true }));

// === Data APIs (optional if DB configured) ===
app.get('/api/profiles', async (req, res) => {
  try {
    const prisma = getPrisma(); if (!prisma) return res.status(503).json({});
    const userId = req.header('x-user-id'); if (!userId) return res.status(400).json({});
    const p = await prisma.profile.findUnique({ where: { userId } });
    res.json(p || {});
  } catch (e) { res.status(200).json({}); }
});

app.put('/api/profiles', async (req, res) => {
  try {
    const prisma = getPrisma(); if (!prisma) return res.status(503).json({ ok: false });
    const userId = req.header('x-user-id'); if (!userId) return res.status(400).json({ ok: false });
    const data = req.body || {};
    const p = await prisma.profile.upsert({ where: { userId }, update: data, create: { userId, ...data } });
    res.json(p);
  } catch (e) { res.status(200).json({ ok: false }); }
});

app.get('/api/break-history', async (req, res) => {
  try {
    const prisma = getPrisma(); if (!prisma) return res.status(503).json([]);
    const userId = req.header('x-user-id'); if (!userId) return res.status(400).json([]);
    const from = req.query.from ? new Date(req.query.from) : new Date('2000-01-01');
    const to = req.query.to ? new Date(req.query.to) : new Date('2100-01-01');
    const rows = await prisma.breakHistory.findMany({ where: { userId, timestamp: { gte: from, lte: to } }, orderBy: { timestamp: 'asc' } });
    res.json(rows);
  } catch (e) { res.status(200).json([]); }
});

app.post('/api/break-history', async (req, res) => {
  try {
    const prisma = getPrisma(); if (!prisma) return res.status(503).json({ ok: false });
    const userId = req.header('x-user-id'); if (!userId) return res.status(400).json({ ok: false });
    const items = Array.isArray(req.body) ? req.body : (req.body?.items || []);
    await prisma.breakHistory.createMany({ data: items.map(i => ({ ...i, userId })) });
    res.json({ ok: true });
  } catch (e) { res.status(200).json({ ok: false }); }
});

app.get('/api/todos', async (req, res) => {
  try {
    const prisma = getPrisma(); if (!prisma) return res.status(503).json([]);
    const userId = req.header('x-user-id'); if (!userId) return res.status(400).json([]);
    const rows = await prisma.todo.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } });
    res.json(rows);
  } catch (e) { res.status(200).json([]); }
});

app.put('/api/todos', async (req, res) => {
  try {
    const prisma = getPrisma(); if (!prisma) return res.status(503).json({ ok: false });
    const userId = req.header('x-user-id'); if (!userId) return res.status(400).json({ ok: false });
    const list = Array.isArray(req.body) ? req.body : (req.body?.items || []);
    await prisma.$transaction([
      prisma.todo.deleteMany({ where: { userId } }),
      prisma.todo.createMany({ data: list.map(t => ({ ...t, userId })) })
    ]);
    res.json({ ok: true });
  } catch (e) { res.status(200).json({ ok: false }); }
});

app.listen(PORT, () => {
  console.log(`Breet backend listening on :${PORT}`);
});



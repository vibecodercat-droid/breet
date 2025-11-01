# Breet Backend

Express-based minimal backend to support AI features and future sync/auth.

## Endpoints

- `POST /api/ai/recommendBreak`
  - Body: `{ context }`
  - Returns: `{ suggestions: [{ id, type, duration, name, rationale }] }`
- `POST /api/ai/dailyQuote`
  - Body: `{ context, constraints: { minChars, maxChars, tone, witty, suffixEmoji, seedPhrase } }`
  - Returns: `{ text }`
- `POST /api/ai/dailyQuoteBatch`
  - Body: `{ context, count, constraints }`
  - Returns: `{ texts: string[] }`
- `GET /health`

## Env

Create a `.env` (never commit) containing:

```
PORT=8080
CORS_ALLOW_ORIGINS="chrome-extension://<EXT_ID>,http://localhost:3000"
GROQ_API_KEY=...
GROQ_MODEL=llama-3.1-8b-instant
GROQ_BASE_URL=https://api.groq.com/openai/v1
```

## Run

```
cd backend
npm install
npm run dev
```



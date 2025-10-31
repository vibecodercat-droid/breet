-- Breet Postgres schema (initial)
-- Requires: Postgres 13+ and pgcrypto extension for gen_random_uuid()

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(50) NOT NULL, -- 'google', 'kakao', 'naver'
    provider_user_id VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(provider, provider_user_id)
);

-- profiles (onboarding info)
CREATE TABLE IF NOT EXISTS profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    onboarding_completed BOOLEAN DEFAULT FALSE,
    onboarding_date TIMESTAMPTZ,
    work_patterns TEXT[],
    health_concerns TEXT[],
    preferred_break_types TEXT[],
    routine JSONB,
    schedule JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- break_history
CREATE TABLE IF NOT EXISTS break_history (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    break_id VARCHAR(100) NOT NULL,
    break_type VARCHAR(50) NOT NULL,
    duration INTEGER NOT NULL,
    completed BOOLEAN NOT NULL DEFAULT TRUE,
    timestamp TIMESTAMPTZ NOT NULL,
    recommendation_source VARCHAR(10) DEFAULT 'rule', -- 'ai'|'rule'|'manual'
    rec_id UUID NULL, -- optional FK to ai_recommendations.id (if used)
    source VARCHAR(50) DEFAULT 'extension',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- todos
CREATE TABLE IF NOT EXISTS todos (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- stats_daily (optional cache)
CREATE TABLE IF NOT EXISTS stats_daily (
    date DATE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total INTEGER DEFAULT 0,
    completed INTEGER DEFAULT 0,
    rate NUMERIC(5,2) DEFAULT 0.00,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (date, user_id)
);

-- sessions (optional events)
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode VARCHAR(50) NOT NULL,
    start_ts BIGINT NOT NULL,
    work_duration INTEGER NOT NULL,
    break_duration INTEGER NOT NULL,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- refresh_tokens (store hashes only)
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    salt TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ai_recommendations (optional)
CREATE TABLE IF NOT EXISTS ai_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    context_hash TEXT,
    request_payload JSONB,
    response_payload JSONB,
    model TEXT,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_break_user_ts ON break_history(user_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_break_user_completed_ts ON break_history(user_id, completed, timestamp);
CREATE INDEX IF NOT EXISTS idx_todos_user_updated ON todos(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_stats_user_date ON stats_daily(user_id, date);
CREATE INDEX IF NOT EXISTS idx_tokens_user_exp ON refresh_tokens(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_rec_user_created ON ai_recommendations(user_id, created_at);



-- ═══════════════════════════════════════════════════════════════════════════════
-- SCHEMA GESTOR — Painel de equipe para May
-- Execute no Supabase SQL Editor APÓS o schema.sql principal
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── TABELA: empresas ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empresas (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome         TEXT NOT NULL,
  gestor_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  max_membros  INTEGER DEFAULT 5,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TABELA: convites ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS convites (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  token       TEXT NOT NULL UNIQUE,
  aceito      BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days')
);

-- ─── COLUNAS NOVAS EM USERS ────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'membro'; -- membro | gestor

-- ─── ÍNDICES ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_empresas_gestor  ON empresas(gestor_id);
CREATE INDEX IF NOT EXISTS idx_convites_empresa ON convites(empresa_id);
CREATE INDEX IF NOT EXISTS idx_users_empresa    ON users(empresa_id);

-- ─── TRIGGER updated_at ────────────────────────────────────────────────────────
CREATE TRIGGER trg_empresas_updated
  BEFORE UPDATE ON empresas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── ROW LEVEL SECURITY ────────────────────────────────────────────────────────
ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE convites ENABLE ROW LEVEL SECURITY;

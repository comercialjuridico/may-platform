-- ═══════════════════════════════════════════════════════════════════════════════
-- SCHEMA REUNIÕES COM IA — sala própria (Daily.co), gravação, transcrição e nota
-- Execute no Supabase SQL Editor APÓS o schema.sql e o schema_gestor.sql
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS reunioes_ia (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  criado_por      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  titulo          TEXT NOT NULL,
  cliente_nome    TEXT,
  cliente_empresa TEXT,
  provider        TEXT NOT NULL DEFAULT 'daily',
  room_name       TEXT NOT NULL UNIQUE,
  room_url        TEXT NOT NULL,
  -- agendada -> em_andamento -> processando -> concluida  (ou cancelada a qualquer momento)
  status          TEXT NOT NULL DEFAULT 'agendada',
  recording_url   TEXT,
  transcricao     TEXT,
  resumo_ia       TEXT,
  nota_ia         INTEGER,
  sentimento      TEXT,
  riscos          JSONB DEFAULT '[]'::jsonb,
  proximos_passos JSONB DEFAULT '[]'::jsonb,
  duracao_min     INTEGER,
  iniciada_em     TIMESTAMPTZ,
  finalizada_em   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reunioes_ia_empresa ON reunioes_ia(empresa_id);
CREATE INDEX IF NOT EXISTS idx_reunioes_ia_status  ON reunioes_ia(status);

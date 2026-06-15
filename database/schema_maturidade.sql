-- ─── Campos de Maturidade Comercial ─────────────────────────────────────────
-- Rodar no Supabase SQL Editor

ALTER TABLE users ADD COLUMN IF NOT EXISTS tempo_experiencia  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS contratos_mes      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS dificuldades       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS quero_melhorar     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS leads_semana       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS modelo_cobranca    TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS faturamento_mensal TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS maturidade         INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS meta_semanal       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trilha_ativa       TEXT;

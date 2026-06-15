-- ─── Schema: Ranking de Vendas — Trial e Acesso ────────────────────────────
-- Rodar no Supabase SQL Editor

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS ranking_ativo          BOOLEAN DEFAULT FALSE;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS ranking_trial_inicio   TIMESTAMPTZ;

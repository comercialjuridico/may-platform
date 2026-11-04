-- ═══════════════════════════════════════════════════════════════════════════
-- Retenção (camadas 1, 2 e 3): memória do escritório, retorno do cliente e
-- resumo de segunda-feira.
--
-- Rodar uma vez no SQL Editor do Supabase, depois de um backup.
-- Só ADICIONA tabela e colunas: não apaga nem altera dado existente.
-- É idempotente: pode rodar de novo sem quebrar nada. Rollback no fim.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Camada 1: memória do escritório ───────────────────────────────────────
-- Uma linha por escritório (empresa). Contas individuais já têm empresa
-- própria desde a migration_empresa_solo.sql.
CREATE TABLE IF NOT EXISTS memoria_escritorio (
  empresa_id        UUID PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  servicos          TEXT,          -- o que o escritório vende
  honorarios        TEXT,          -- valores e como cobra
  formas_pagamento  TEXT,
  perfil_cliente    TEXT,          -- quem é o cliente típico
  diferenciais      TEXT,          -- por que escolher este escritório
  tom               TEXT,          -- jeito de falar com o cliente
  objecoes          JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ texto, resposta }]
  scripts           JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ titulo, texto }]
  sugestoes         JSONB NOT NULL DEFAULT '[]'::jsonb,  -- aprendizados da May aguardando aprovação
  atualizado_por    UUID REFERENCES users(id) ON DELETE SET NULL,
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE memoria_escritorio ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE memoria_escritorio FROM anon, authenticated;

-- ─── Camada 2: próximo passo e retorno de cada cliente ─────────────────────
ALTER TABLE leads ADD COLUMN IF NOT EXISTS proximo_passo        TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS data_retorno         TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS retorno_concluido    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS retorno_lembrado_em  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_retorno_pendente
  ON leads (closer_id, data_retorno)
  WHERE data_retorno IS NOT NULL AND retorno_concluido = FALSE;

-- ─── Camada 3: resumo de segunda-feira ─────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS ritual_semanal       BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ritual_ultima_semana TEXT;  -- ex.: 2026-W45

-- ─── Conferência ───────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM information_schema.tables  WHERE table_name = 'memoria_escritorio') AS tabela_memoria,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'leads' AND column_name IN ('proximo_passo','data_retorno','retorno_concluido','retorno_lembrado_em')) AS colunas_leads_4,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'users' AND column_name IN ('ritual_semanal','ritual_ultima_semana')) AS colunas_users_2;

-- ─── ROLLBACK (só se precisar desfazer) ────────────────────────────────────
-- DROP TABLE IF EXISTS memoria_escritorio;
-- DROP INDEX IF EXISTS idx_leads_retorno_pendente;
-- ALTER TABLE leads DROP COLUMN IF EXISTS proximo_passo, DROP COLUMN IF EXISTS data_retorno,
--   DROP COLUMN IF EXISTS retorno_concluido, DROP COLUMN IF EXISTS retorno_lembrado_em;
-- ALTER TABLE users DROP COLUMN IF EXISTS ritual_semanal, DROP COLUMN IF EXISTS ritual_ultima_semana;

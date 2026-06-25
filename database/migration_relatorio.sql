-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION: Relatório Semanal IA — MAY IA ULTRA
-- Execute no Supabase > SQL Editor
-- ═══════════════════════════════════════════════════════════════════════

-- Adiciona colunas na tabela empresas
ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS relatorio_semanal_ativo  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS relatorio_ultimo_envio   TIMESTAMPTZ;

-- Índice para encontrar rapidamente empresas com relatório ativo
CREATE INDEX IF NOT EXISTS idx_empresas_relatorio_ativo
  ON empresas(relatorio_semanal_ativo)
  WHERE relatorio_semanal_ativo = TRUE;

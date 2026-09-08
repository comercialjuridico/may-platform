-- ─────────────────────────────────────────────────────────────────────────────
-- Briefing de reuniões: retorno da pessoa depois da reunião
--
-- Rodar uma vez no SQL Editor do Supabase. É idempotente: pode rodar de novo
-- sem quebrar nada.
--
-- briefing_nota        1 a 5, o quanto o briefing ajudou
-- briefing_feedback    o que aconteceu na conversa, escrito por quem atendeu
-- briefing_feedback_em quando o retorno foi registrado
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE leads ADD COLUMN IF NOT EXISTS briefing_nota        SMALLINT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS briefing_feedback    TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS briefing_feedback_em TIMESTAMPTZ;

-- Nota fora da escala não entra
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_briefing_nota_check;
ALTER TABLE leads ADD  CONSTRAINT leads_briefing_nota_check
  CHECK (briefing_nota IS NULL OR (briefing_nota BETWEEN 1 AND 5));

-- Histórico do briefing é sempre lido por escritório e por data
CREATE INDEX IF NOT EXISTS idx_leads_briefing_empresa
  ON leads (empresa_id, created_at DESC)
  WHERE briefing IS NOT NULL;

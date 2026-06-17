-- ─── Garantir colunas faltantes em leads ────────────────────────────────────
ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS produto text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS valor_honorarios numeric;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS prioridade text DEFAULT 'media';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS origem_canal text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS participou_reuniao boolean;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS fechado_em timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lembrete_enviado boolean DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS data_reuniao timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS local_reuniao text;

-- ─── Tabela de follow-ups / lembretes ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS followups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id    uuid NOT NULL,
  lead_id       uuid REFERENCES leads(id) ON DELETE SET NULL,
  tipo          text NOT NULL DEFAULT 'ligação',
  data_hora     timestamptz NOT NULL,
  descricao     text,
  nome_lead     text,
  concluido     boolean DEFAULT false,
  created_at    timestamptz DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS followups_empresa_data ON followups(empresa_id, data_hora);
CREATE INDEX IF NOT EXISTS followups_usuario ON followups(usuario_id);

-- RLS
ALTER TABLE followups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS followups_empresa ON followups;
CREATE POLICY followups_empresa ON followups
  USING (empresa_id IN (
    SELECT empresa_id FROM usuarios WHERE id = auth.uid()
  ));

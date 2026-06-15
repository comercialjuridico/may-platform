-- ─── Metas comerciais — gestor define, aparece para usuários selecionados ───
-- Rodar no Supabase SQL Editor

CREATE TABLE IF NOT EXISTS metas (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_id   UUID REFERENCES empresas(id)  ON DELETE CASCADE,
  created_by   UUID REFERENCES users(id)     ON DELETE SET NULL,
  titulo       TEXT NOT NULL,
  descricao    TEXT,
  indicador    TEXT NOT NULL DEFAULT 'contratos', -- 'contratos' | 'faturamento'
  periodo      TEXT NOT NULL,   -- semanal | mensal | bimestral | trimestral | semestral | anual
  data_inicio  DATE NOT NULL,
  data_fim     DATE NOT NULL,
  meta_1       NUMERIC NOT NULL,   -- nível bronze
  meta_2       NUMERIC NOT NULL,   -- nível prata
  meta_3       NUMERIC NOT NULL,   -- nível ouro
  user_ids     UUID[],             -- NULL = toda a equipe
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Index para busca por empresa e período
CREATE INDEX IF NOT EXISTS idx_metas_empresa ON metas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_metas_periodo ON metas(data_inicio, data_fim);

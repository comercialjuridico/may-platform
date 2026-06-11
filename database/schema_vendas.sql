-- ─── Tabela de vendas registradas pelos membros da equipe ──────────────────────
CREATE TABLE IF NOT EXISTS vendas (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  empresa_id  UUID          REFERENCES empresas(id) ON DELETE SET NULL,
  valor       DECIMAL(12,2) NOT NULL CHECK (valor > 0),
  descricao   TEXT,
  cliente     TEXT,
  created_at  TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendas_user_id    ON vendas(user_id);
CREATE INDEX IF NOT EXISTS idx_vendas_empresa_id ON vendas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_vendas_created_at ON vendas(created_at);

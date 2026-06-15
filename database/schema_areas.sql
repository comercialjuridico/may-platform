-- ─── Áreas de Trabalho por Usuário ───────────────────────────────────────────────
-- Cada usuário tem até 3 áreas gratuitas. Acima disso, precisa de upgrade.

CREATE TABLE IF NOT EXISTS user_areas (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nome        TEXT          NOT NULL,
  descricao   TEXT,
  icone       TEXT          DEFAULT '⚖️',
  created_at  TIMESTAMPTZ   DEFAULT NOW(),
  UNIQUE(user_id, nome)
);

CREATE INDEX IF NOT EXISTS idx_user_areas_user_id ON user_areas(user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- May App — RLS (Row Level Security) + Audit Logs
-- Execute no SQL Editor do Supabase (uma vez, na ordem abaixo)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 0. Criar tabela de audit_logs ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  acao        TEXT        NOT NULL,          -- 'login', 'logout', 'exportar', etc.
  recurso     TEXT,                          -- 'conversa:uuid', 'user:uuid'
  detalhes    JSONB       DEFAULT '{}',
  ip          TEXT,
  user_agent  TEXT,
  criado_em   TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para queries de auditoria
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id   ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_acao       ON audit_logs(acao);
CREATE INDEX IF NOT EXISTS idx_audit_logs_criado_em  ON audit_logs(criado_em DESC);

-- ─── 1. Habilitar RLS em todas as tabelas ──────────────────────────────────
-- (o backend usa service_role key, que bypassa RLS automaticamente — seguro)

ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE areas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_areas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE convites        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranking        ENABLE ROW LEVEL SECURITY;
ALTER TABLE streak         ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs     ENABLE ROW LEVEL SECURITY;

-- ─── 2. Revogar acesso público por padrão ──────────────────────────────────
-- Garante que ninguém acessa sem autenticação

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- ─── 3. Políticas de RLS ───────────────────────────────────────────────────
-- NOTA: o backend usa service_role (bypassa RLS).
-- Estas policies protegem contra acesso direto via PostgREST/API pública.

-- users: cada usuário vê apenas o próprio registro
CREATE POLICY "users: self only"
  ON users FOR ALL
  USING (auth.uid() = id);

-- conversations: usuário vê só as próprias conversas
CREATE POLICY "conversations: owner only"
  ON conversations FOR ALL
  USING (auth.uid() = user_id);

-- messages: usuário vê só mensagens das próprias conversas
CREATE POLICY "messages: owner via conversation"
  ON messages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND c.user_id = auth.uid()
    )
  );

-- templates: apenas criador pode ver/editar
CREATE POLICY "templates: owner only"
  ON templates FOR ALL
  USING (auth.uid() = user_id);

-- areas: visível ao dono da área
CREATE POLICY "areas: owner only"
  ON areas FOR ALL
  USING (auth.uid() = user_id);

-- user_areas: visível ao próprio usuário
CREATE POLICY "user_areas: self only"
  ON user_areas FOR ALL
  USING (auth.uid() = user_id);

-- metas: visível ao próprio usuário
CREATE POLICY "metas: self only"
  ON metas FOR ALL
  USING (auth.uid() = user_id);

-- vendas: usuário vê as próprias vendas
CREATE POLICY "vendas: self only"
  ON vendas FOR ALL
  USING (auth.uid() = vendedor_id);

-- empresas: apenas membros da empresa
CREATE POLICY "empresas: members only"
  ON empresas FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.empresa_id = empresas.id
    )
  );

-- convites: gestor da empresa
CREATE POLICY "convites: empresa owner"
  ON convites FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.empresa_id = convites.empresa_id
        AND u.role IN ('admin', 'gestor')
    )
  );

-- ranking: visível a membros da mesma empresa
CREATE POLICY "ranking: empresa only"
  ON ranking FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u1
      JOIN users u2 ON u2.id = ranking.user_id
      WHERE u1.id = auth.uid()
        AND u1.empresa_id = u2.empresa_id
    )
  );

-- streak: apenas o próprio usuário
CREATE POLICY "streak: self only"
  ON streak FOR ALL
  USING (auth.uid() = user_id);

-- audit_logs: admin pode ler, ninguém escreve via API pública
CREATE POLICY "audit_logs: admin read"
  ON audit_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role = 'admin'
    )
  );

-- ─── 4. Índices extras de performance ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation  ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_vendas_vendedor        ON vendas(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_vendas_empresa         ON vendas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_users_empresa          ON users(empresa_id);
CREATE INDEX IF NOT EXISTS idx_users_email            ON users(email);

-- ─── 5. Verificação ────────────────────────────────────────────────────────
-- Rode isso para confirmar que RLS está ativo em todas as tabelas:
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

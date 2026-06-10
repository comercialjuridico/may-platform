-- ═══════════════════════════════════════════════════════════════════════════════
-- SCHEMA COMPLETO — Plataforma May
-- Execute no Supabase SQL Editor na ordem abaixo
-- ═══════════════════════════════════════════════════════════════════════════════

-- Habilitar extensão para UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── TABELA: users ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  avatar_url    TEXT,

  -- Diagnóstico inicial (define contexto da IA)
  nicho         TEXT,              -- juridico, seguros, imoveis, saude, financeiro, outro
  produto       TEXT,              -- o que vende especificamente
  publico_alvo  TEXT,              -- para quem vende
  nivel         TEXT DEFAULT 'iniciante', -- iniciante, intermediario, avancado
  maior_dificuldade TEXT,          -- dor principal relatada no diagnóstico

  diagnostico_completo BOOLEAN DEFAULT FALSE,

  -- Assinatura
  plano         TEXT DEFAULT 'free',   -- free, mensal, anual
  plano_status  TEXT DEFAULT 'ativo',  -- ativo, cancelado, expirado
  plano_inicio  TIMESTAMPTZ,
  plano_fim     TIMESTAMPTZ,
  stripe_customer_id    TEXT,
  stripe_subscription_id TEXT,

  -- Controle de uso
  mensagens_mes    INTEGER DEFAULT 0,
  mes_referencia   TEXT,               -- formato: 2026-06

  -- Tokens de autenticação
  refresh_token    TEXT,
  reset_token      TEXT,
  reset_token_exp  TIMESTAMPTZ,
  email_verificado BOOLEAN DEFAULT FALSE,
  verify_token     TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TABELA: conversations ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  titulo     TEXT DEFAULT 'Nova conversa',
  ferramenta TEXT DEFAULT 'chat',  -- chat, simulador_objecoes, gerador_proposta,
                                   -- follow_up, negociacao, diagnostico, spin, simulador_vendas
  arquivada  BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TABELA: messages ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  tokens_usados   INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TABELA: templates ─────────────────────────────────────────────────────────
-- Conteúdos gerados salvos pelo usuário (propostas, scripts, follow-ups)
CREATE TABLE IF NOT EXISTS templates (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo       TEXT NOT NULL,   -- proposta, follow_up, argumento, script
  titulo     TEXT NOT NULL,
  conteudo   TEXT NOT NULL,
  nicho      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TABELA: treinos ───────────────────────────────────────────────────────────
-- Registro dos treinos realizados (simulador, SPIN, etc.)
CREATE TABLE IF NOT EXISTS treinos (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL,   -- objecao, reuniao_spin, simulacao_completa
  nicho         TEXT,
  nivel         TEXT,            -- facil, medio, dificil
  nota_geral    NUMERIC(4,1),
  feedback      JSONB,           -- { criterios: [{nome, nota, comentario}], erro_principal, ponto_forte }
  duracao_seg   INTEGER,
  concluido     BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TABELA: streak ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS streak (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  dias_seguidos  INTEGER DEFAULT 0,
  maior_streak   INTEGER DEFAULT 0,
  ultimo_treino  DATE,
  xp_total       INTEGER DEFAULT 0,
  nivel_conexao  INTEGER DEFAULT 1,   -- nivel por habilidade (1-10)
  nivel_objecao  INTEGER DEFAULT 1,
  nivel_proposta INTEGER DEFAULT 1,
  nivel_negociacao INTEGER DEFAULT 1,
  nivel_fechamento INTEGER DEFAULT 1,
  nivel_follow_up  INTEGER DEFAULT 1,
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TABELA: uploads ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS uploads (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  mimetype    TEXT NOT NULL,
  tamanho     INTEGER,
  texto_extraido TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TABELA: subscriptions_log ─────────────────────────────────────────────────
-- Log de todos os eventos Stripe
CREATE TABLE IF NOT EXISTS subscriptions_log (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID REFERENCES users(id),
  stripe_event TEXT NOT NULL,
  payload      JSONB,
  processado   BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── ÍNDICES ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_conversations_user   ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv        ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_user        ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_treinos_user         ON treinos(user_id);
CREATE INDEX IF NOT EXISTS idx_templates_user       ON templates(user_id);
CREATE INDEX IF NOT EXISTS idx_uploads_user         ON uploads(user_id);

-- ─── FUNÇÃO: atualizar updated_at automaticamente ──────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_conversations_updated
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_templates_updated
  BEFORE UPDATE ON templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── ROW LEVEL SECURITY ────────────────────────────────────────────────────────
-- Atenção: o backend usa service_role_key, que ignora RLS.
-- RLS é configurado para acesso direto (ex: futuro painel admin).
ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE treinos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE streak             ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploads            ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions_log  ENABLE ROW LEVEL SECURITY;

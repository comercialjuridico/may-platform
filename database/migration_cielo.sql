-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION: Suporte a pagamento Cielo (recorrência)
-- Execute no Supabase > SQL Editor
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Adiciona coluna de ID de recorrência Cielo na tabela users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS cielo_recurrent_payment_id TEXT;

-- 2. Cria tabela de pré-checkouts (valida cartão antes de autenticar)
CREATE TABLE IF NOT EXISTS pre_checkouts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        TEXT UNIQUE NOT NULL,   -- ID retornado pela Cielo
  plano           TEXT NOT NULL,          -- start_mensal, equipe_anual, etc.
  periodo         TEXT NOT NULL,          -- mensal | anual
  card_token      TEXT,                   -- token de recorrência Cielo
  status          TEXT DEFAULT 'pendente', -- pendente | ativado | expirado
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  expires_at      TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 minutes')
);

-- Índice para busca por order_id
CREATE INDEX IF NOT EXISTS idx_pre_checkouts_order_id ON pre_checkouts(order_id);

-- Limpa pré-checkouts expirados automaticamente (opcional, via cron no Supabase)
-- DELETE FROM pre_checkouts WHERE expires_at < NOW();

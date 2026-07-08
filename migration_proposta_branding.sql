-- Migration: Adicionar colunas de identidade do escritório para proposta PDF
-- Rodar no Supabase SQL Editor: https://app.supabase.com → SQL Editor

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS logo_escritorio TEXT,
  ADD COLUMN IF NOT EXISTS cor_escritorio  VARCHAR(7) DEFAULT '#7C3AED';

-- Confirmar
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name IN ('logo_escritorio', 'cor_escritorio');

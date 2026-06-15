-- ─── Novos campos na tabela vendas ──────────────────────────────────────────
-- Rodar no Supabase SQL Editor

ALTER TABLE vendas ADD COLUMN IF NOT EXISTS telefone        TEXT;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS origem          TEXT;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS data_contato    DATE;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS data_fechamento DATE;

-- valor agora é opcional (êxito = NULL)
ALTER TABLE vendas ALTER COLUMN valor DROP NOT NULL;

-- Guarda o id permanente da gravação no Daily (não o link, que expira em minutos).
-- O link de assistir/baixar é gerado na hora, sob demanda, com esse id.
ALTER TABLE reunioes_ia ADD COLUMN IF NOT EXISTS daily_recording_id TEXT;

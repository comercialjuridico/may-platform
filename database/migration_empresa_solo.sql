-- ─── Empresa para contas que nasceram sem convite ────────────────────────────
-- Antes, só quem entrava por link de convite recebia empresa_id. Quem se
-- cadastrava direto ficava com empresa_id nulo — e Leads, Agenda, Relatórios e
-- Ranking filtram tudo por empresa_id, então essas telas quebravam.
-- Este script cria uma empresa para cada conta órfã, com ela mesma como gestora.
-- Rodar uma vez no SQL Editor do Supabase. É seguro rodar de novo: só pega
-- quem ainda está sem empresa.

DO $$
DECLARE
  u        RECORD;
  nova_id  UUID;
  criadas  INT := 0;
BEGIN
  FOR u IN SELECT id, name, email FROM users WHERE empresa_id IS NULL LOOP
    INSERT INTO empresas (nome, gestor_id)
    VALUES (COALESCE(NULLIF(TRIM(u.name), ''), 'Escritório de ' || u.email), u.id)
    RETURNING id INTO nova_id;

    UPDATE users SET empresa_id = nova_id WHERE id = u.id;
    criadas := criadas + 1;
  END LOOP;

  RAISE NOTICE 'Empresas criadas: %', criadas;
END $$;

-- Conferência: tem que voltar 0
SELECT COUNT(*) AS ainda_sem_empresa FROM users WHERE empresa_id IS NULL;

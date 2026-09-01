-- ═══════════════════════════════════════════════════════════════════════════
-- Empresa para contas que nasceram sem convite
-- ═══════════════════════════════════════════════════════════════════════════
-- Antes, só quem entrava por link de convite recebia empresa_id. Quem se
-- cadastrava direto ficava com empresa_id nulo — e Leads, Agenda, Relatórios e
-- Ranking de Vendas filtram tudo por empresa_id. Sem ele:
--   · o relatório de leads quebra ("Erro ao gerar relatório")
--   · lançar venda responde "você precisa estar em uma equipe"
--   · o ranking volta sempre vazio, sem erro nenhum
--
-- ATENÇÃO — ORDEM IMPORTA:
-- O PASSO 3 cria uma empresa SEPARADA para cada conta órfã. Isso é o certo para
-- quem trabalha sozinho, e é o ERRADO para quem deveria estar no seu time: a
-- pessoa ficaria num ranking só dela, sem enxergar o resto da equipe.
-- Então rode o PASSO 1, resolva os membros de equipe no PASSO 2 e só depois o 3.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── PASSO 1 — Ver quem está sem empresa ────────────────────────────────────
SELECT id, name, email, role, created_at
FROM users
WHERE empresa_id IS NULL
ORDER BY created_at;

-- E as empresas que já existem, para você saber a qual anexar alguém:
SELECT e.id, e.nome, u.email AS email_do_gestor
FROM empresas e
LEFT JOIN users u ON u.id = e.gestor_id
ORDER BY e.created_at;


-- ─── PASSO 2 — Anexar membros de equipe à empresa certa ─────────────────────
-- Rode este bloco para CADA pessoa que faz parte de um escritório que já existe.
-- Troque os dois e-mails: o primeiro é quem entra, o segundo é o dono da empresa.
--
-- UPDATE users
-- SET empresa_id = (
--       SELECT empresa_id FROM users WHERE email = 'email-do-gestor@exemplo.com'
--     ),
--     role = 'membro'
-- WHERE email = 'email-do-membro@exemplo.com';


-- ─── PASSO 3 — Criar empresa própria para quem sobrou ───────────────────────
-- Só depois do passo 2. Pega apenas quem ainda está sem empresa.
-- Pode rodar de novo sem problema.
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


-- ─── Conferência final — tem que voltar 0 ───────────────────────────────────
SELECT COUNT(*) AS ainda_sem_empresa FROM users WHERE empresa_id IS NULL;

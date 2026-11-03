-- ═══════════════════════════════════════════════════════════════════════════
-- RLS "negado por padrão" em todas as tabelas do schema public
-- NÃO RODAR sem aprovação e sem backup recente (Supabase → Database → Backups).
--
-- Por quê: supabase/rls_e_auditoria.sql cobre só parte das tabelas. Ficaram de
-- fora, entre outras, leads (briefings com dados de clientes), uploads (texto de
-- documentos e conversas de WhatsApp), reunioes_ia (transcrições), followups,
-- push_subscriptions, pre_checkouts e cancelamentos_feedback. O backend usa a
-- service_role key, que ignora RLS, então nada muda para o App May. O que muda:
-- quem tiver a anon key do projeto deixa de conseguir ler essas tabelas pela API
-- pública do Supabase.
--
-- Não apaga nem altera dado nenhum. Rollback no fim do arquivo.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── PASSO 1 — Diagnóstico (só leitura). Rode e guarde o resultado. ─────────
SELECT c.relname AS tabela,
       c.relrowsecurity AS rls_ativo,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_le,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_le
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY rls_ativo, tabela;

-- ─── PASSO 2 — Aplicar (só depois de conferir o passo 1) ───────────────────
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t.relname);
  END LOOP;
END $$;

-- Tabelas criadas no futuro também nascem sem acesso para anon/authenticated.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;

-- Funções RPC: a única usada pelo backend é incrementar_mensagens_mes, chamada
-- com a service_role. Ninguém de fora precisa executá-la. (A definição dela
-- não está versionada no repositório; o bloco abaixo pega qualquer assinatura.)
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS assinatura FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'incrementar_mensagens_mes'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated', f.assinatura);
  END LOOP;
END $$;

-- ─── PASSO 3 — Conferência: rode o PASSO 1 de novo. ────────────────────────
-- Esperado: rls_ativo = true e anon_le/authenticated_le = false em todas.
-- Depois: abrir o App May, mandar uma mensagem no chat e gerar um briefing.

-- ─── ROLLBACK (por tabela, se algo inesperado depender de acesso anon) ─────
-- ALTER TABLE public.<tabela> DISABLE ROW LEVEL SECURITY;
-- GRANT SELECT ON TABLE public.<tabela> TO anon, authenticated;  -- só se existia antes (ver passo 1)

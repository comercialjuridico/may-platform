-- MAY / SUPABASE: AUDITORIA ESTRUTURAL SOMENTE DE LEITURA
-- Rodar SOMENTE no projeto isolado de homologação (staging), nunca em produção
-- sem autorização explícita. O resultado não inclui dados pessoais de clientes.
-- Esta consulta NÃO cria policies, não altera tabelas e não executa migrações.
-- Verifique o Project ID/URL no painel Supabase antes de executar.
--
-- 1) Tabelas e RLS: RLS habilitado não implica acesso seguro para service_role.
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       pg_get_userbyid(c.relowner) AS table_owner,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select,
       has_table_privilege('anon', c.oid, 'INSERT') AS anon_insert,
       has_table_privilege('authenticated', c.oid, 'INSERT') AS authenticated_insert,
       has_table_privilege('anon', c.oid, 'UPDATE') AS anon_update,
       has_table_privilege('authenticated', c.oid, 'UPDATE') AS authenticated_update,
       has_table_privilege('anon', c.oid, 'DELETE') AS anon_delete,
       has_table_privilege('authenticated', c.oid, 'DELETE') AS authenticated_delete
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
ORDER BY c.relname;

-- 2) Políticas existentes, incluindo regras de INSERT/UPDATE (WITH CHECK).
SELECT schemaname, tablename, policyname, permissive, roles, cmd,
       qual AS using_expression, with_check AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 3) Funções potencialmente privilegiadas e EXECUTE exposto a clientes.
SELECT n.nspname AS schema_name,
       p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       p.proconfig AS function_settings
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname, args;

-- 4) Estrutura de isolamento: empresa_id / user_id / usuario_id e constraints.
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('id', 'empresa_id', 'user_id', 'usuario_id',
                      'conversation_id', 'lead_id', 'criado_por', 'role',
                      'refresh_token', 'totp_secret')
ORDER BY table_name, column_name;

-- 5) Chaves estrangeiras: checar relações entre usuário, escritório e recurso.
SELECT c.conrelid::regclass::text AS source_table,
       c.conname AS constraint_name,
       pg_get_constraintdef(c.oid) AS constraint_definition
FROM pg_constraint c
JOIN pg_namespace n ON n.oid = c.connamespace
WHERE n.nspname = 'public' AND c.contype = 'f'
ORDER BY source_table, constraint_name;

-- 6) Índices relevantes para consultas multi-tenant.
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND (indexdef ILIKE '%empresa_id%' OR indexdef ILIKE '%user_id%'
       OR indexdef ILIKE '%usuario_id%')
ORDER BY tablename, indexname;

-- 7) Indicadores de esquema obsoleto: tabelas e colunas esperadas pela MAY.
SELECT expected.table_name, expected.column_name,
       (cols.column_name IS NOT NULL) AS present
FROM (VALUES
  ('users','id'), ('users','empresa_id'), ('users','role'),
  ('users','refresh_token'), ('users','totp_enabled'), ('users','totp_secret'),
  ('conversations','user_id'), ('messages','user_id'),
  ('leads','empresa_id'), ('leads','sdr_id'), ('leads','closer_id'),
  ('followups','empresa_id'), ('followups','usuario_id'),
  ('vendas','user_id'), ('vendas','empresa_id'),
  ('reunioes_ia','empresa_id'), ('uploads','user_id')
) AS expected(table_name, column_name)
LEFT JOIN information_schema.columns cols
       ON cols.table_schema='public'
      AND cols.table_name=expected.table_name
      AND cols.column_name=expected.column_name
ORDER BY expected.table_name, expected.column_name;

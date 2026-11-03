# MAY — Homologação isolada com Supabase

Data da preparação: 03/11/2026. **Nenhuma configuração abaixo foi executada em Supabase.**
A integração Supabase foi instalada pelo usuário, mas as ações de acesso a projetos/SQL ainda não estavam disponíveis nesta sessão. Nunca supor que a instalação equivale à autorização de acesso ao banco.

## Ambiente Railway preparado

- Projeto separado: `may-homologacao` (`6dad68df-44d0-4b49-b366-a6c9ff91ef18`)
- Ambiente: `staging` (`5d55ee81-4d17-4337-8d0e-e4fe2869fafa`)
- Serviço vazio: `may-platform-staging` (`02f5aa20-a6fc-4c8f-90d8-fe5aa6c89263`)
- Source **somente preparada como alteração pendente**, não aplicada:
  `comercialjuridico/may-platform`, branch `security/p0-tenant-sessions-2026-11-03`
- **Não foi efetuado deploy**. Sem URL pública, banco ou credenciais.
- Produção `illustrious-trust` segue isolada e não foi alterada.

## Portão obrigatório — nunca conectar homologação à produção

1. Selecionar ou criar um projeto **novo** no Supabase com nome `may-homologacao`. Registrar o `project_ref`.
2. Conferir que o `project_ref` e URL do projeto diferem **expressamente** do Supabase da MAY em produção. Sem conseguir conferir os dois, **parar**.
3. Não clonar dados de clientes, backups ou tokens da produção. Usar exclusivamente dados fictícios e contas fictícias.
4. Não executar `supabase/rls_e_auditoria.sql`, `followups.sql` ou todas as migrations legadas às cegas. Há incompatibilidades documentadas abaixo.
5. No novo Supabase, executar apenas `supabase/audit_staging_readonly.sql` para inventariar RLS, grants, policies, funções privilegiadas, colunas e chaves estrangeiras. Esta consulta é somente leitura.
6. Para criar esquema de teste, revisar e consolidar scripts em migrações idempotentes e revisadas; **não** usar esquema de produção sem revisão.
7. Registrar em variáveis do serviço `may-platform-staging`, nunca no repositório:
   - `NODE_ENV=staging`
   - `SUPABASE_URL` do **novo** projeto e `SUPABASE_SERVICE_KEY` exclusivamente deste projeto;
   - `JWT_SECRET` e `JWT_REFRESH_SECRET` independentes da produção;
   - `STRIPE_SECRET_KEY` apenas em modo TEST, e webhooks TEST se necessário;
   - chaves e e-mails de teste para OpenAI/Resend, se habilitados.
8. **NÃO copiar variáveis de produção em bloco**. Conferir valores no próprio painel do provedor, não postar segredos em chat ou issues.
9. A aplicação exige `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `JWT_SECRET`, `JWT_REFRESH_SECRET`. Não tentar inicializar sem estes controles.
10. Somente após verificação do isolamento, autorizar aplicação das configurações pendentes e eventual deploy exclusivo em `staging`; nunca clicar em Deploy/Accept para produção.

## Divergências detectadas em arquivos SQL legados (verificar antes de qualquer migração)

- `followups.sql` contém política `SELECT empresa_id FROM usuarios`; o esquema principal define `users`, não `usuarios`. Em uma instalação limpa, a criação da política pode falhar.
- `supabase/rls_e_auditoria.sql` usa `vendas.vendedor_id` numa policy e índice, mas `database/schema_vendas.sql` define `vendas.user_id`. Rever o esquema real e ajustar a migração.
- A criação de `CREATE POLICY` em `supabase/rls_e_auditoria.sql` não é idempotente se a policy já existir.
- `SUPABASE_SERVICE_KEY` bypassa RLS na aplicação; portanto, RLS sozinho não substitui filtros `empresa_id` e `user_id` nas rotas.
- Alterações P0 no backend usam filtros de empresa/proprietário, mas ainda faltam testes com dois escritórios no banco isolado real.
- Avaliar constraints que previnam associações entre `lead_id`/`empresa_id` incompatíveis na mesma linha, não apenas middleware.

## Plano de homologação (com dados fictícios)

1. Criar dois escritórios: `Escritorio A (teste)` e `Escritorio B (teste)` com dois usuários de A e um de B.
2. Inserir leads, follow-ups, conversas e reuniões fictícias atribuídas a A e B.
3. Confirmar que A não lê, altera, exporta ou exclui itens de B.
4. Confirmar que dois usuários de A não alteram follow-ups alheios sem permissão.
5. Verificar login, refresh, logout, expiração, rotação e 2FA sem sessão inválida continuar ativa.
6. Exercitar cobrança somente com Stripe TEST; não usar cartão ou cliente real.
7. Validar logs sem dados pessoais ou chaves; capturar apenas resultados técnicos e IDs fictícios.
8. Conferir que serviços de produção não tiveram deploy ou configuração modificada.
9. Recolher evidências; exigir autorização explícita antes de promover alterações à produção.

## Estado

- [x] Branch de segurança no GitHub, testes automatizados P0 aprovados.
- [x] Projeto e serviço de homologação isolados no Railway.
- [x] Source do branch preparada como **staged**, não aplicada.
- [x] Consulta de auditoria somente-leitura preparada.
- [ ] Supabase homologação identificado/criado e certificado como distinto da produção.
- [ ] SQL executado no Supabase de homologação (somente após acesso).
- [ ] Esquema compatível e dados sintéticos preparados.
- [ ] Ambiente de homologação conectado, validado e publicado com autorização.

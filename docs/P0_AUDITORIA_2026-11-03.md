# MAY — Auditoria e correções P0 (03/11/2026)

## Escopo e limites
Revisão do código disponível na branch main no commit `3cf7f30f60322d8198d864e88c0d34824335728c`, com alterações isoladas na branch `security/p0-tenant-sessions-2026-11-03`. Sem deploy, acesso a dados de clientes, consultas administrativas ao Supabase ou migrações.

## Achados anteriormente relatados já tratados no código revisado
- Chat: autorização da conversa antes de abrir streaming, carregar histórico e consultar IA.
- Markdown: sanitização DOMPurify com fallback literal.
- 2FA: verificação de estado, ativação protegida e limites de tentativas.
- Stripe: validação de assinatura do webhook sobre corpo original; Cielo possui serviço de reconciliação.
Esses controles exigem homologação com provedores e dados reais de configuração; presença no código não comprova segurança absoluta.

## Mudanças nesta branch
1. `backend/services/sessionTokens.js`: verificador SHA-256 do refresh token e comparação de tempo constante; aceitação transitória de tokens legados para migração.
2. `backend/routes/auth.js`: `jti` aleatório a cada token de renovação, armazenamento somente do hash, validação de tipo/tamanho e rotação por compare-and-swap no banco. Uma sessão legada é atualizada para hash após a primeira renovação.
3. `backend/routes/twofa.js`: refresh token com `jti` exclusivo e verificador persistido com hash.
4. `backend/routes/followups.js`: PATCH/DELETE filtram empresa e usuário proprietário, com retorno 404 quando não há linha autorizada.
5. `backend/routes/leads.js`: operações de mutação reforçam filtro de empresa; autorização de exclusão utiliza `role`; registro da venda ocorre após atualização confirmada.
6. `backend/routes/briefing.js`: regeração e feedback não gravam sem filtro de empresa; retorno explícito quando não há registro autorizado.
7. `backend/routes/reunioes.js`: processar e excluir preservam filtro de empresa também na operação de escrita.
8. `tests/helpers.cjs`, `tests/session-security.test.cjs`, `tests/tenant-mutations-security.test.cjs`: regressões de isolamento, rotação e reutilização de sessões.
9. `.github/workflows/security-tests.yml`: verificação de sintaxe, instalação reproduzível e teste completo sem deploy.

## Evidências
- GitHub Actions: https://github.com/comercialjuridico/may-platform/actions/runs/41710982460
- Última execução: **87 testes aprovados, 0 falhas**.
- Sintaxe dos arquivos alterados aprovada no CI.
- A primeira execução falhou em sintaxe de `briefing.js`, corrigida antes da execução aprovada.

## Riscos restantes / aprovação necessária antes de produção
- **Supabase:** validar RLS, permissões efetivas, segregação por empresa, grants e execução com service role. Nenhuma consulta administrativa ao banco foi feita.
- **Sessões:** modelo atual mantém um refresh token por usuário, invalidando outros dispositivos ao renovar ou entrar. Melhorias futuras para sessões por dispositivo requerem mudança de esquema e homologação.
- **2FA:** avaliar cifragem do segredo TOTP em repouso e códigos de recuperação.
- **Rotas adicionais:** ampliar revisão a uploads, exportações, relatórios, notificações, permissões de gestor e todos os pontos de entrada.
- **Concorrência em leads:** criação de vendas em tabela separada ainda merece uma transação/idempotência no banco para garantir consistência sob chamadas simultâneas.
- **Dependências:** CI com npm ci indicou 10 alertas (3 baixos, 6 moderados e 1 alto); classificar impacto e atualizar de modo controlado, sem `npm audit fix --force` indiscriminado.
- **Produção:** testes do CI usam mocks; ainda faltam testes de integração com Supabase real em homologação e rollback planejado.
- **Repositório público:** propriedade intelectual e exposição de código devem ser revistos com a proprietária.

## Critério de promoção para main
Revisão de código, testes de integração em homologação com duas empresas e usuários distintos, teste de renovação/login/2FA, validação da migração de sessões legadas, aprovação explícita da proprietária. Não fazer merge ou deploy sem autorização.

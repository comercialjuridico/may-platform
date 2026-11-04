# Segurança — Fase 1, itens P0 (branch `seguranca/fase1-p0`)

Base: `main` em `3cf7f30` (22/10/2026). Nenhuma migração de banco foi executada.
Nenhum preço, plano ou benefício comercial foi alterado.

## O que mudou

| # | Problema confirmado | Correção | Arquivos |
|---|---|---|---|
| 1 | Sem `trust proxy`: atrás do Railway, os limites "por IP" (login, cadastro, chat da landing) contam o IP do proxy, não o do visitante. | `app.set('trust proxy', 1)`, configurável por `TRUST_PROXY_HOPS`. | `backend/server.js` |
| 2 | Esqueci a senha e redefinição sem limite: disparo de e-mails em massa pelo domínio da May e tentativa de tokens. | Mesmo limite do login (10 por 15 min por IP). | `backend/server.js` |
| 3 | `/api/modulos/ativar` ainda recebia número de cartão e CVV no servidor. APIs de leads, follow-ups e ranking continuavam no ar com as telas desativadas. | Respondem 410. Lista `APIS_DESATIVADAS` para reativar. | `backend/server.js` |
| 4 | Com o teste vencido, o chat bloqueava, mas briefing (gpt-4o), análise de imagem (gpt-4o visão) e reuniões (Whisper + GPT) continuavam funcionando de graça. | Middleware `exigirAcessoAtivo` (mesma regra do chat) nessas rotas. | `services/recursos.js`, `routes/briefing.js`, `routes/upload.js`, `routes/reunioes.js` |
| 5 | Nenhum limite por conta nas rotas de IA: uma conta em loop gerava custo sem teto. | Limites anti-rajada por conta, configuráveis por variável. Não mexem no número de mensagens do plano nem do teste. | `services/limiteIA.js`, rotas acima, `routes/chat.js` |
| 6 | Briefing sem tamanho máximo de campo: um pedido podia mandar centenas de milhares de caracteres ao gpt-4o. | Teto por campo (contexto 8.000 caracteres, objeção 2.000 etc.). | `routes/briefing.js` |
| 7 | Chat aceitava qualquer quantidade de anexos e texto livre em `ferramenta`/`area_ativa`, que vão para o prompt. Fechar a aba não interrompia a geração. | Máx. 5 anexos, `ferramenta` só com nome válido, área só nome/ícone curtos; geração interrompida quando a conexão cai. | `routes/chat.js` |
| 8 | Convite de reunião: HTML do título e do nome do cliente ia sem escape no e-mail, qualquer endereço era aceito, e o link enviado ao cliente levava o token de anfitrião (inicia gravação, permite expulsar participantes). | Escape, validação de e-mail, limite de 10 convites/hora, link do cliente sem token. Botão "Entrar na sala" para o anfitrião. Aviso de gravação no e-mail. | `routes/reunioes.js`, `routes/webhookDaily.js`, `frontend/js/app.js` |
| 9 | Chat público da landing oferecia ranking, agenda e painel do gestor, que saíram do produto. | Lista de recursos alinhada ao produto atual. | `routes/public.js` |
| 10 | `body-parser` 1.20.8 com alerta alto (DoS). | 1.20.9 (só o lockfile). | `package-lock.json` |

Preparado, não executado: `database/migration_rls_padrao_negado.sql` (RLS negado por padrão em todas as tabelas). Precisa de backup e aprovação.

## Variáveis novas (todas opcionais)

`TRUST_PROXY_HOPS` (padrão 1), `LIMITE_CHAT_10MIN` (40), `LIMITE_BRIEFING_HORA` (20), `LIMITE_IMAGEM_HORA` (20), `LIMITE_REUNIAO_HORA` (20), `LIMITE_CONVITE_HORA` (10).

## Testes

`npm test`: 92 testes, 92 passando (78 anteriores + 14 novos em `tests/fase1-p0.test.cjs`).
Banco, IA, e-mail e Daily simulados. Nenhum dado real usado.

## Rollback

Cada item é independente. Rollback total: reverter o merge (`git revert -m 1 <commit do merge>`) e publicar.
Rollback parcial sem deploy de código: aumentar os limites pelas variáveis acima; `TRUST_PROXY_HOPS=0` volta ao comportamento anterior.

## Antes de publicar

1. Revisar o diff e aprovar.
2. Testar no ambiente de homologação: login, chat, gerar briefing, criar reunião, copiar link do cliente, entrar como anfitrião.
3. Conferir no log do Railway, depois do deploy, que o aviso `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` não aparece mais.

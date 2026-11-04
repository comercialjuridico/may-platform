# Retenção: camadas 1, 2 e 3

Branch `retencao/camadas-1-3`. Objetivo: a May passa a guardar, a cada uso, o que o cliente perderia ao cancelar.

## O que entra

| Camada | O que o usuário vê | Onde está |
|---|---|---|
| 1. Memória do escritório | Item "Memória do escritório" no menu: serviços, honorários, pagamento, cliente típico, diferenciais, tom, objeções e scripts. Barra de quanto está preenchido. A cada 6 mensagens em ferramentas reais (não em simulações), a May sugere o que aprendeu; só entra com aprovação. A memória vai para todas as respostas, simulações e briefings. | `routes/memoria.js`, `services/memoria.js`, `services/may.js`, `routes/chat.js`, `routes/briefing.js`, `frontend/js/retencao.js` |
| 2. Ficha do cliente | "Como foi a reunião" ganhou próximo passo e data do retorno. Nova aba "Retornos" (atrasados, hoje, próximos) com "Retorno feito", "Remarcar", WhatsApp e "Ver briefing". Aviso no dia por push e e-mail. | `routes/briefing.js`, `services/retencao.js`, `jobs/retencao.js`, `frontend/js/app.js`, `frontend/js/retencao.js` |
| 3. Resumo de segunda | Toda segunda às 8h30: retornos da semana, resultado das reuniões da semana passada e um treino de 10 minutos ligado à dificuldade do diagnóstico. Push e e-mail. Pode ser desligado na tela da memória. | `services/retencao.js`, `jobs/retencao.js` |
| Home | Faixas: retornos de hoje, memória pouco preenchida e sugestões para revisar. | `frontend/js/retencao.js` |

Custo de IA novo: só a extração de sugestões (gpt-4o-mini, a cada 6 mensagens, cerca de R$ 0,01). Lembretes e resumo semanal não usam IA.

## Para publicar

1. Backup do Supabase.
2. Rodar `database/migration_retencao.sql` no SQL Editor (só adiciona tabela e colunas; idempotente; rollback no fim do arquivo).
3. No Railway, **somente no projeto `illustrious-strength`**, criar a variável `JOBS_RETENCAO=true`. Sem ela, lembretes e resumo não disparam (o resto funciona).
4. Juntar o pull request na `main`.

Antes da migração o app continua funcionando: as telas novas avisam que dependem da atualização do banco e o briefing segue como antes.

## Segurança e duplicidade

- Memória é por escritório (`empresa_id` da conta); um escritório não lê a de outro (teste).
- Lembrete e resumo reservam a linha no banco antes de enviar; duas instâncias rodando não mandam em dobro (teste).
- Só recebe aviso quem está no teste ou com assinatura ativa.
- Nomes de clientes e usuários vão escapados nos e-mails (teste).
- A extração de sugestões ignora dados pessoais de clientes e simulações.

## Testes

`npm test`: 112 testes, 112 passando (20 novos em `tests/retencao.test.cjs`).

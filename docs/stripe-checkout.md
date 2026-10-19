# Cobrança hospedada no Stripe

Integração de assinatura com checkout hospedado, confirmação no servidor e portal do cliente. Testes automatizados usam fixtures locais e não concluem pagamentos reais. A operação requer configurar as credenciais, habilitar os meios de pagamento no provedor e validar o fluxo no ambiente escolhido.

## Diagnóstico do fluxo anterior

- A interface enviava `start_anual`, ausente no mapa de planos da rota Cielo.
- A pré-validação inseria campos incompatíveis com a definição de `pre_checkouts` versionada em `database/migration_cielo.sql`; o erro Supabase não era conferido. Conferir o esquema real e pedidos pendentes antes da troca.
- A interface marcava o plano como ativo localmente após checkout Cielo.
- A página oferecia R$936/ano, mas o fallback Stripe apresentava R$797/ano.
- O modal de cancelamento sempre chamava Stripe, inclusive para clientes Cielo, e ignorava respostas HTTP de erro. A rota Cielo também não conferia o HTTP do provedor.

Esses são defeitos confirmados no código. Sem logs de transações e acesso à conta Cielo não é possível atribuir uma recusa específica do emissor a uma causa exata.

## Configuração antes de publicar

1. Na mesma conta Stripe, criar preços recorrentes em BRL: R$97 a cada mês e R$936 a cada ano (cobrança anual única; não parcelamento). Produtos/preços de teste e de produção são separados.
2. Configurar no servidor, sem expor no frontend ou em mensagens:
   - `STRIPE_SECRET_KEY`: chave do ambiente escolhido (preferir chave restrita; permissões de leitura de preços/faturas e escrita em clientes, Checkout, assinaturas e portal).
   - `STRIPE_PRICE_MENSAL` e `STRIPE_PRICE_ANUAL`: IDs dos dois preços. Aliases antigos `STRIPE_PRICE_START_MENSAL/ANUAL` são aceitos quando os nomes principais estão ausentes.
   - `STRIPE_WEBHOOK_SECRET`: assinatura do endpoint correspondente ao ambiente.
   - `APP_URL=https://www.usemayapp.com` (somente origem HTTPS, sem `/app`).
3. Endpoint Stripe `POST https://www.usemayapp.com/api/stripe/webhook`. Selecionar versão `2026-09-30.endive`, alinhada ao SDK23.0.0 e confirmada em docs.stripe.com/api-versions, e eventos:
   - `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`
   - `customer.subscription.created`, `.updated`, `.deleted`, `.paused`, `.resumed`
   - `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`
   - `STRIPE_PORTAL_CONFIGURATION`: ID da configuração do portal criada para o App May.
4. Ativar o portal do cliente com atualização de cartão e cancelamento ao final do período. Deixar troca de produtos/quantidades desativada: este checkout suporta apenas uma assinatura, um item e quantidade 1. Configurar comunicações de teste/renovação e tentativas de cobrança na conta Stripe conforme a operação.
5. Conferir colunas existentes em `users`: `stripe_customer_id`, `stripe_subscription_id`, `periodo_gratis_inicio`, `plano`, `plano_status`, `plano_inicio`, `plano_fim`, `created_at`, `cielo_recurrent_payment_id`. São usadas pelo código anterior; esta alteração não requer nova migração. Manter `subscriptions_log` disponível.
6. Antes de publicar, conciliar no Cielo assinaturas ativas e pedidos pré-validados ainda pendentes. A nova versão recusa as rotas de novas contratações Cielo com HTTP410, inclusive abas antigas; não cancela recorrências existentes automaticamente. Manter credenciais e webhook Cielo durante a transição.

## Comportamento

- O App May envia apenas o plano para o backend e redireciona ao Checkout Stripe. Os dois formulários locais de PAN/CVV foram removidos. O plano só é ativado após consulta ao provedor, com vínculo de cliente, assinatura e usuário conferidos.
- O teste termina sete dias após o cadastro original. Checkout não concede outra semana. Com mais de 48h e uma margem de 32min restantes usa `trial_end`; abaixo disso ancora a primeira cobrança no fim original com `proration_behavior=none`. Sessões expiram em 31min. Nos 32min finais do teste, é necessário aguardar o término para contratar, evitando antecipar a cobrança. Validar ambos os caminhos em sandbox antes da publicação.
- As mensagens permanecem sem teto durante o teste; depois valem os limites de plano já existentes (mensal500/anual999999, configuráveis).
- Assinaturas ativas ou pendentes Stripe bloqueiam outro checkout. Um checkout aberto é reutilizado para o mesmo plano; outro plano exige concluir/expirar o checkout anterior. A chave de idempotência é compartilhada por plano para o mesmo predecessor de sessão; solicitações concorrentes com parâmetros diferentes falham em vez de criarem duas sessões.
- Uma assinatura ativa com fatura ainda não paga fica pendente: somente o teste original ou uma fatura confirmada libera acesso. Métodos elegíveis são definidos dinamicamente pelo Stripe.
- Webhooks verificam a assinatura sobre o corpo original e consultam o estado atual da assinatura. As datas são determinísticas; eventos antigos não acrescentam dias. Atualizações usam comparação do estado lido no banco para evitar sobrescrita concorrente. A auditoria guarda IDs e tipo, sem copiar o evento inteiro.
- Cancelamento desativa a renovação e conserva o período adquirido. Clientes Cielo continuam vinculados à Cielo, inclusive depois de cancelar, até conciliação manual; isso impede uma segunda recorrência automática. Antes de retirar esse vínculo, confirmar no provedor que não haverá nova cobrança e definir a data correta de contratação no Stripe. Não transferir dados de cartão entre provedores neste fluxo.
- Clientes Stripe com preços antigos diferentes dos IDs configurados, vários itens ou metadados ausentes precisam de conciliação antes da troca; o serviço recusa conceder acesso usando um plano ambíguo. Não mudar IDs de preço de assinantes existentes sem plano de migração.

## Verificação

A API estável e o SDK foram atualizados juntos: `2026-09-30.endive` e `stripe23.0.0`. Assinaturas da API atual usam datas dos itens; o serviço também reconhece os campos antigos. A fatura mais recente é consultada para impedir liberação de acesso durante pagamento assíncrono pendente.

`npm test` cobre assinatura de webhook, checkout por plano, preços divergentes, retorno sem confirmação, conta diferente, teste original e seus limites, repetição/ordem de eventos, falha e recuperação de pagamento, concorrência, vínculo Cielo, cancelamento e regressões de segurança.

Ainda é necessário testar na conta Stripe sandbox: os dois planos, cartão aprovado/recusado, autenticação 3DS, abandono e retorno, portal e cancelamento, primeira cobrança após teste, renovação, webhook com assinatura/reenvio e as últimas48h do teste. Usar usuários separados e somente dados de teste oficiais. Depois configurar os objetos/chaves live e publicar a revisão aprovada. Não desativar Cielo ou cobrar cartões reais como teste.

Referências: https://docs.stripe.com/payments/checkout/free-trials e https://docs.stripe.com/payments/checkout/billing-cycle ; parâmetros do SDK instalado em `stripe/cjs/resources/Checkout/Sessions.d.ts` (API2026-09-30.endive).

# Segurança — primeira etapa

## Alterações

- Autoriza a conversa por usuário antes de abrir SSE e de acessar banco/IA.
- Filtra histórico por usuário e usa as mensagens recentes na ordem correta.
- Sanitiza Markdown com DOMPurify local e falha como texto caso ele não carregue.
- Escapa argumentos de ações da interface e deixa de interpolar avatar em HTML.
- Carrega estado real de 2FA; impede sobrescrita do segredo ativo, valida código,
  trata erros de persistência e limita tentativas por conta e IP.
- Corrige URLs de configuração de 2FA no frontend.
- Restringe convites ao destinatário e à validade; reset de senha é de uso único
  e revoga renovação de sessões anteriores. Access tokens já emitidos podem
  continuar válidos até sua expiração, padrão de 15 minutos.
- Webhook Cielo consulta o provedor, comprova vínculo entre transação e
  recorrência, confere moeda/valor e não soma validade em eventos repetidos.
- Webhook Stripe usa os bytes originais preservados antes do parser JSON.
- Exportação de PDF aceita somente logo próprio do Storage configurado, sem
  redirecionamentos, com limite de tamanho e timeout.
- Falha fechada no segredo de cron ausente e exige segredos JWT distintos.
- Atualiza dependências compatíveis e utiliza watch nativo no desenvolvimento.
- `npm test` executa efetivamente os testes de segurança e os testes do trial.

Nenhuma migração do banco é necessária para esta etapa. O trial continua
ilimitado em mensagens durante sete dias.

## Cielo: contrato de integração

Notificações são avisos, não autorização. A aplicação confirma dados através
da API com as credenciais da loja. Valores esperados seguem a tabela existente
do serviço Cielo; a unificação comercial de planos/preços é uma etapa separada.

ChangeType 1 é alteração de transação, 2 criação de recorrência, 3 antifraude,
4 alteração de recorrência e 7 chargeback. Os tipos 3/7 não podem ser tratados
como cancelamento/renovação. Somente pagamentos capturados e comprovados podem
conceder período pago. Eventos de ciclo de vida, estorno e chargeback requerem
conciliação dedicada; nesta etapa não removem acesso por notificação isolada.

O próximo vencimento é calculado de forma determinística sobre CapturedDate,
sem somar um período a cada chegada do webhook. Compare-and-set protege contra
sobrescrita por consulta concorrente. Erros transitórios retornam 503/502 para
permitir retentativa, sem dar sucesso falso. Data sem offset é interpretada BRT.

Proteção adicional opcional: configurar CIELO_WEBHOOK_SECRET no ambiente e o
mesmo valor no header x-cielo-webhook-secret nas notificações do painel Cielo.
Não definir apenas um lado. Sem esse segredo, toda alteração continua exigindo
consulta e confirmação do provedor; o corpo enviado não é confiável.

Referências verificadas:
- https://docs.cielo.com.br/ecommerce-cielo/docs/webhook
- https://docs.cielo.com.br/ecommerce-cielo/reference/consulta-recorrencia-api

## Validação

Executar `npm ci --ignore-scripts`, `npm test` e
`npm audit --omit=dev --audit-level=high`.

Testes HTTP locais usam banco e fornecedores simulados; nenhuma cobrança,
mensagem ou leitura de conta real é feita. Casos cobrem isolamento entre contas,
injeção no DOM, 2FA correto/incorreto, tentativas repetidas, assinatura Stripe,
notificações Cielo divergentes/repetidas, troca de senha e SSRF por imagem.

Antes de homologar os fluxos financeiros completos, utilizar conta sandbox e
confirmar os campos efetivos das respostas Cielo sem armazenar PAN/CVV em logs.
Checagem pública de produção não substitui essa homologação autenticada.

## Próximas etapas de segurança

- Conferir RLS, grants/RPCs e backups/restauração no Supabase real.
- Separar tokens de anfitrião/convidado e tornar salas privadas no Daily.
- Revogação completa de sessões por dispositivo, proteção de segredos TOTP,
  códigos de recuperação, cookies HttpOnly e CSP após retirar handlers inline.
- Limitar custo/concorrência de IA e uploads, validar conteúdo de arquivo e
  migrar processamento de gravações para fila durável.
- Migrar o runtime Node 20 para uma LTS suportada após validar o builder Railway.
  A mudança de builder/runtime não faz parte desta publicação.
- Revisar logs e tratamento de cartão com checkout/tokenização no provedor.
- Rever visibilidade do repositório e propriedade intelectual da metodologia.
- Resolver alertas transitivos remanescentes de documentos sem downgrade cego
  que comprometa leitura de Word.

Esta etapa reduz riscos específicos; não certifica conformidade LGPD nem
declara a plataforma integralmente segura.

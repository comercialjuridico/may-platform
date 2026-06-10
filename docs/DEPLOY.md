# Deploy no Railway — Passo a passo completo

## Pré-requisitos
- Conta no Railway (railway.app)
- Conta no Supabase (supabase.com)
- Conta no Stripe (stripe.com)
- Conta no Resend (resend.com)
- Repositório no GitHub com o código

---

## PASSO 1 — Supabase

1. Acesse supabase.com → New project
2. Anote: Project URL e service_role key (Settings → API)
3. Vá em SQL Editor → New query
4. Cole todo o conteúdo de `database/schema.sql` e execute
5. Confirme que as tabelas foram criadas em Table Editor

---

## PASSO 2 — Stripe

1. Acesse dashboard.stripe.com
2. Crie dois produtos:
   - "May Mensal" → preço recorrente mensal → copie o Price ID
   - "May Anual" → preço recorrente anual → copie o Price ID
3. Vá em Developers → API Keys → copie a Secret Key
4. Webhooks → Add endpoint:
   - URL: `https://seu-dominio.up.railway.app/api/stripe/webhook`
   - Eventos: `invoice.payment_succeeded`, `invoice.payment_failed`,
     `customer.subscription.deleted`, `customer.subscription.updated`
   - Copie o Webhook Secret

---

## PASSO 3 — Resend

1. Acesse resend.com → API Keys → Create API Key
2. Adicione e verifique seu domínio (Domains)
3. Copie a API Key

---

## PASSO 4 — Railway

1. Acesse railway.app → New Project → Deploy from GitHub repo
2. Selecione o repositório da plataforma May
3. Vá em Variables e adicione TODAS as variáveis do `.env.example`:

```
PORT=3000
NODE_ENV=production
JWT_SECRET=[gere com: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"]
JWT_REFRESH_SECRET=[gere outro aleatório]
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_MENSAL=price_...
STRIPE_PRICE_ANUAL=price_...
RESEND_API_KEY=re_...
EMAIL_FROM=may@seudominio.com
EMAIL_FROM_NAME=May — Assistente de Vendas
APP_URL=https://seu-projeto.up.railway.app
APP_NAME=May
LIMITE_FREE=20
LIMITE_MENSAL=500
LIMITE_ANUAL=999999
```

4. Em Settings → Networking: gere um domínio público
5. Atualize APP_URL com o domínio gerado
6. O deploy acontece automaticamente

---

## PASSO 5 — Domínio personalizado (opcional)

1. No Railway: Settings → Networking → Custom Domain
2. Adicione seu domínio (ex: may.seusite.com.br)
3. Configure o CNAME no seu DNS apontando para o Railway
4. Atualize APP_URL nas variáveis

---

## PASSO 6 — Verificar deploy

1. Acesse `https://seu-dominio/api/health` — deve retornar `{"status":"ok"}`
2. Acesse `https://seu-dominio/auth.html` — tela de login deve aparecer
3. Crie uma conta de teste
4. Complete o diagnóstico
5. Envie uma mensagem no chat
6. Teste o checkout do Stripe (use cartão de teste: 4242 4242 4242 4242)

---

## Custos estimados mensais de operação

| Item | Custo estimado |
|------|---------------|
| Railway (Starter) | US$ 5-20/mês |
| Supabase (Free tier) | US$ 0 (até 500MB) |
| Anthropic Claude API | ~R$ 5/usuário/mês |
| OpenAI Whisper | ~R$ 0,50/hora de áudio |
| Resend (Free tier) | US$ 0 (até 3.000 emails/mês) |
| Stripe | 2,9% + R$1,30 por transação |

---

## Comandos úteis

```bash
# Instalar dependências
npm install

# Rodar localmente
npm run dev

# Verificar variáveis de ambiente
node -e "require('dotenv').config(); console.log(process.env.ANTHROPIC_API_KEY ? 'OK' : 'FALTANDO')"
```

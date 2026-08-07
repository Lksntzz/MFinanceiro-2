# MFinanceiro

Aplicação web de gestão financeira pessoal, com autenticação, separação de dados por usuário e painel administrativo para controle de acesso.

## Finalidade

O MFinanceiro reúne em uma única interface:

- receitas e despesas;
- contas fixas e lançamentos diários;
- cartões de crédito e parcelas;
- metas financeiras e orçamentos;
- investimentos e assinaturas;
- histórico, gráficos, relatórios e importação de extratos;
- configurações pessoais;
- notificações e modo de manutenção;
- solicitação e aprovação administrativa de novos acessos.

## Arquitetura

- **Frontend:** React 19 + TypeScript + Vite
- **Estilos:** Tailwind CSS
- **Banco e autenticação:** Supabase
- **Hospedagem:** Vercel
- **Gráficos:** Chart.js, Recharts e react-chartjs-2
- **Arquivos e relatórios:** XLSX, PapaParse, jsPDF e PDF.js
- **IA:** OCR opcional com Gemini em Supabase Edge Function, confiança por linha e revisão humana
- **Navegação:** React Router com URLs reais sob `/app`

## Segurança do acesso

A solicitação inicial envia somente nome e e-mail. A senha é criada posteriormente pelo próprio usuário através do Supabase Auth, depois que a solicitação for aprovada.

Nunca armazene senhas na tabela `mf_access_requests` e nunca exponha chaves `service_role` no frontend.

As operações administrativas devem ser protegidas por políticas RLS e pela função `mf_is_admin_user()`, baseada no `app_metadata.role` do usuário autenticado.

## Configuração local

### Requisitos

- Node.js compatível com o projeto
- npm
- projeto Supabase configurado

### Instalação

```bash
npm install
cp .env.example .env.local
npm run dev
```

A aplicação será iniciada normalmente em `http://localhost:3000`.

## Variáveis de ambiente

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-publicavel-ou-anon
VITE_APP_URL=http://localhost:3000
```

Somente valores públicos podem usar o prefixo `VITE_`, pois eles são incorporados ao bundle do navegador.

## Scripts

```bash
npm run dev       # servidor local
npm run build     # build de produção
npm run preview   # pré-visualização do build
npm run lint      # verificação TypeScript sem emitir arquivos
npm run clean     # remove o diretório dist
```

## Deploy no Vercel

O projeto Vercel está conectado à branch `main` do repositório. Cada commit enviado para essa branch gera um novo deployment.

Configure no Vercel, para os ambientes Production, Preview e Development:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_APP_URL`

Os segredos `GEMINI_API_KEY`, `GEMINI_OCR_MODEL`, `OPEN_FINANCE_CONNECT_API_URL`,
`OPEN_FINANCE_PROVIDER_API_KEY`, `OPEN_FINANCE_PROVIDER` e `OPEN_FINANCE_REDIRECT_URI`
devem ser configurados somente nas Supabase Edge Functions. Nunca use o prefixo
`VITE_` para essas credenciais.

O domínio principal do projeto é `mfinanceiro.com.br`.

## Banco de dados

O banco possui tabelas para perfis, lançamentos, cartões, parcelas, contas, metas, investimentos, assinaturas, orçamentos, configurações globais e solicitações de acesso.

Todas as tabelas de dados pessoais devem manter RLS ativado e restringir operações ao proprietário através de `user_id = auth.uid()`.

Alterações estruturais devem ser registradas como migrations na pasta `supabase/migrations` e aplicadas pelo fluxo de migrations do Supabase.

### Automação, OCR e Open Finance

A migration `20260807023936_operational_automation_and_open_finance.sql` adiciona regras de
categorização, revisão de OCR, desfazer de lotes e o estado auditável das conexões e
sincronizações Open Finance. Antes de habilitar esses recursos em produção:

```bash
supabase db push
supabase functions deploy statement-ocr
supabase functions deploy open-finance-session
```

Configure `GEMINI_API_KEY` e os segredos `OPEN_FINANCE_*` com `supabase secrets set`.
A função de Open Finance prepara a autorização e o estado do consentimento; callback,
troca de tokens e sincronização efetiva devem ser implementados no adaptador do
participante/agregador escolhido, sempre no servidor.

## Fluxo de acesso

1. O visitante envia nome e e-mail.
2. A RPC `submit_access_request` registra ou atualiza a solicitação.
3. O administrador analisa a fila.
4. A solicitação é aprovada ou negada.
5. O usuário consulta o status pela RPC `check_access_request_status`.
6. Após aprovação, o usuário cria sua senha diretamente no Supabase Auth.
7. O login passa a ser feito pelo Supabase Auth.

## Boas práticas de contribuição

- não enviar `.env.local` ao GitHub;
- não colocar senhas, tokens privados ou chaves administrativas no código;
- executar `npm run lint` e `npm run build` antes de publicar;
- criar migrations para alterações de banco;
- manter as políticas RLS simples, não duplicadas e testadas para usuários diferentes.

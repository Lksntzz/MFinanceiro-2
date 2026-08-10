# MF Financeiro Mobile — Checkpoint de integração

Atualizado em 2026-08-10 para preservar o estado da frente mobile + reorganização de produto antes do QA final e do envio único para `main`.

## Branch oficial

`agent/mobile-product-integration`

PR oficial: **#8 — integration: combine mobile experience with product cleanup**.

## Regra de publicação

- manter a PR #8 em Draft enquanto houver QA de aparelho/release pendente;
- não fazer merge parcial das PRs antigas;
- não promover esta branch para `main` ou produção durante a fase de validação;
- publicar o pacote apenas depois do QA final mobile + desktop e da validação controlada do OCR documental.

## Produto preservado

### Mobile próprio

A experiência mobile vive em `src/mobile` e continua separada da apresentação desktop pelo boundary em `DashboardBootstrap.tsx`.

Inclui:

- Home mobile simplificada;
- Movimentações;
- Cartões;
- menu Mais;
- MF Quick;
- MF Scan;
- MF Inbox;
- Disponível de verdade;
- Posso gastar?;
- Compartilhar para o MF;
- MF Voice;
- recorrência inteligente;
- atalhos/deep links `/quick`, `/scan`, `/voice`, `/share` e `/recurrences`;
- hardening de safe areas, teclado, touch targets, rotação e landscape.

### Desktop / produto

A branch também preserva a reorganização conceitual integrada anteriormente:

- navegação desktop simplificada;
- Contas e Categorias separadas;
- Recorrências na Agenda;
- Simulador;
- Insights reorganizado;
- lançamento universal desktop;
- redirects de compatibilidade para rotas antigas.

## Arquitetura protegida

- um backend e um núcleo financeiro compartilhado;
- apresentação mobile separada da apresentação desktop;
- MF Quick, MF Scan e MF Voice confirmados continuam usando o RPC financeiro existente;
- MF Inbox reutiliza Storage privado, RLS, extrações e importação existentes;
- recorrência inteligente reutiliza `mf_create_fixed_bill_recurring` somente após confirmação explícita;
- nenhuma recorrência, pagamento, Pix ou lançamento OCR é executado silenciosamente.

## Compartilhar para o MF

O Share Target da PWA recebe texto, URL, PDF e imagens e mantém o payload temporariamente no IndexedDB do aparelho.

### Correções de QA desta rodada

- salvar um documento não apaga mais a fila inteira de arquivos compartilhados;
- somente o documento confirmado é removido do payload local;
- a fila 2 → 1 força um novo `MobileScan`, evitando que o último documento herde o estado do anterior;
- arquivos com nomes iguais continuam diferenciados por posição/metadados;
- cancelar o compartilhamento limpa o payload local antes de voltar à Home;
- a regra de preservação da fila entrou em `npm run mobile:check`.

O fluxo continua exigindo revisão e confirmação humana antes de gravar no ledger.

## OCR específico para contas e recibos

A implementação permanece preparada, mas **desligada até o release**.

- Edge Function `supabase/functions/document-ocr`, separada de `statement-ocr`;
- JWT é revalidado dentro da função;
- consultas e Storage usam o contexto do usuário/RLS;
- extração exige `user_id` autenticado e `document_type = 'other'`;
- usa `mf-import-documents` e `mf_document_extractions`, sem migration nova;
- extrai empresa, descrição, valor, vencimento, data, período, status de pagamento, categoria sugerida e confiança;
- categorias sugeridas são limitadas às categorias ativas do usuário;
- `requires_human_review = true` permanece obrigatório;
- cliente protegido por `VITE_DOCUMENT_OCR_ENABLED=false`;
- **a função ainda não foi deployada no Supabase ativo**.

### Limite de OCR

Foi criado um limite específico de **8 MB** para OCR visual, validado tanto no cliente quanto na Edge Function antes da conversão para base64. Arquivos maiores ainda podem seguir para revisão/manual ou outros fluxos apropriados, mas não entram no OCR visual.

### Sequência obrigatória no release do OCR

1. revisar novamente função e secrets;
2. deployar `document-ocr` com verificação JWT;
3. testar invocação autenticada controlada com PDF e imagem;
4. habilitar `VITE_DOCUMENT_OCR_ENABLED=true` somente no ambiente pretendido;
5. rebuildar o frontend;
6. testar câmera, galeria, PDF e Compartilhar para o MF em aparelho real;
7. manter confirmação humana obrigatória antes do lançamento.

## MF Voice

- rota `/voice` e entrada pelo MF Quick/PWA;
- reconhecimento `pt-BR` quando suportado;
- fallback para ditado do teclado ou texto digitado;
- parser local para tipo, valor, categoria e conta;
- revisão explícita obrigatória;
- grava somente após confirmação via `mf_create_finance_entry_v3`;
- nenhum áudio é armazenado pelo MF nesta versão.

## Recorrência inteligente

- rota `/recurrences`;
- analisa até sete meses e exige pelo menos três meses de padrão;
- aceita recorrências de valor variável;
- classificação de variabilidade combina desvio e amplitude entre ciclos;
- bloqueia comerciantes com alta frequência mensal;
- exclui contas já acompanhadas;
- usuário revisa nome, valor de referência, dia e categoria;
- só então chama `mf_create_fixed_bill_recurring`.

## Hardening mobile

A camada `src/mobile/mobile-hardening.css` cobre:

- safe areas horizontais e verticais;
- scroll padding para cabeçalhos/teclado;
- alvos de toque mínimos nos controles identificados;
- `touch-action` e `focus-visible`;
- mitigação de zoom automático de inputs no iOS/WebKit;
- CSS-base explícito nas rotas standalone;
- persistência da experiência mobile em telefone landscape;
- `data-mf-mobile` para impedir que regras desktop escondam a UI após rotação.

## Segurança de dependências / importadores

Esta rodada tratou especialmente bibliotecas que processam arquivos controlados pelo usuário.

### SheetJS

- `xlsx` antigo foi substituído pela distribuição mantida **SheetJS 0.20.3**;
- `package-lock.json` foi regenerado de forma reproduzível pelo GitHub Actions;
- o lock registra origem oficial do pacote e integridade SHA-512.

### PDF.js

- `pdfjs-dist` foi atualizado para **6.2.108**;
- importador de extratos continuou compatível após a atualização;
- parser de holerite foi restaurado integralmente com validação de arquivo, limite de 20 MB, progresso e heurísticas existentes;
- extratos e holerites agora usam o mesmo build `legacy`/worker do PDF.js;
- o build deixou de emitir dois workers PDF e passou a emitir apenas um;
- o chunk `vendor-pdf` caiu de aproximadamente 1,0 MB para aproximadamente 534 KB no build de produção.

### Audit npm

Foi aplicado `npm audit fix` **sem `--force`**, somente dentro das faixas compatíveis do lockfile.

Estado validado:

- 349 pacotes auditados;
- **0 vulnerabilidades high/critical**;
- **0 moderate**;
- permanece **1 low**, em `esbuild`, ligada ao dev server em Windows;
- o CI executa `npm audit --omit=dev --audit-level=high` como gate obrigatório e passa a bloquear regressões de severidade alta.

Os workflows temporários com permissão de escrita usados apenas para regenerar lockfiles/restaurar arquivo foram removidos após cada operação.

## Validação automatizada

`Mobile CI` executa, nesta ordem:

1. `npm ci`;
2. audit de dependências de produção com gate high;
3. `npm run mobile:check`;
4. `tsc --noEmit`;
5. build Vite de produção.

`mobile:check` cobre:

- Voice despesa/receita;
- Pix BR Code;
- boleto;
- arrecadação;
- recorrência variável;
- bloqueio de comerciante frequente;
- bloqueio de recorrência já cadastrada;
- preservação da fila de documentos compartilhados.

Último estado funcional desta rodada:

- audit de produção: success;
- mobile logic checks: success;
- TypeScript: success;
- production build: success;
- preview Vercel da branch: READY nos commits funcionais validados.

## QA que permanece obrigatório antes do merge

- smoke test autenticado em 320 / 360 / 390 / 412 / 430 px;
- regressão visual desktop autenticada;
- MF Inbox com extrato real;
- MF Scan em aparelho real;
- Compartilhar para o MF em PWA Android instalada, incluindo fila com 2+ documentos;
- MF Voice com permissão real de microfone e fallback de ditado;
- recorrência inteligente com histórico real;
- rotação portrait/landscape;
- teclado virtual e safe areas em iPhone/Android;
- câmera e galeria em aparelho real;
- teste de importação XLS/XLSX real após SheetJS 0.20.3;
- teste de extrato PDF real e holerite PDF real após PDF.js 6.2.108;
- deploy e validação controlada de `document-ocr` somente na etapa de release;
- OCR real em conta, boleto/conta de consumo, recibo e comprovante;
- CI + preview final antes de qualquer promoção.

## Estado de publicação

- branch oficial: `agent/mobile-product-integration`;
- PR #8 deve permanecer Draft;
- nenhuma promoção para `main` foi autorizada;
- nenhuma publicação de `document-ocr` foi autorizada;
- produção permanece fora desta rodada.

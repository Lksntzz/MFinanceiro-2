# MF Financeiro Mobile — Checkpoint

Checkpoint criado em 2026-08-08 para preservar o estado atual da integração mobile + reorganização de produto antes de novas rodadas de alterações.

## Branch oficial de continuidade

`agent/mobile-product-integration`

A partir deste checkpoint, novas correções e melhorias relacionadas ao mobile e à integração com a experiência desktop devem continuar nesta branch até a decisão explícita de envio final.

## Regra de publicação

- não fazer merge parcial das PRs #6 ou #7;
- usar a PR #8 como frente integrada;
- não promover para `main` ou produção enquanto houver novas alterações planejadas para este pacote;
- futuras mudanças devem ser commitadas e validadas na branch integrada;
- quando o pacote estiver fechado, executar QA final mobile + desktop e somente então decidir o merge único.

## Estado preservado neste checkpoint

### Mobile

- experiência mobile própria em `src/mobile`;
- Home simplificada;
- Movimentações;
- Cartões;
- menu Mais;
- MF Quick;
- MF Scan;
- MF Inbox persistente;
- Disponível de verdade;
- Posso gastar?;
- atalhos PWA para lançamento, scanner e MF Voice;
- suporte a deep links `/quick`, `/scan`, `/voice` e `/recurrences` via fallback SPA;
- `/app/lancar` redireciona para MF Quick no modo mobile.

### Desktop / produto

A branch integrada também contém a reorganização conceitual da PR #7, incluindo:

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
- `DashboardBootstrap.tsx` funciona como boundary entre as experiências;
- nenhuma migration ou schema novo foi necessário para esta etapa;
- MF Quick e MF Scan confirmado reutilizam o RPC financeiro existente;
- MF Inbox reutiliza Storage privado, RLS, tabelas de extração e fluxo de importação existentes.

## Validações já concluídas antes deste checkpoint

- TypeScript check: success;
- production build: success;
- Preview Vercel integrado: READY;
- PR #8: mergeable=true;
- branch integrada à frente da `main` e sem commits atrás no momento da consolidação;
- deep links PWA revisados;
- conflito entre PR #6 e PR #7 reconciliado no boundary.

## Evolução após o checkpoint

### Compartilhar para o MF

Implementado como integração progressiva de PWA, sem duplicar a lógica financeira do MF Scan:

- o manifest registra o MF como `share_target` para texto, URL, PDF, JPEG, PNG e WebP;
- o service worker intercepta o POST `/share` quando a PWA instalada recebe conteúdo do sistema operacional;
- o conteúdo fica temporariamente no IndexedDB do próprio aparelho, com limpeza de payloads antigos;
- nenhum documento é enviado ao Supabase apenas por ter sido compartilhado;
- `/share` abre uma tela autenticada de recepção e encaminha o arquivo/texto para o mesmo `MobileScan` usado por câmera, galeria e upload manual;
- múltiplos documentos exigem seleção explícita e são revisados um por vez;
- o MF Scan continua exigindo confirmação antes de gravar no ledger;
- os lançamentos confirmados pelo compartilhamento usam o mesmo RPC `mf_create_finance_entry_v3`, com origem `MF Share Mobile`;
- limite local do compartilhamento: 20 MB no total e até 5 arquivos aceitos por vez;
- o fluxo é progressivo: Web Share Target como destino instalado é suportado principalmente em Android/ChromeOS; iOS continua usando câmera/arquivo/atalhos até existir wrapper/extensão nativa apropriada.

### OCR específico para contas e recibos

Implementação preparada na branch, propositalmente desligada até o envio final:

- nova Edge Function `supabase/functions/document-ocr`, separada de `statement-ocr`;
- a função foi desenhada para JWT obrigatório e trabalha com o cliente do usuário/RLS, sem service role no navegador;
- reutiliza `mf-import-documents` e `mf_document_extractions` com `document_type = 'other'`, portanto não exige migration;
- extrai apenas campos úteis ao mobile: tipo de documento, empresa/estabelecimento, descrição, valor, vencimento, data do documento, período de referência, situação de pagamento, categoria sugerida, confiança por campo e avisos;
- categorias são limitadas aos nomes ativos do próprio usuário; sugestão fora da lista é descartada;
- resultado fica em `result_metadata`, com `requires_human_review = true`;
- o MF Scan combina OCR visual com a leitura local de QR/boleto quando disponível e continua exigindo confirmação antes de qualquer gravação financeira;
- se o OCR falhar, o fluxo volta automaticamente para QR/código/manual sem bloquear a captura;
- após confirmação do lançamento, a extração OCR pode ser marcada como `completed` sem transformar falha de finalização em duplicação de lançamento;
- cliente protegido por `VITE_DOCUMENT_OCR_ENABLED`; `.env.example` mantém a flag como `false`;
- **a Edge Function não foi deployada no Supabase ativo e a flag não foi habilitada**, respeitando a decisão de publicar o pacote todo de uma vez;
- CI do frontend após a integração: TypeScript success + production build success;
- Preview Vercel do frontend: READY com o recurso desabilitado por padrão.

#### Sequência obrigatória no release do OCR documental

1. revisar novamente a função `document-ocr` e os secrets existentes;
2. deployar `document-ocr` com `verify_jwt = true`;
3. testar uma invocação autenticada controlada em PDF e imagem;
4. habilitar `VITE_DOCUMENT_OCR_ENABLED=true` somente no ambiente pretendido;
5. rebuildar o frontend;
6. testar câmera, galeria, PDF e Compartilhar para o MF em aparelho real;
7. manter confirmação humana obrigatória antes de criar o lançamento.

### MF Voice

Implementado como uma entrada adicional do MF Quick, sem criar um assistente financeiro paralelo:

- rota mobile dedicada `/voice`, com rewrite SPA e entrada direta pelo boundary;
- atalho dentro do MF Quick e shortcut adicional no manifest PWA;
- usa `SpeechRecognition`/`webkitSpeechRecognition` quando o navegador disponibiliza reconhecimento de fala;
- comportamento progressivo: sem suporte nativo, a tela continua utilizável pelo ditado do teclado ou frase digitada;
- idioma configurado para `pt-BR`, reconhecimento de uma frase por vez;
- parser local identifica despesa/receita, valor, categoria provável e conta provável por regras determinísticas;
- exemplos cobertos incluem frases como “Gastei 48 reais de gasolina” e equivalentes de receita;
- categorias e contas são sempre limitadas aos dados existentes do próprio usuário;
- a frase reconhecida fica editável e o usuário precisa revisar tipo, valor, categoria, conta e descrição;
- nenhuma gravação acontece apenas pela fala;
- lançamento confirmado usa `mf_create_finance_entry_v3`, com origem `MF Voice Mobile`;
- o MF não armazena o áudio nesta versão; apenas a frase revisada pode ser registrada em notas do lançamento;
- erros/permissão negada/não detecção de fala têm fallback para edição manual;
- CI do HEAD do MF Voice: instalação, TypeScript e production build success;
- Preview Vercel do HEAD do MF Voice: READY.

### Recorrência inteligente

Implementada como detector local de padrões no histórico, usando a infraestrutura de recorrências que o desktop já possui:

- rota mobile dedicada `/recurrences`, acessível pelo MF Quick e com fallback SPA;
- analisa até sete meses recentes de despesas no ledger e exige pelo menos três meses de padrão antes de sugerir;
- identifica recorrência por descrição normalizada, cobertura mensal, proximidade do dia do mês e frequência;
- **não exige valor idêntico**: contas de energia, água e outras cobranças variáveis podem ser reconhecidas como recorrentes;
- calcula um valor mediano apenas como referência inicial e sinaliza quando o histórico é variável;
- rejeita padrões de alta frequência dentro do mesmo mês para reduzir falsos positivos como supermercado, mobilidade e compras frequentes;
- exclui sugestões que já se parecem com contas fixas ou assinaturas existentes;
- apresenta confiança, motivo, valor típico, dia esperado e quantidade de meses observados;
- usuário revisa nome, valor de referência, dia esperado e categoria antes de confirmar;
- somente após confirmação chama o RPC existente `mf_create_fixed_bill_recurring`, que valida o usuário autenticado e gera as ocorrências futuras;
- “Ignorar por enquanto” é local ao aparelho via `localStorage`; não cria estado novo no banco;
- nenhuma recorrência é criada automaticamente;
- nenhuma migration/schema novo foi necessária;
- CI do HEAD: TypeScript e production build success;
- Preview Vercel do HEAD: READY.

### Hardening mobile / QA preventivo

Foi adicionada uma camada compartilhada de robustez em `src/mobile/mobile-hardening.css` e corrigidos problemas que poderiam aparecer apenas em aparelho real:

- `box-sizing` consistente também em todos os descendentes das telas standalone/focus;
- `textarea` incluído no tratamento de tipografia e interação do mobile;
- alvos de toque revisados para pelo menos 44 px nos controles identificados como pequenos;
- `touch-action: manipulation` e `-webkit-tap-highlight-color` aplicados aos controles principais;
- `focus-visible` explícito para teclado/acessibilidade;
- safe areas horizontais e verticais consideradas com `env(safe-area-inset-*)`;
- scroll padding ajustado para cabeçalhos, teclado e área inferior;
- controles de formulário passam a 16 px em WebKit/iOS para reduzir zoom automático ao focar campos;
- rotas standalone `/voice`, `/recurrences` e `/share` agora carregam explicitamente o CSS-base e a camada de hardening, evitando telas sem estilos quando abertas por deep link;
- o gate mobile foi reforçado para reconhecer telefone em landscape: além da largura de 820 px, usa ponteiro coarse + menor dimensão física compacta;
- `data-mf-mobile` no elemento `html` permite manter a UI mobile visível em landscape mesmo quando a largura ultrapassa 820 px, sem transformar desktop com mouse em mobile;
- listeners de resize, pointer/media e popstate mantêm o modo correto após rotação e navegação;
- CI do HEAD `a22bca9eec804df40ae23b0887e77dbe2a469a45`: TypeScript e production build success;
- Preview Vercel do mesmo HEAD: READY.

## Pendências antes do envio final

- smoke test autenticado em 320 / 360 / 390 / 412 / 430 px;
- regressão visual desktop autenticada;
- teste do MF Inbox com extrato real;
- teste do MF Scan em aparelho real;
- teste de `Compartilhar para o MF` em PWA Android instalada;
- deploy e validação controlada do `document-ocr` apenas na etapa de release;
- teste do OCR documental em conta, boleto/conta de consumo, recibo e comprovante real;
- teste do MF Voice em navegadores/aparelhos reais, incluindo permissão de microfone e fallback de ditado;
- validar recorrências inteligentes com histórico real, incluindo contas variáveis e comerciantes de alta frequência;
- validar rotação portrait/landscape, teclado virtual, safe areas e PWA em aparelho real;
- revisar novas correções e funcionalidades que forem adicionadas após este checkpoint;
- rodar novamente CI + preview antes do merge único.

## Próximas ideias já aprovadas para evolução mobile

- shortcuts/widgets e integrações nativas quando houver wrapper adequado;
- manter o mobile como companheiro financeiro diário, sem duplicar toda a complexidade do desktop.

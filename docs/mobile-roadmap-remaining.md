# MF Financeiro Mobile — Roadmap restante

Atualizado em 2026-08-10.

## Regra de execução

Implementar em sequência. Um item só muda para concluído depois de código e CI passarem. Não promover esta branch para produção sem autorização explícita.

## Fila

1. [DONE] OCR inteligente de contas e recibos no MF Scan
   - backend `document-ocr` publicado com JWT/RLS;
   - OCR não dispara automaticamente em toda captura;
   - ação explícita `Analisar com IA` controla custo e privacidade;
   - extrai empresa, valor, vencimento, situação e categoria sugerida;
   - revisão humana continua obrigatória antes de qualquer lançamento;
   - `VITE_DOCUMENT_OCR_ENABLED=false` continua disponível como kill switch.

2. [DONE] Impacto da compra
   - calcula em qual fatura a compra tende a cair usando fechamento/vencimento do cartão;
   - calcula parcela atual e futuras;
   - mostra limite após compra e uso de crédito;
   - quando a primeira parcela vence antes do próximo recebimento, projeta o impacto no valor livre e no limite diário;
   - simulador não grava compra no banco.

3. [DONE] Categorização adaptativa
   - aprende por usuário a partir do próprio histórico confirmado;
   - alta confiança exige pelo menos três ocorrências consistentes antes de pré-selecionar;
   - confiança média apenas sugere e exige ação do usuário;
   - proteções evitam aprender cedo demais ou confundir estabelecimentos de nomes genéricos;
   - integrada a MF Quick, MF Scan e MF Voice;
   - correções futuras alimentam naturalmente o histórico usado pelas próximas sugestões.

4. [DONE] MF Inbox para contas/recibos
   - fila separada para `document_type = other`;
   - não altera o Inbox de extratos existente;
   - documentos uploaded/failed podem ser analisados explicitamente;
   - documentos `reviewing` passam por revisão de valor, descrição, situação, vencimento, categoria e conta;
   - confirmação grava no ledger e finaliza a extração;
   - nada é pago por esse fluxo.

5. [DONE] MF Pulse
   - superfície rápida com `livre para hoje`, disponível de verdade e próximo compromisso;
   - ações para Lançar, Escanear e Início;
   - disponível como rota mobile e atalho PWA;
   - usa o mesmo resumo financeiro do núcleo do MF, sem segunda regra de cálculo.

6. [NATIVE CORE DONE — SIGNED SYSTEM EXTENSIONS PENDING] Camada nativa iOS/Android
   - Capacitor adicionado ao React/Vite existente;
   - projetos `ios/` e `android/` reais gerados e versionados;
   - App ID atual: `br.com.mfinanceiro.app`;
   - bridge nativo reutiliza as rotas existentes do MF;
   - custom scheme `mfinanceiro://` configurado em iOS e Android;
   - Android tem atalhos nativos para Quick, Scan e Pulse;
   - Android recebe PDF/imagem/texto pelo Share Sheet, copia o arquivo em cache privado e encaminha para a mesma fila `Compartilhar para o MF`/MF Scan com revisão humana;
   - iOS tem Home Screen quick actions reais para Quick, Scan e Pulse, incluindo cold launch;
   - template iOS de App Intents/App Shortcuts preparado para Siri/Action Button, mas não ativado sem Universal Links reais;
   - documentação preparada para WidgetKit, Share Extension, Universal Links e Android App Links;
   - assinatura/App Store/TestFlight/Google Play, Team ID, Associated Domains, App Group, AASA, assetlinks e fingerprints definitivos dependem das contas/chaves reais de distribuição e não recebem valores fictícios no repositório.

## Validação automatizada

A branch mantém o `Mobile CI` read-only com:

1. `npm ci`;
2. audit de dependências de produção;
3. `npm run mobile:check`;
4. TypeScript;
5. build Vite de produção.

`mobile:check` cobre:

- cálculo de fatura no Impacto da compra;
- categorização adaptativa;
- contratos de deep link nativo/custom scheme;
- rejeição de links externos não pertencentes ao MF;
- Share Target Android e limite/tipos de arquivo;
- registro do plugin nativo Android e reaproveitamento da fila de revisão;
- quick actions iOS para app ativo e cold launch.

## Itens já em produção antes desta branch

Home mobile, Movimentos, Cartões, Mais, MF Quick, MF Scan base, MF Inbox de extratos, Disponível de verdade, Posso gastar?, Compartilhar para o MF, MF Voice, recorrência inteligente, deep links/atalhos e hardening mobile.

## Estado desta branch

Os itens 1–5 estão implementados. No item 6, o núcleo nativo que não depende de identidade de loja também está implementado: shells Capacitor, links, atalhos, Share Android e contratos de integração.

O que permanece externo é justamente o que exige identidade/entitlements assinados: App Intents com Universal Links verificados, WidgetKit/Control Center, Share Extension iOS via App Group, App Links verificados, assinatura e publicação nas lojas. Nenhuma versão nativa deve ser considerada publicada antes de QA em aparelho físico.

Esta branch/PR permanece fora de produção até autorização explícita.
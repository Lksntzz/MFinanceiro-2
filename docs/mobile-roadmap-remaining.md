# MF Financeiro Mobile — Roadmap restante

Atualizado em 2026-08-10.

## Regra de execução

Implementar em sequência. Um item só muda para concluído depois de código, CI e preview passarem. Não promover para produção sem autorização explícita.

## Fila

1. [IN PROGRESS] OCR inteligente de contas e recibos no MF Scan
   - ativar o backend já publicado sem OCR automático em toda captura;
   - exigir ação explícita `Analisar com IA` para controlar custo e privacidade;
   - extrair empresa, valor, vencimento, situação e categoria sugerida;
   - manter revisão humana obrigatória antes de qualquer lançamento.

2. [PENDING] Impacto da compra
   - mostrar em qual fatura a compra cairá;
   - calcular parcela atual e futuras;
   - refletir impacto no valor livre e no limite diário do ciclo.

3. [PENDING] Categorização adaptativa
   - aprender por usuário a partir de confirmações/correções;
   - alta confiança pode sugerir automaticamente;
   - baixa confiança sempre pede confirmação;
   - nunca substituir silenciosamente uma categoria sem evidência suficiente.

4. [PENDING] MF Inbox para contas/recibos
   - incluir extrações `document_type = other` na fila de revisão;
   - separar claramente extratos de documentos avulsos;
   - revisar e confirmar antes de gravar no ledger.

5. [PENDING] MF Pulse
   - superfície rápida com `livre hoje`, próximo compromisso e acesso ao `+`;
   - primeira versão deve funcionar como experiência PWA/mobile antes de integração nativa completa.

6. [PENDING] Camada nativa iOS/Android
   - iOS App Intents / Siri / Action Button;
   - Share Extension iOS;
   - widgets / Lock Screen / Control Center;
   - equivalentes Android quando aplicáveis.

## Itens já em produção

Home mobile, Movimentos, Cartões, Mais, MF Quick, MF Scan base, MF Inbox de extratos, Disponível de verdade, Posso gastar?, Compartilhar para o MF, MF Voice, recorrência inteligente, deep links/atalhos e hardening mobile.
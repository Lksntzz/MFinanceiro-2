# iOS — integração nativa do MF

O shell Capacitor principal já existe em `ios/` e registra `mfinanceiro://`.

## App Intents / Siri / Action Button

O arquivo `MFAppIntents.swift.example` contém o contrato planejado para MF Quick, MF Scan e MF Pulse usando links HTTPS do domínio oficial.

Para ativar:

1. configurar Associated Domains no target `App`;
2. publicar `apple-app-site-association` no domínio com o Team ID/App ID reais;
3. adicionar `MFAppIntents.swift` ao target no Xcode;
4. compilar e testar em aparelho físico;
5. somente então expor os App Shortcuts para Siri/Action Button/Shortcuts.

## Widget / Lock Screen / Control Center

Criar um Widget Extension separado usando WidgetKit/App Intents. O primeiro widget deve priorizar MF Pulse:

- livre hoje;
- disponível de verdade;
- próximo compromisso;
- ações para `Lançar` e `Pulse`.

O widget não deve criar uma segunda regra financeira. Ele deve consumir um snapshot produzido pelo app/núcleo compartilhado.

## Share Extension

Criar Share Extension separada para receber imagem/PDF/texto. Ela deve encaminhar a captura para o app e abrir o mesmo fluxo de MF Scan/MF Inbox, preservando a regra de revisão humana antes de gravar.

## Segurança

- não salvar token Supabase em código fonte;
- não versionar provisioning profiles/certificados;
- compartilhar somente dados mínimos entre app e extensions via App Group configurado no portal Apple;
- manter ações financeiras sensíveis no app autenticado, não em widget/extension sem contexto de sessão.
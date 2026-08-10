# iOS — integração nativa do MF

O shell Capacitor principal já existe em `ios/` e registra `mfinanceiro://`.

## Home Screen quick actions — implementado

`ios/App/App/Info.plist` já publica três ações ao pressionar e segurar o ícone do MF:

- Novo lançamento → MF Quick;
- Escanear conta → MF Scan;
- MF Pulse → disponível de verdade/livre hoje.

`AppDelegate.swift` trata tanto o app já ativo quanto cold launch. Os atalhos são convertidos para `mfinanceiro://quick`, `mfinanceiro://scan` e `mfinanceiro://pulse`, reutilizando o bridge e as telas mobile existentes.

## App Intents / Siri / Action Button — aguardando identidade Apple

O arquivo `MFAppIntents.swift.example` contém o contrato planejado para MF Quick, MF Scan e MF Pulse usando links HTTPS do domínio oficial.

Apple exige Universal Link para `OpenURLIntent`; custom scheme não serve para esse tipo de App Intent. Por isso o template não é adicionado ao target antes da associação real do domínio.

Para ativar com segurança:

1. definir o Apple Team ID/App ID reais;
2. habilitar Associated Domains no target `App`;
3. publicar `apple-app-site-association` em `mfinanceiro.com.br` com os identificadores reais;
4. adicionar `MFAppIntents.swift` ao target no Xcode;
5. compilar/testar em aparelho físico;
6. validar Siri, Shortcuts e Action Button antes da distribuição.

## Widget / Lock Screen / Control Center

Criar um Widget Extension separado usando WidgetKit/App Intents. O primeiro widget deve priorizar MF Pulse:

- livre hoje;
- disponível de verdade;
- próximo compromisso;
- ações para `Lançar` e `Pulse`.

O widget não deve criar uma segunda regra financeira. Ele deve consumir um snapshot mínimo produzido pelo app/núcleo compartilhado por um App Group real.

## Share Extension

Criar Share Extension separada para receber imagem/PDF/texto. Ela deve encaminhar a captura para o app e abrir o mesmo fluxo de MF Scan/MF Inbox, preservando a regra de revisão humana antes de gravar.

O identificador de App Group e os entitlements só devem ser configurados quando a identidade Apple definitiva estiver disponível.

## Segurança

- não salvar token Supabase em código fonte;
- não versionar provisioning profiles/certificados;
- compartilhar somente dados mínimos entre app e extensions via App Group;
- manter ações financeiras sensíveis no app autenticado, não em widget/extension sem contexto de sessão;
- nenhum Team ID, App Group ou entitlement fictício deve entrar no repositório.
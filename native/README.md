# MF Financeiro — camada nativa

Esta pasta documenta a camada nativa fina do MF Financeiro. O núcleo do produto continua em React/Vite, usando o mesmo Supabase e as mesmas regras financeiras.

## Estado atual

Os projetos Capacitor já foram gerados e versionados:

- `ios/`
- `android/`

Configuração principal:

- App ID / Bundle ID: `br.com.mfinanceiro.app`
- App name: `MF Financeiro`
- Web assets: `dist`
- Custom URL scheme: `mfinanceiro://`

Comandos:

```bash
npm run native:sync
npm run native:open:ios
npm run native:open:android
```

O `npm run mobile:check` também valida os contratos dos shells nativos: deep links, Share Target Android, limites/tipos de arquivo e quick actions do iOS.

## Contrato de links

O bridge em `src/mobile/native/native-deep-links.ts` traduz links nativos para as mesmas rotas usadas pelo PWA:

- `mfinanceiro://quick` → `/quick`
- `mfinanceiro://scan` → `/scan`
- `mfinanceiro://voice` → `/voice`
- `mfinanceiro://pulse` → `/app/mobile/pulse`
- `mfinanceiro://inbox` → `/app/mobile/inbox/documentos`
- `mfinanceiro://cartoes` → `/app/planejamento/cartoes`

Links HTTPS aceitos pelo bridge devem usar `mfinanceiro.com.br`.

## Android

O shell Android já contém:

- custom scheme `mfinanceiro://`;
- link HTTPS para `mfinanceiro.com.br`;
- atalhos estáticos do launcher para MF Quick, MF Scan e MF Pulse;
- Share Target nativo `ACTION_SEND` para PDF, imagem e texto;
- cópia temporária privada de PDF/JPEG/PNG/WebP com limite de 20 MB;
- plugin Capacitor `NativeShareReceiver`;
- bridge que hidrata a mesma fila IndexedDB usada por `Compartilhar para o MF` na PWA e abre `/share?id=...`;
- nenhuma gravação financeira acontece pelo Share Target sem a revisão existente do MF Scan.

Para transformar o link HTTPS em Android App Link verificado ainda é necessário publicar `/.well-known/assetlinks.json` com o package name e o SHA-256 do certificado usado para assinar a versão final. O fingerprint só deve ser preenchido depois que a chave de assinatura definitiva existir.

## iOS

O shell iOS já contém:

- custom scheme `mfinanceiro://` em `Info.plist`;
- Home Screen quick actions estáticas para MF Quick, MF Scan e MF Pulse;
- tratamento de quick action com o app ativo e no cold launch;
- encaminhamento para as mesmas rotas mobile via `ApplicationDelegateProxy`/bridge Capacitor.

App Intents / Siri / Action Button de primeira classe continuam preparados em `native/ios/MFAppIntents.swift.example`, mas não são ativados ainda. `OpenURLIntent` exige Universal Link; ativá-lo antes de Associated Domains/AASA faria o fluxo perder a garantia de abrir o app.

As próximas integrações Apple devem permanecer finas e usar o mesmo núcleo:

- App Intents / App Shortcuts: Quick, Scan e Pulse;
- WidgetKit: MF Pulse;
- Share Extension: encaminhar PDF/imagem/texto para o fluxo de captura/revisão;
- Universal Links para `mfinanceiro.com.br`.

Universal Links exigem Associated Domains no target assinado e um arquivo `apple-app-site-association` publicado no domínio. A configuração depende do Apple Team ID / App ID definitivos e não deve receber valores fictícios.

Widget e Share Extension também devem usar App Group real para trocar apenas o mínimo de dados necessário com o app. O identificador do App Group não é inventado nesta branch.

## Assinatura e publicação

Não versionar certificados, provisioning profiles, keystores, senhas ou secrets de loja neste repositório.

Ainda exige ambiente externo:

- Xcode + conta Apple Developer para Team ID, Associated Domains, App Group, Widget/Share Extension, assinatura e App Store/TestFlight;
- Android Studio/Gradle + keystore definitivo para assinatura e Google Play;
- fingerprints/Team IDs reais para Universal Links/App Links verificados;
- QA em aparelho físico antes de considerar o app nativo publicado.

A ausência dessa etapa não altera o funcionamento do PWA atual. A camada nativa foi desenhada para reutilizar as mesmas rotas e regras financeiras, sem criar um segundo backend.
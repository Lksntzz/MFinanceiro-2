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
- atalhos estáticos do launcher para MF Quick, MF Scan e MF Pulse.

Para transformar o link HTTPS em Android App Link verificado ainda é necessário publicar `/.well-known/assetlinks.json` com o package name e o SHA-256 do certificado usado para assinar a versão final. O fingerprint só deve ser preenchido depois que a chave de assinatura definitiva existir.

## iOS

O shell iOS já registra `mfinanceiro://` em `Info.plist`.

As próximas integrações Apple devem permanecer finas e abrir as rotas web existentes:

- App Intents / App Shortcuts: Quick, Scan e Pulse;
- WidgetKit: MF Pulse;
- Share Extension: encaminhar PDF/imagem/texto para o fluxo de captura/revisão;
- Universal Links para `mfinanceiro.com.br`.

Universal Links exigem Associated Domains no target assinado e um arquivo `apple-app-site-association` publicado no domínio. A configuração depende do Apple Team ID / App ID definitivos e não deve receber valores fictícios.

## Assinatura e publicação

Não versionar certificados, provisioning profiles, keystores, senhas ou secrets de loja neste repositório.

Ainda exige ambiente externo:

- Xcode + conta Apple Developer para assinatura, entitlements, Widget/Share Extension e App Store/TestFlight;
- Android Studio/Gradle + keystore definitivo para assinatura e Google Play;
- fingerprints/Team IDs reais para Universal Links/App Links verificados.

A ausência dessa etapa não altera o funcionamento do PWA atual. A camada nativa foi desenhada para reutilizar as mesmas rotas e regras financeiras, sem criar um segundo backend.
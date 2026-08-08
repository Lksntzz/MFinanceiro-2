# MF Financeiro Mobile — Architecture

## Goal

Build a mobile-first companion for daily financial actions without duplicating the desktop product.

The desktop remains the complete financial workspace. Mobile focuses on speed, capture and essential visibility.

## Product boundary

### Desktop

The desktop keeps the complete feature set: advanced planning, imports and reconciliation, detailed analysis, automations, integrations, administration and dense management workflows.

### Mobile

The first mobile scope is intentionally small:

- Home
- Movimentações
- Quick Add
- Cartões
- Mais
- MF Scan
- MF Quick

Future mobile-only capabilities may include MF Inbox, MF Voice, “Posso gastar?”, recurring-document recognition, share-to-MF and platform shortcuts/widgets.

## Architecture rule

One product, one backend, one financial core, two presentation layers.

```text
Supabase / shared domain rules
          |
          +-- Desktop UI (existing product)
          |
          +-- Mobile UI (src/mobile)
```

Business rules must not be copied into mobile components when they can be shared.

## Update classification

Every future change should be classified before implementation:

- CORE: financial rules, data access, types, calculations and shared services. May affect desktop and mobile.
- DESKTOP: layout, navigation and desktop-only interactions. Must not affect mobile unless explicitly requested.
- MOBILE: layout, navigation and mobile-only interactions. Must not affect desktop unless explicitly requested.

## Runtime boundary

The existing desktop implementation remains untouched until the mobile shell is ready.

The mobile experience is mounted only at the application boundary. Desktop components should not be progressively compressed with more global media-query overrides.

Target compact breakpoint: 820px and below.

The compact experience can explicitly open the full desktop interface for the current session when the user needs an advanced tool.

## Initial mobile navigation

- Início
- Movimentações
- central + action
- Cartões
- Mais

The central action opens the lightweight capture layer rather than a desktop modal.

## Mobile-only capabilities

### MF Quick

Fast expense/income capture with minimal fields. It uses the same `mf_create_finance_entry_v3` database function used by the existing financial flow.

It is callable from the direct `/quick` route and is also exposed as a PWA shortcut where supported.

### MF Scan

MF Scan is a capture-and-review flow. Its first implementation supports:

- mobile camera capture through the device file/camera picker
- gallery images
- image/PDF selection
- pasted Pix Copia e Cola / barcode / digitable-line content
- native `BarcodeDetector` when the browser exposes it
- BR Code parsing for Pix static/dynamic identification
- bank boleto parsing for amount and current due-date-factor suggestions when available
- collection/agreement barcode identification without inventing fields that are not reliably encoded
- explicit manual review before any financial entry is saved

The scanner never executes a Pix or pays a boleto. It only creates a financial record after explicit user confirmation.

Because `BarcodeDetector` is not supported by every mobile browser, MF Scan must degrade to capture + manual review instead of failing.

PDF/document OCR is intentionally not faked in the first version. PDF files can enter the review flow, while full OCR/AI extraction is a later capability.

### MF Inbox

Planned review queue for imported, scanned or automatically classified financial items that need user confirmation.

Existing `mf_document_extractions` and `mf_document_extraction_items` already contain confidence/review fields and are RLS-protected, but they are not reused for MF Inbox until the current mobile branch passes build/preview validation and their storage semantics are intentionally integrated.

### Disponível de verdade

A shared financial calculation presented prominently on mobile: balance minus known commitments/protected amounts until the next expected income.

### Posso gastar?

A mobile decision helper that simulates a purchase and shows its impact on the current cycle without making the decision for the user.

## Data rules

- Mobile and desktop use the same Supabase project and user data.
- A transaction created on mobile immediately belongs to the same ledger used by desktop.
- MF Quick and confirmed MF Scan entries use the existing finance-entry RPC rather than a parallel transaction implementation.
- Mobile-specific UI preferences may be stored separately from general financial settings.
- Schema changes are only introduced when a mobile capability truly needs new persisted data.
- No schema change is required for the current Home / Quick / Scan implementation.

## Styling rules

- Mobile layout styles live under `src/mobile`.
- Feature-specific styles may live next to the feature, such as `src/mobile/pages/mobile-scan.css`.
- Existing desktop CSS should not be globally overridden for mobile-only redesign work.
- Shared design tokens may be reused, but mobile sizing/layout classes should be scoped with `mf-mobile-*`.
- Respect safe-area insets and touch targets.

## PWA integration

The existing PWA remains a single application. The manifest exposes progressive shortcuts for:

- `/quick` — Novo lançamento / MF Quick
- `/scan` — Escanear conta / MF Scan

These shortcuts are progressive enhancement: unsupported operating systems simply ignore them.

Deeper integrations such as iOS App Intents, Action Button, Share Extension or platform widgets require a later native-wrapper evaluation and are not simulated by the PWA.

## Delivery safety

Mobile development happens on dedicated branches and previews before merge.

Before merging a mobile change:

1. TypeScript check must pass.
2. Production build must pass.
3. Desktop smoke check at common desktop sizes.
4. Mobile checks at 320, 360, 390, 412 and 430 px.
5. Verify keyboard-open states, scroll, safe areas and installed-PWA mode.
6. Confirm no unrelated desktop files were modified unless the change is explicitly CORE.

A branch-only GitHub Actions workflow validates `npm ci`, `npm run lint` and `npm run build` while Vercel preview builds are rate-limited.

## Implementation phases

### Phase 0 — Foundation

- architecture contract
- mobile route map
- mobile shell
- scoped styling
- shared mobile types

Status: implemented on `agent/mobile-foundation`.

### Phase 1 — Daily use

- Home
- Quick Add
- Movimentações
- Cartões

Status: first implementation complete on the branch; visual/browser QA remains required.

### Phase 2 — Intelligent capture

- MF Scan
- review flow
- MF Inbox

Status: MF Scan capture/parsing/review is implemented. Full document OCR and persistent MF Inbox remain pending.

### Phase 3 — Native/mobile integrations

- quick route
- installable PWA shortcuts
- share target where supported
- native wrapper/app-intent evaluation for deeper iOS/Android integrations

Status: quick route and PWA shortcuts implemented; share/native integrations pending.

### Phase 4 — Decision intelligence

- Disponível de verdade
- Posso gastar?
- purchase impact
- smarter recurring recognition

Status: planned after the daily-use and capture flows pass QA.

## Non-goals

The mobile app is not intended to expose every desktop feature. A new desktop feature does not automatically become a mobile feature.

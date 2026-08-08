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

The mobile experience will be mounted only at the application boundary. Desktop components should not be progressively compressed with more global media-query overrides.

Target compact breakpoint: 820px and below.

## Initial mobile navigation

- Início
- Movimentações
- central + action
- Cartões
- Mais

The central action opens the lightweight capture layer rather than a desktop modal.

## Mobile-only capabilities

### MF Quick

Fast expense/income capture with minimal fields. Designed to be callable from a direct route and later from iOS/Android shortcuts.

### MF Scan

Capture financial information from camera, gallery, screenshots, PDFs, boleto/barcode and Pix QR content. The system extracts suggestions and always presents a review step before saving.

MF Scan must never silently create or pay a financial obligation from uncertain extraction.

### MF Inbox

Review queue for imported, scanned or automatically classified financial items that need user confirmation.

### Disponível de verdade

A shared financial calculation presented prominently on mobile: balance minus known commitments/protected amounts until the next expected income.

### Posso gastar?

A mobile decision helper that simulates a purchase and shows its impact on the current cycle without making the decision for the user.

## Data rules

- Mobile and desktop use the same Supabase project and user data.
- A transaction created on mobile must immediately belong to the same ledger used by desktop.
- Mobile-specific UI preferences may be stored separately from general financial settings.
- Schema changes are only introduced when a mobile capability truly needs new persisted data.

## Styling rules

- Mobile layout styles live under `src/mobile`.
- Existing desktop CSS should not be globally overridden for mobile-only redesign work.
- Shared design tokens may be reused, but mobile sizing/layout classes should be scoped with `mf-mobile-*`.
- Respect safe-area insets and touch targets.

## Delivery safety

Mobile development happens on dedicated branches and Vercel previews before merge.

Before merging a mobile change:

1. Desktop smoke check at common desktop sizes.
2. Mobile checks at 320, 360, 390, 412 and 430 px.
3. Verify keyboard-open states, scroll, safe areas and installed-PWA mode.
4. Confirm no unrelated desktop files were modified unless the change is explicitly CORE.

## Implementation phases

### Phase 0 — Foundation

- architecture contract
- mobile route map
- mobile shell
- scoped styling
- shared mobile types

### Phase 1 — Daily use

- Home
- Quick Add
- Movimentações
- Cartões

### Phase 2 — Intelligent capture

- MF Scan
- review flow
- MF Inbox

### Phase 3 — Native/mobile integrations

- quick route
- installable PWA shortcuts
- share target where supported
- native wrapper/app-intent evaluation for deeper iOS/Android integrations

### Phase 4 — Decision intelligence

- Disponível de verdade
- Posso gastar?
- purchase impact
- smarter recurring recognition

## Non-goals

The mobile app is not intended to expose every desktop feature. A new desktop feature does not automatically become a mobile feature.

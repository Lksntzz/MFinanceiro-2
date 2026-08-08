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
- MF Inbox
- Disponível de verdade
- Posso gastar?

Future mobile-only capabilities may include MF Voice, recurring-document recognition, share-to-MF and deeper platform shortcuts/widgets.

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

The concurrent product-cleanup branch also changes `DashboardBootstrap.tsx`. Mobile work must avoid adding more changes to that file until integration, then reconcile the single mobile/desktop boundary deliberately after the product-cleanup branch is resolved.

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

MF Quick intentionally records payment method as `unspecified` unless the user explicitly supplied a payment method elsewhere. A fast capture must not invent that the transaction was Pix, cash or card.

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

MF Scan does not send generic bills, receipts or arbitrary photos to the statement OCR. Statement OCR has a specific financial-statement contract and is exposed through MF Inbox instead.

### MF Inbox

MF Inbox is the persistent human-review queue for bank-statement extraction on mobile.

It reuses the existing backend rather than introducing a parallel OCR system:

- private Storage bucket `mf-import-documents`
- per-user Storage RLS using the authenticated user folder
- `mf_document_extractions` for document state and metadata
- `mf_document_extraction_items` for extracted rows, field confidence and review state
- authenticated `statement-ocr` Edge Function for OCR/AI extraction
- existing `mf_commit_statement_import_v3` RPC for the final reviewed import

The mobile flow is:

1. choose the related financial account;
2. upload a PDF/JPEG/PNG/WebP bank statement, up to the existing 20 MB bucket limit;
3. store it privately under the authenticated user's folder;
4. create a `statement` extraction record;
5. invoke the existing `statement-ocr` function;
6. keep the extraction in `reviewing` state with every extracted line initially pending human review;
7. allow the user to correct date, description, amount, type and category or reject a line;
8. save review state without importing when desired;
9. import only explicitly confirmed, valid rows through `mf_commit_statement_import_v3`;
10. mark the extraction completed after the import succeeds.

An OCR category is only preselected when it matches a real compatible user category. Unknown or incompatible categories do not fall back to an arbitrary category: the row remains incomplete until the user chooses a valid category or rejects that row.

The final statement import uses the existing external-id/fingerprint duplicate protection. The mobile Inbox uses balance mode `keep`, so historical statement rows can be added without silently recalibrating the user's current account balance.

A failed OCR remains in the Inbox and can be retried. A document in `processing` remains read-only until the backend finishes. The UI never treats AI confidence as confirmation.

No new table, bucket, RLS policy or Edge Function is required for the current Inbox implementation.

### Disponível de verdade

The mobile Home uses the existing shared `calculateFinanceSummary` core calculation instead of duplicating financial math.

The card presents:

- current balance derived from active financial accounts
- projected free balance after registered commitments in the current cycle
- daily spending margin until the next expected income
- registered commitment amount
- next payday and days remaining
- the existing shared smart alert for the cycle

Mobile loads the same supporting inputs used by the desktop summary: fixed bills, cards, installments, user payment settings and recent cycle transactions.

### Posso gastar?

A mobile-only, read-only simulator driven by the same `FinanceSummary` result.

The user enters a possible purchase amount and the mobile UI shows:

- remaining free balance after that hypothetical purchase
- recalculated daily margin for the remaining cycle
- a low / caution / over-limit impact message

The simulator does not write to Supabase and does not tell the user to make or avoid a purchase. It only shows the calculated impact based on registered financial data.

## Data rules

- Mobile and desktop use the same Supabase project and user data.
- A transaction created on mobile immediately belongs to the same ledger used by desktop.
- MF Quick and confirmed MF Scan entries use the existing finance-entry RPC rather than a parallel transaction implementation.
- MF Inbox statement imports use the existing statement-import RPC and reconciliation/deduplication path.
- Mobile-specific UI preferences may be stored separately from general financial settings.
- Schema changes are only introduced when a mobile capability truly needs new persisted data.
- No schema change is required for the current Home / Quick / Scan / Inbox / decision-helper implementation.

## Styling rules

- Mobile layout styles live under `src/mobile`.
- Feature-specific styles may live next to the feature, such as `src/mobile/pages/mobile-scan.css` and `src/mobile/pages/mobile-inbox.css`.
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
7. Reconcile the shared `DashboardBootstrap.tsx` boundary with concurrent desktop/product-cleanup work before merge.

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
- statement OCR review/import

Status: MF Scan capture/parsing/review and persistent MF Inbox statement OCR/review/import are implemented. Generic receipt/bill OCR remains intentionally separate and future work.

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

Status: Disponível de verdade and the read-only Posso gastar? simulator are implemented using the shared finance summary. Purchase persistence/impact hooks and smarter recurrence remain future work.

## Non-goals

The mobile app is not intended to expose every desktop feature. A new desktop feature does not automatically become a mobile feature.

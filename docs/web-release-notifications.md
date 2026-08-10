# Web release notifications

Every user-facing web release must ship with one professional release notification in `src/lib/release-updates.ts`.

## Contract

- Add the notification in the same pull request as the web release.
- Use a unique, stable release ID so dismissal is scoped to that release only.
- Keep the visible message concise and focused on user benefit.
- Include no more than three user-facing highlights.
- Do not announce a release as available before the corresponding production deployment is confirmed.
- Dismissing a release notification hides that specific release; a future release must use a new ID.

## Current pending release

- ID: `2026-08-10-home-alerts-and-connections`
- Title: `Início completo e alertas que ajudam`
- Status: pending publication in PR #22.

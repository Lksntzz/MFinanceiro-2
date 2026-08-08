# MF Financeiro

Aplicação financeira em React/Vite com Supabase.

## Desenvolvimento

```bash
npm ci
npm run dev
```

Validação:

```bash
npm run lint
npm run build
```

## Arquitetura mobile

A experiência mobile está sendo desenvolvida de forma isolada em `src/mobile`, compartilhando o mesmo backend e as mesmas regras financeiras do desktop sem transformar todas as ferramentas desktop em telas mobile.

A documentação detalhada está em [`docs/mobile-architecture.md`](docs/mobile-architecture.md).

O escopo mobile inicial prioriza Home, Movimentações, MF Quick, Cartões, Mais e MF Scan. Recursos avançados do desktop continuam desktop-only até que exista uma razão clara para levá-los ao celular.

---

> Observação: o restante da documentação histórica do projeto foi resumido nesta versão para destacar a arquitetura atual e os comandos de desenvolvimento usados na validação da branch mobile.

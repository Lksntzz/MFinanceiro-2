# MF Financeiro — Limites de arquitetura

## Regra principal

Experiências financeiras permanentes devem viver na árvore React normal, com dados em hooks/serviços explícitos e navegação pelo router. Camadas globais que criam outro `createRoot`, inserem hosts manualmente no DOM ou ficam consultando `window.location` por intervalo são consideradas shims transitórios.

## Dashboard

`Dashboard.tsx` é uma shell de rotas e composição. Ele não deve voltar a concentrar:

- carregamento de todos os domínios;
- modais de ferramentas que já possuem rota;
- implementações de Planejamento/Agenda/Investimentos;
- APIs destrutivas em massa;
- lógica de score legado.

O estado financeiro compartilhado da shell fica em `useDashboardWorkspace`; apresentação da Início fica em `DashboardHome`.

## Orientação de produto da web

Próxima ação, estados vazios, progresso do Planejamento e feedback de operações são comportamento do produto e devem migrar para os componentes/hook responsáveis pelo respectivo domínio.

Ao integrar a frente do PR web que contém `web-product-orchestrator-mount.tsx`:

1. o módulo não pode continuar criando um segundo React root;
2. não pode inserir/remover hosts de UI diretamente com `document.createElement`/`appendChild`;
3. não pode descobrir navegação por polling periódico;
4. deve usar Router/React state e pontos de composição explícitos;
5. feedback de domínio deve nascer no fluxo que executa a operação ou no store/hook compartilhado, não por observação global como arquitetura final.

O `security:check` possui um guard condicional: se o antigo orquestrador estiver presente após integração de branches, o CI exige que o self-mount/DOM injection tenham sido removidos.

## Mount shims permitidos

Shims isolados podem existir temporariamente para compatibilidade externa (por exemplo launcher ou anúncio de release), desde que:

- não carreguem estado financeiro amplo;
- não reimplementem navegação interna;
- tenham escopo explícito e plano de retirada;
- não sejam a fonte autoritativa de regras de negócio.

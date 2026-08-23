# Visual Preview Audit — Central de Correções

Este workflow cria evidência visual sem tocar em produção e sem usar credenciais de usuário.

## O que já valida

- shell público de acesso em desktop 1440x900;
- shell público de acesso em mobile 390x844;
- entrada administrativa `/admin-login` sem iniciar OAuth;
- ausência de overflow horizontal nos viewports testados;
- presença dos elementos essenciais do formulário;
- screenshots anexadas como artifact do GitHub Actions por 14 dias.

## Como executar manualmente

1. Abra o Preview Vercel correspondente ao commit/PR que deseja revisar.
2. No GitHub Actions, execute `Visual Preview Audit`.
3. Informe a URL HTTPS exata do Preview no campo `base_url`.
4. Aguarde os testes Playwright.
5. Abra o artifact `visual-preview-<sha>` para comparar as capturas.

Nenhuma senha ou conta de QA é necessária para esta primeira camada visual.

## O que ainda NÃO faz

Esta etapa captura e valida estrutura/layout básico, mas ainda não aprova regressões pixel a pixel automaticamente. O gate de screenshot baseline deve entrar somente depois que um conjunto de imagens de referência for revisado e aprovado. A futura comparação deve usar `toHaveScreenshot()` com tolerância explicitamente definida, nunca regenerar baseline automaticamente em Pull Request.

## Próxima evolução

Quando a integração GitHub/Vercel da Central estiver ativa, o MF Administração poderá:

1. obter a URL do Preview do SHA do incidente/correção;
2. disparar ou orientar a auditoria visual;
3. mostrar o resultado do workflow no incidente;
4. exibir a captura aprovada e a captura candidata;
5. bloquear promoção quando houver falha visual relevante.

O workflow não recebe dados financeiros e não deve navegar para dados reais autenticados. Fluxos autenticados continuam usando conta QA sintética em workflow separado.

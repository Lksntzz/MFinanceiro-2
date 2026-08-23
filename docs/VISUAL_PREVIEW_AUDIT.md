# Visual UI Audit — Central de Correções

Este workflow cria evidência visual do commit exato sem tocar em produção e sem usar credenciais de usuário ou autenticação do Vercel.

## Como funciona agora

Em toda Pull Request, o GitHub Actions:

1. faz checkout do commit exato da PR;
2. executa `npm ci` e `npm run build`;
3. inicia um `vite preview` isolado em `127.0.0.1:4173` dentro do próprio runner;
4. instala Playwright/Chromium em versão fixada;
5. executa os testes visuais/estruturais;
6. salva screenshots como artifact por 14 dias.

O alvo local evita depender de Vercel SSO/Protection e evita colocar URL temporária ou parâmetro de autenticação em inputs do workflow. O Vercel Preview real continua existindo como evidência separada de build/deploy.

## O que já valida

- shell público de acesso em desktop 1440x900;
- shell público de acesso em mobile 390x844;
- entrada administrativa `/admin-login` sem iniciar OAuth;
- ausência de overflow horizontal nos viewports testados;
- presença dos elementos essenciais do formulário;
- screenshots anexadas como artifact do GitHub Actions por 14 dias.

Nenhuma senha ou conta de QA é necessária para esta primeira camada visual.

## Execução

O workflow `Visual UI Audit` roda automaticamente em Pull Requests e também pode ser disparado manualmente. Não é necessário informar URL.

Para revisar as capturas:

1. abra a execução `Visual UI Audit` correspondente ao SHA;
2. confirme que o job `public-shell` terminou com sucesso;
3. abra o artifact `visual-ui-<sha>`;
4. compare as imagens de desktop, mobile e entrada administrativa.

## Separação entre evidências

- `Visual UI Audit`: valida o bundle do commit em ambiente local isolado e reproduzível.
- `Vercel Preview`: prova que o mesmo commit foi construído/publicado pela infraestrutura Vercel.
- `Critical E2E Smoke`: valida fluxos autenticados contra Preview usando exclusivamente conta QA sintética e secrets próprios.

Nenhuma dessas camadas deve navegar por dados financeiros reais.

## O que ainda NÃO faz

Esta etapa captura e valida estrutura/layout básico, mas ainda não aprova regressões pixel a pixel automaticamente. O gate de screenshot baseline deve entrar somente depois que um conjunto de imagens de referência for revisado e aprovado.

A futura comparação deve usar `toHaveScreenshot()` com tolerância explicitamente definida. Baselines nunca devem ser regenerados automaticamente em Pull Request, pois isso transformaria uma regressão visual em novo padrão sem revisão.

## Próxima evolução

Quando a integração GitHub/Vercel da Central estiver ativa, o MF Administração poderá:

1. correlacionar o SHA do incidente/correção;
2. mostrar o status do `Visual UI Audit` e do Vercel Preview desse SHA;
3. disponibilizar a evidência visual no incidente;
4. comparar baseline aprovado com captura candidata;
5. bloquear promoção quando houver falha visual relevante.

Fluxos autenticados continuam em workflow separado com conta QA sintética. Produção não é usada como ambiente de teste mutável.

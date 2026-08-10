# Auditoria de produto e experiência web — MF Financeiro

Data de referência: 9 de agosto de 2026
Escopo: experiência web/desktop (`min-width: 821px`)
Fora do escopo: experiência própria em `src/mobile`, schema, migrations e exclusão de dados.

## Princípio do produto

O MF Financeiro deve parecer uma única inteligência financeira com diferentes perspectivas sobre o mesmo dinheiro — não um conjunto de ferramentas independentes.

A arquitetura conceitual permanece:

- **Início** — como estou agora.
- **Movimentações** — o que aconteceu.
- **Agenda Financeira** — o que vai acontecer.
- **Planejamento** — o que quero que aconteça.
- **Investimentos** — o patrimônio que estou construindo.
- **Insights** — o que meus números estão dizendo.
- **Conexões** — de onde meus dados chegam.

## Diagnóstico geral

A arquitetura funcional está madura. O principal problema da web não é falta de funcionalidades, e sim diferenças de linguagem visual e pequenas quebras de continuidade entre áreas criadas em momentos distintos.

Foram identificados três sistemas visuais coexistindo:

1. Dashboard e ferramentas históricas.
2. Ferramentas roteadas mais novas.
3. Componentes internos com estilos próprios.

A correção adotada é sistêmica: hierarquia, superfícies, formulários, ações, feedback, espaçamento e densidade passam a obedecer a uma mesma camada visual web.

## Auditoria por dimensão

### 1. Hierarquia e densidade

**Problema:** títulos, cards e blocos internos possuíam pesos e espaçamentos diferentes; em algumas telas isso fazia elementos relacionados parecerem colados e, em outras, o volume de caixas competia pela atenção.

**Diretriz aplicada:**
- título de página explica a função da tela;
- texto auxiliar fica abaixo, com largura de leitura controlada;
- cards usam uma única família visual;
- grids e seções usam ritmo vertical consistente;
- componentes de apoio ficam visualmente abaixo das informações prioritárias.

### 2. Início como centro de comando

**Diagnóstico:** o Dashboard já possui os elementos necessários — saldo, limite, ciclo, gasto, alerta, insight, evolução, categorias, últimos lançamentos e cartões. Não é necessário adicionar outro painel.

**Diretriz aplicada:** alertas de situação e leitura financeira recebem maior prioridade visual; gráficos e cards históricos ficam mais silenciosos. A tela deve responder primeiro “como estou?” e “o que merece atenção?”.

### 3. Continuidade entre ferramentas

**Problema encontrado:** a Agenda completa já interpretava contas fixas, assinaturas, faturas, parcelas e renda prevista, mas o calendário exibido dentro de Planejamento → Visão do Mês recebia apenas parte desse contexto.

**Correção aplicada:** o calendário agora completa automaticamente o contexto financeiro quando incorporado pelo Planejamento. Assinaturas, faturas e parcelas passam a acompanhar a mesma visão temporal, preservando a proteção contra dupla contagem de parcelas já incluídas em faturas.

### 4. Planejamento como jornada

**Diagnóstico:** Visão do Mês, Contas financeiras, Categorias, Cartões e parcelas, Orçamento, Metas e Simulador possuem funções distintas e corretas. O problema era principalmente visual e de continuidade, não de arquitetura.

**Diretriz aplicada:**
- Visão do Mês funciona como síntese;
- configurações permanecem nas suas áreas próprias;
- Agenda integrada mostra o impacto temporal;
- Simulador continua temporário e não altera lançamentos;
- não são adicionadas novas ferramentas ou duplicações.

### 5. Insights

**Diagnóstico:** a área já opera como interpretação, e não apenas como coleção de gráficos: possui narrativa, alertas, próxima ação, confiança e cenários de 30/60/90 dias.

**Decisão:** preservar a arquitetura atual e evitar acrescentar gráficos sem uma pergunta financeira clara. O padrão é conclusão primeiro; visualização serve de evidência.

### 6. Contas e categorias

**Diagnóstico:** a separação conceitual está correta e a própria cópia já evita confundir conta, categoria, cartão e investimento.

**Diretriz aplicada:** padronizar padding, formulário, card, título, labels e feedback visual. Não voltar categorias para Contas financeiras.

### 7. Agenda

**Diagnóstico:** a função está clara: reunir tudo que possui data e pode alterar o dinheiro. Recorrências e receitas previstas estão corretamente subordinadas a essa função.

**Diretriz aplicada:** reforçar legibilidade do calendário e manter a proteção contra dupla contagem de parcelas vinculadas a cartão.

### 8. Investimentos

**Diagnóstico:** deve permanecer um workspace de patrimônio investido. A remoção visual do score fundamentalista antigo continua correta.

**Decisão:** não misturar investimento com saldo operacional nem reintroduzir análises/veredictos que competem com a carteira e o planejamento de aportes.

### 9. Conexões

**Diagnóstico:** conceito e conteúdo atuais estão adequados.

**Decisão:** preservar a função e aplicar apenas a linguagem visual comum da web. Nenhuma reorganização conceitual adicional nesta rodada.

### 10. Ações principais

**Padrão:** “Lançar” é a entrada universal para uma movimentação. O sidebar é a ação global; telas dedicadas não devem criar versões concorrentes da mesma ação.

Ações contextuais como “Adicionar conta”, “Criar categoria”, “Salvar orçamento” e “Montar cenário” permanecem locais e seguem a mesma hierarquia visual.

### 11. Estados vazios e feedback

**Padrão definido:** um estado sem dados deve explicar o que falta e, quando houver ação útil, indicar o próximo passo. Erros, carregamento e sucesso devem parecer estados do produto, não mensagens técnicas.

A camada web padroniza superfícies de erro, loading, formulários e ações. Telas que já possuem cópia contextual mantêm essa orientação.

### 12. Identidade visual

O vocabulário visual da web passa a ser:
- ciano como ação/estado de marca, não decoração indiscriminada;
- verde para entrada/condição positiva;
- vermelho para saída/risco;
- violeta para informação contextual/inteligência quando necessário;
- superfícies escuras com bordas e elevação discretas;
- tipografia e números com hierarquia mais forte que a decoração.

## Sistema visual aplicado

A camada desktop em `src/stage6.css` padroniza, sob `@media (min-width: 821px)`:

- cabeçalho;
- sidebar;
- largura e scroll do conteúdo;
- títulos e descrições de página;
- cards e glass cards;
- grids e espaçamentos;
- KPIs;
- inputs, selects e textareas;
- botões primários;
- erros e carregamento;
- alertas da Home;
- contraste do calendário;
- modais.

Isso evita correções isoladas por tela e reduz regressões de spacing no futuro.

## O que foi preservado deliberadamente

- dados e schema existentes;
- experiência mobile própria;
- conteúdo/conceito de Conexões;
- arquitetura atual de Insights;
- separação entre contas, cartões e investimentos;
- Simulador sem persistência;
- proteção contra dupla contagem em Agenda;
- navegação conceitual principal.

## Regra para novas funcionalidades web

Antes de criar uma nova ferramenta, responder:

1. A necessidade já pertence a uma área existente?
2. O dado pode ser exibido em uma perspectiva existente em vez de ganhar uma página própria?
3. A nova interface reduz trabalho do usuário ou apenas expõe mais configuração?
4. A informação aparece também onde causa impacto (Início, Agenda, Planejamento ou Insights)?

A preferência é integrar capacidades existentes antes de aumentar o número de ferramentas.

## Comunicação de release

Toda correção, configuração ou atualização web autorizada para envio deve incluir, no mesmo pacote, uma notificação profissional ao usuário com:

- o que mudou;
- qual benefício isso traz;
- no máximo alguns pontos objetivos;
- nenhum detalhe técnico.

Previews e testes não representam autorização para publicação.

## Checklist de QA antes de merge/publicação

- [ ] Build e TypeScript/CI sem erro.
- [ ] Preview Vercel corresponde exatamente ao head do PR.
- [ ] Nenhum arquivo em `src/mobile` foi alterado pela auditoria web.
- [ ] Home revisada em notebook e desktop amplo.
- [ ] Movimentações e importação revisadas.
- [ ] Investimentos revisados.
- [ ] Planejamento: Visão do Mês, Contas, Categorias, Cartões, Orçamento, Metas e Simulador revisados.
- [ ] Insights revisado com dados reais.
- [ ] Agenda: Calendário, Recorrências e Receitas previstas revisados.
- [ ] Conexões revisadas sem mudança conceitual.
- [ ] Perfil, sino, privacidade e navegação revisados.
- [ ] Estados vazios, loading, erro e sucesso revisados.
- [ ] Notificação de atualização revisada na web e ausente no mobile.
- [ ] Nenhuma promoção para produção sem autorização explícita.

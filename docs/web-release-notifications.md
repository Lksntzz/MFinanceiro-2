# Regra de notificações de atualização — Web

Esta regra vale apenas para a experiência web/desktop do MF Financeiro.

## Quando publicar uma notificação

Toda configuração, correção ou atualização da web que for autorizada para envio ao usuário deve incluir, no mesmo pacote de release, a atualização do comunicado exibido pelo MF Financeiro.

Previews, testes, branches de desenvolvimento e alterações ainda não autorizadas para envio não devem gerar uma nova notificação para o usuário.

## Padrão de comunicação

A notificação deve ser curta, profissional e orientada ao benefício do usuário.

Ela deve responder apenas a duas perguntas:

1. O que foi melhorado ou corrigido?
2. Como isso melhora a experiência do usuário?

Evitar detalhes técnicos, nomes de arquivos, commits, banco de dados, bibliotecas, infraestrutura ou linguagem interna de desenvolvimento.

## Formato recomendado

- título curto e claro;
- resumo de uma ou duas frases;
- até três melhorias principais;
- linguagem simples e objetiva;
- identificador de release único para que cada nova atualização seja apresentada uma vez por usuário.

## Implementação atual

O comunicado web é controlado por `src/lib/mega-update-announcement-mount.tsx`, no objeto `WEB_UPDATE`.

Ao preparar uma release web autorizada, atualizar `id`, `title`, `dateLabel`, `summary` e `highlights` no mesmo conjunto de mudanças da correção ou atualização.

O componente é restrito a telas web com largura mínima de 821 px e não deve ser usado para a experiência mobile enquanto esta regra permanecer exclusiva da web.

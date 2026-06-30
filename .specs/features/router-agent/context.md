# Router Agent Context

Este documento registra o contexto e as decisões já discutidas para a arquitetura baseada em agente Router dedicado.

## Decisões

### Decisão: substituir hard-block por agente Router dedicado

Substituir hard-block via hooks por permissões nativas do agente Router. O Router deve ter ferramentas nativas bloqueadas e apenas `task` permitido.

### Decisão: routing via LLM do Router, não via classifier/selector

A decisão de tier deixa de ser implementada por `classifier.ts` e `selector.ts`. O LLM do Router decide para qual subagente delegar com base no sistema prompt configurado em `routerPrompt`.

### Decisão: prompt do Router em `tiers.json` para customização do usuário

O prompt do Router deve vir de `routerPrompt` em `tiers.json`. Se ausente, o plugin deve aplicar um prompt padrão.

### Decisão: remover `taskPatterns`

`taskPatterns` deixa de ser a fonte de decisão. O campo pode ser ignorado durante a validação para compatibilidade, mas não deve influenciar o roteamento.

### Decisão: plugin vira apenas config hook

O plugin deve se concentrar em carregar e validar `tiers.json` e criar agentes no hook `config`. Não há observação de sessão, enforcement prompt-based, redirect de ferramentas ou prompts dinâmicos.

### Decisão: bloqueio é nativo via permission do agente, não via hooks

O bloqueio de ferramentas deve ser representado pela configuração do agente Router: `task: allow` e demais ferramentas `deny`.

### Decisão: outros agentes do usuário não são afetados

A arquitetura do plugin deve criar/gerenciar apenas o Router e subagentes necessários. Agentes ou políticas de outros plugins/projetos não devem ser alterados.

## Observações

- A mudança é grande porque remove uma camada de runtime hook-based e passa a depender do comportamento do runtime ao criar agentes com permissões.
- A validação de `tiers.json` continua necessária, mas deixa de validar enforcement/routing.
- O prompt padrão do Router deve ser preservado em `design.md` para uso durante implementação e testes.

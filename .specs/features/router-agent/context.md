# Router Agent Context

Este documento registra o contexto e as decisões já discutidas para a arquitetura baseada em agente Router dedicado.

## Decisões

### Decisão: substituir hard-block por agente Router dedicado

Substituir hard-block via hooks por permissões nativas do agente Router. O Router deve ter ferramentas nativas bloqueadas e apenas `task` permitido.

### Decisão: routing via LLM do Router, não via classifier/selector

A decisão de tier deixa de ser implementada por `classifier.ts` e `selector.ts`. O LLM do Router decide para qual subagente delegar com base no sistema prompt configurado em `routerPrompt`.

### Decisão: prompt do Router em `tiers.json` para customização do usuário

O prompt do Router deve vir de `routerPrompt` em `tiers.json`. Se ausente, o plugin deve aplicar um prompt padrão.

### Decisão: subagentes passam a ter `systemPrompt` próprio

Subagentes @fast, @medium e @heavy devem receber `systemPrompt` próprio já na criação pelo plugin, em vez de depender de hooks para injetar prompts em sessões de subagentes.

### Decisão: systemPrompt do subagente contém identidade do tier + regras fixas

O `systemPrompt` de cada subagente deve definir a identidade do tier e regras fixas, incluindo não delegar para sub-sub-agentes e não perguntar ao usuário a menos que esteja bloqueado.

### Decisão: Router inclui instrução e contexto no prompt da task

Ao chamar `task()`, o Router deve incluir `[INSTRUÇÃO DO USUÁRIO]` e `[CONTEXTO ADICIONAL]` no prompt enviado ao subagente.

### Decisão: plugin não precisa mais do hook `experimental.chat.system.transform`

Como o `systemPrompt` já está configurado diretamente no agente subagente, o plugin não precisa mais usar `experimental.chat.system.transform` para injetar prompts.

### Decisão: system prompts dos subagentes são configuráveis via `tiers.json` com fallback para padrão

Os campos opcionais `fast.systemPrompt`, `medium.systemPrompt` e `heavy.systemPrompt` permitem customizar prompts dos subagentes. Se ausentes, o plugin deve usar prompts padrão embutidos.

### Decisão: elimina-se a race condition de `system.transform` vs `chat.message`

A criação do `systemPrompt` no agente evita depender da ordem de execução entre `experimental.chat.system.transform` e `chat.message` para garantir que subagentes recebam suas diretrizes.

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

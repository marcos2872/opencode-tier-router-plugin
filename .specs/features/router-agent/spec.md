# Router Agent Specification

## Problem Statement

O plugin atual depende de hooks para detectar intenção, aplicar hard-block e redirecionar ferramentas para forçar delegação. Essa arquitetura mistura observação, decisão e aplicação no runtime principal, gerando acoplamento alto com o fluxo de sessão do host e dependência de prompts injetados em cada hook.

A mudança proposta substitui esse modelo por um agente Router dedicado: o plugin só configura agentes no hook `config`, o Router recebe permissões bloqueadas para ferramentas nativas e delega tudo para subagentes `@fast`, `@medium` e `@heavy`.

## Goals

- [ ] Converter o plugin de um mecanismo de hooks/routing em um agente primário Router dedicado.
- [ ] Centralizar regras de delegação no `routerPrompt` configurável por usuário.
- [ ] Remover classificação local, enforcement prompt-based e redirecionamento de ferramentas.
- [ ] Manter `tiers.json` como fonte única de configuração para tiers, modes, custos, nome e modelo do Router.
- [ ] Garantir que subagentes continuem com ferramentas liberadas e modo `subagent`.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Novo modelo de roteamento via LLM separado do Router | O Router é o agente que decide; não há selector/LLM auxiliar. |
| Persistência de estado de sessão | O plugin não mantém estado; a decisão ocorre pelo sistema/permissoes do agente. |
| Logs, tracing ou status de routing | Sem hooks de observação de sessão; logs de router não fazem parte da MVP. |
| Comandos de ativação/desativação do router | O agente e suas permissões são configurados no `config`; outros agentes do usuário não são afetados. |
| Alteração de subagentes existentes além da criação garantida | @fast, @medium e @heavy continuam como agentes subagentes com ferramentas `allow`. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| O bloqueio deixa de ser implementado por hooks e passa a ser nativo da permissão do agente Router | Apenas `task` permitido no Router | Runtime/OpenCode deve aplicar permissões de agente sem interceptação de ferramenta. | Yes |
| Se `routerPrompt` ausente, o plugin deve usar prompt padrão | Prompt padrão descrito em `design.md` | Garante comportamento válido e delegação sem exigir config inicial. | Yes |
| Se `agentName` ou `agentModel` ausentes, o plugin deve usar defaults | `router` e `opencode/big-pickle` | Mantém compatibilidade com configs mínimas e evita falha silenciosa. | Yes |
| `taskPatterns` é ignorado se presente | Campo opcional removido da semântica do plugin | A decisão de tier passa a ser LLM-driven pelo Router. | Yes |
| A validação de `tiers.json` deve ser mínima e orientada ao Router | `tiers` e `modes` obrigatórios; `defaultTier` válido | A config continua necessária para tiers, modes e custos, mas não para classifier. | Yes |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Plugin configura Router dedicado com permissões bloqueadas ⭐ MVP

**User Story**: Como usuário que quer delegar qualquer tarefa ao agente mais adequado, eu quero que o plugin crie um agente Router bloqueado para ferramentas nativas, para que ele só possa chamar ferramentas de task/delegação.

**Why P1**: Essa é a mudança arquitetural central: substituir hard-block por permissão nativa do agente Router.

**Acceptance Criteria**:

1. WHEN `tiers.json` é válido THEN o plugin SHALL criar um agente Router com `name = agentName`, `model = agentModel`, `permissions` com `task: allow` e demais ferramentas bloqueadas.
2. WHEN `agentName` é omitido THEN o plugin SHALL usar `router` como nome do agente Router.
3. WHEN `agentModel` é omitido THEN o plugin SHALL usar `opencode/big-pickle` como modelo do agente Router.
4. WHEN `routerPrompt` é omitido THEN o plugin SHALL usar o prompt padrão do Router.
5. WHEN `routerPrompt` é fornecido THEN o plugin SHALL usar exatamente esse texto como system prompt do agente Router.

**Independent Test**: Inspecionar o resultado do hook `config` e confirmar que apenas `config` é registrado e que o Router tem ferramentas bloqueadas.

---

### P2: Plugin cria subagentes de execução ⭐ MVP

**User Story**: Como usuário que precisa executar tarefas em tiers dedicados, eu quero que @fast, @medium e @heavy sejam criados como subagentes com ferramentas liberadas, para que o Router possa delegar a eles.

**Why P2**: O Router não executa ferramentas; a execução continua nos subagentes.

**Acceptance Criteria**:

1. WHEN `tiers.json` contém tiers válidos THEN o plugin SHALL criar subagentes `@fast`, `@medium` e `@heavy`.
2. WHEN subagentes são criados THEN cada subagente SHALL ter `permissions: allow` e `mode: subagent`.
3. WHEN o Router chama `task()` para delegar THEN o subagente correspondente SHALL executar a tarefa usando suas ferramentas permitidas.

**Independent Test**: Validar que o hook `config` retorna o Router bloqueado e os três subagentes com permissões allow/mode subagent.

---

### P3: Plugin simplificado e sem mecanismos de routing antigos ⭐ MVP

**User Story**: Como mantenedor do plugin, eu quero que o plugin tenha somente o hook `config` e validação de config, para reduzir acoplamento e remover hooks de hard-block/routing.

**Why P3**: A arquitetura antiga depende de observação e interceptação de sessão; a nova arquitetura deve ser determinística por configuração de agentes.

**Acceptance Criteria**:

1. WHEN o plugin é inicializado THEN somente o hook `config` SHALL ser registrado.
2. WHEN o plugin é inicializado THEN hooks antigos `chat.message`, `experimental.chat.system.transform`, `permission.ask`, `event`, `tool.execute.before`, `tool.definition`, `tool.execute.after`, `experimental.text.complete` e `command.execute.before` SHALL NÃO ser registrados.
3. WHEN módulos antigos de routing existem no código-fonte THEN eles SHALL ser removidos ou substituídos por validação mínima de config.
4. WHEN `taskPatterns` está presente em `tiers.json` THEN o plugin SHALL ignorá-lo.
5. WHEN `enforcement` ou `routing` aparecem em `tiers.json` sem valor semântico para o novo modelo THEN o plugin SHALL ignorá-los ou aceitar como propriedades não utilizadas.

**Independent Test**: Testar que a estrutura de hooks retornada não inclui nenhum hook além de `config`.

---

### P4: Usuário customiza o Router por config ⭐ MVP

**User Story**: Como usuário do plugin, eu quero editar `routerPrompt`, `agentName` e `agentModel` em `tiers.json`, para personalizar o Router sem alterar código.

**Why P4**: O objetivo é tornar a decisão de delegação configurável e visível.

**Acceptance Criteria**:

1. WHEN usuário edita `routerPrompt` em `tiers.json` e reinicia o OpenCode THEN o Router SHALL usar o prompt atualizado.
2. WHEN usuário edita `agentName` em `tiers.json` e reinicia o OpenCode THEN o agente Router SHALL usar esse nome.
3. WHEN usuário edita `agentModel` em `tiers.json` e reinicia o OpenCode THEN o agente Router SHALL usar esse modelo.
4. WHEN `tiers.json` não contém `routerPrompt` THEN o prompt padrão SHALL ser aplicado.

**Independent Test**: Comparar o system prompt retornado no agente Router com o valor atual de `routerPrompt`.

---

## Edge Cases

- WHEN `tiers.json` está ausente ou inválido THEN o plugin SHALL lançar erro de validação e NÃO criar agentes.
- WHEN `tiers.json` não contém `tiers` THEN a validação SHALL retornar erro.
- WHEN `tiers.json` não contém `modes` THEN a validação SHALL retornar erro.
- WHEN `modes` não contém `defaultTier` válido para o `mode` ativo THEN a validação SHALL retornar erro.
- WHEN `agentName` ou `agentModel` são strings vazias THEN a validação SHALL retornar erro.
- WHEN `routerPrompt` não é string THEN a validação SHALL retornar erro.
- WHEN `taskPatterns` é fornecido mas `tiers` e `modes` são válidos THEN a config SHALL ser aceita e `taskPatterns` SHALL ser ignorado.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| RF-001 | Plugin configura Router dedicado com permissões bloqueadas | Design/Implementation/Verification | Pending |
| RF-002 | System prompt do Router vem de `routerPrompt` | Design/Implementation/Verification | Pending |
| RF-003 | Subagentes @fast/@medium/@heavy continuam criados com ferramentas allow | Design/Implementation/Verification | Pending |
| RF-004 | Remover hooks antigos | Design/Implementation/Verification | Pending |
| RF-005 | Remover módulos antigos de routing | Design/Implementation/Verification | Pending |
| RF-006 | Remover `taskPatterns` da semântica do plugin | Design/Implementation/Verification | Pending |
| RF-007 | Adicionar `routerPrompt` ao `tiers.json` | Design/Implementation/Verification | Pending |
| RF-008 | Adicionar `agentName` ao `tiers.json` | Design/Implementation/Verification | Pending |
| RF-009 | Adicionar `agentModel` ao `tiers.json` | Design/Implementation/Verification | Pending |
| RF-010 | Plugin vira apenas config hook + validação | Design/Implementation/Verification | Pending |
| RF-011 | Remover módulos auxiliares não necessários | Design/Implementation/Verification | Pending |
| RF-012 | Atualizar AGENTS.md e ENFORCEMENT.md | Documentation | Pending |
| RF-013 | `src/index.ts` simplificado | Implementation/Verification | Pending |
| RF-014 | Remover ou drasticamente simplificar `src/plugin-orchestrator.ts` | Implementation/Verification | Pending |
| RF-015 | Testes atualizados para nova arquitetura | Verification | Pending |

**Coverage:** 15 total, 15 mapped to implementation/design/test work, 0 unmapped ⚠

---

## Acceptance Criteria Summary

1. AC-001: Dado `tiers.json` válido, plugin cria agente Router com `name = agentName`, `model = agentModel`, `permissions` com `task: allow` e demais ferramentas bloqueadas.
2. AC-002: Dado `tiers.json` com `routerPrompt`, o system prompt do Router contém esse texto.
3. AC-003: Dado `tiers.json` sem `routerPrompt`, um prompt padrão é usado.
4. AC-004: Subagentes @fast/@medium/@heavy são criados com `permissions: allow` e `mode: subagent`.
5. AC-005: Nenhum hook além de `config` é registrado.
6. AC-006: `tiers.json` sem `taskPatterns` é válido e o campo é opcional/ignorado.
7. AC-007: Um `tiers.json` inválido sem `tiers` ou sem `modes` retorna erro de validação.
8. AC-008: Router não tem acesso a `read`, `grep`, `bash`, `edit`, `write`.
9. AC-009: Router pode chamar `task()` para delegar a subagentes.
10. AC-010: Usuário pode editar `routerPrompt` no `tiers.json` e reiniciar para aplicar.

## Success Criteria

- [ ] O plugin é configurado apenas no hook `config`.
- [ ] O Router possui permissões nativas bloqueadas para ferramentas de execução.
- [ ] O Router delega para @fast, @medium e @heavy por meio de `task()`.
- [ ] A decisão de tier deixa de depender de `taskPatterns`, classifier, selector ou enforcement.
- [ ] `routerPrompt`, `agentName` e `agentModel` são configuráveis via `tiers.json`.
- [ ] Subagentes continuam disponíveis e com ferramentas liberadas.
- [ ] Testes cobrem a criação do Router, subagentes, hooks registrados e validação de config.

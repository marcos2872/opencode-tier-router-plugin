# Context — Wiki Alignment Validation

## Validação cruzada: spec.md × WIKI.md

Em 2026-06-28, validação contra WIKI.md revelou lacunas no spec original. Decisões registradas abaixo.

## Decisões

### VD-001: Carregamento via `.opencode/opencode.json` mantido
- **Decisão**: Manter carregamento via path direto em `.opencode/opencode.json` (`dist/index.js`), não migrar para `.opencode/plugins/`
- **Motivo**: Projeto em desenvolvimento ativo; path direto acelera ciclo de teste. Ajuste de carregamento será feito quando o plugin estiver estável para publicação.

### VD-002: API HTTP do servidor é N/A
- **Decisão**: Marcar feature como fora-de-escopo
- **Motivo**: Plugin não expõe endpoints HTTP, não usa `opencode serve`, não implementa autenticação ou OpenAPI.

### VD-003: Zod é opcional
- **Decisão**: Não exigir Zod no spec
- **Motivo**: Custom tools atuais são simples (`router_status`). Se crescerem em complexidade, Zod será adicionado.

### VD-004: Primary agent profiles não customizados
- **Decisão**: Plugin customiza apenas subagentes e agent mappings, não o agente primário
- **Motivo**: O plugin é um router — ele delega para @fast/@medium/@heavy, não substitui o perfil do agente principal.

### VD-005: `tool.execute.before` contrato detalhado
- **Decisão**: Adicionar denied tool set como constante em `src/constants.ts`, subagent exemption, sensitive-file protection semantics
- **Motivo**: WIKI.md exige proteção de arquivos como caso de uso explícito; sem contrato detalhado o hook fica genérico.

### VD-006: `shell.env` contrato detalhado
- **Decisão**: Payload/output tipados; injeção apenas em shells de subagentes
- **Motivo**: WIKI.md especifica hook `shell.env` para injeção de ambiente; sem tipagem o comportamento é implícito.

### VD-007: `experimental.session.compacting` contrato detalhado
- **Decisão**: Preservar `preferredTier`, `selectionSource`, `hardBlockedTier`, `hardBlockReason` em `output.context.router`
- **Motivo**: Sem preservação, routing state é perdido após compactação, causando inconsistência.

### VD-008: Logging hierarchy (client.app.log > FileLogger > zero console.warn)
- **Decisão**: `client.app.log()` primário, `FileLogger` para debug, zero `console.warn`
- **Motivo**: WIKI.md especifica logging estruturado via `client.app.log()`; console.warn é para dev, não para runtime.

### VD-009: Notificações para hard-block
- **Decisão**: Usar `client.tui.showToast()` quando hard-block rejeita tool call
- **Motivo**: WIKI.md lista notificações como feature; feedback visual para o usuário é fundamental.

### VD-010: Matriz de permissões
- **Decisão**: Documentar e enforcement via `src/router/permissions.ts`
- **Motivo**: WIKI.md espera controle allow/ask/deny explícito; lógica atual está espalhada em `PluginOrchestrator`.

### VD-011: SDK OpenCode é N/A
- **Decisão**: Plugin usa apenas runtime hooks, não instancia `createOpencode()` / `createOpencodeClient()`
- **Motivo**: Feature não se aplica. Documentar explicitamente para evitar gaps em validações futuras.

### VD-012: Skills de agentes é N/A
- **Decisão**: Plugin não define agent skills via `SKILL.md`; skill `tlc-spec-driven` é carregada por nome
- **Motivo**: Feature não se aplica. Documentar explicitamente.

## Requirements adicionados

| ALIGN | Descrição | Prio |
|-------|-----------|------|
| ALIGN-24 | `tool.execute.before` contrato detalhado | P1 |
| ALIGN-25 | `shell.env` contrato detalhado | P2 |
| ALIGN-26 | `experimental.session.compacting` contrato detalhado | P2 |
| ALIGN-27 | Logging hierarchy (client.app.log + FileLogger) | P1 |
| ALIGN-28 | Notificações para hard-block | P1 |
| ALIGN-29 | Matriz de permissões | P1 |
| ALIGN-30 | `.opencode/tools/` standalone tool | P4 |
| ALIGN-31 | SDK OpenCode N/A | P4 |
| ALIGN-32 | Skills de agentes N/A | P4 |

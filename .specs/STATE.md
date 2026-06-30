# STATE.md — opencode-tier-router-plugin

## Active Decisions

### AD-015: Router-Agent Architecture
**Status:** Active
**Context:** A arquitetura hook-based anterior dependia de `chat.system.transform`, `tool.execute.before` e outros ganchos para classificar, redirecionar, bloquear e injetar comportamento em sessões.
**Decision:** O plugin router-agent substitui a arquitetura hook-based por um agente Router dedicado configurado em `tiers.json`; a execução e a política de ferramentas ficam nos subagents @fast, @medium e @heavy.

### AD-016: Subagent System Prompts
**Status:** Active
**Context:** Cada tier precisa de identidade, permissões e regras fixas próprias, sem repetir esse conteúdo no prompt da task.
**Decision:** Os subagents recebem `systemPrompt` configurável em `tiers.json` — `fast.systemPrompt`, `medium.systemPrompt` e `heavy.systemPrompt` — com fallback para prompts padrão embutidos no plugin.

## Handoff — router-agent
**Status:** Implementation complete
**Last updated:** 2026-06-30

Router-agent foi implementado e os specs antigos da arquitetura hook-based foram removidos. O estado atual deve considerar apenas a arquitetura router-agent e as decisões AD-015/AD-016.

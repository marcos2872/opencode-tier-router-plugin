# Fix Subagent Model Routing from tiers.json

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure subagents spawned via the Actor tool respect the model defined in tiers.json instead of inheriting the parent's model.

**Architecture:** The Actor tool has a `model` parameter that overrides the agent's configured model. Instead of injecting models into markdown frontmatter, the compose orchestrator reads tiers.json and passes the appropriate model when spawning each subagent. This keeps one `general` agent but allows dynamic model selection based on task complexity.

**Tech Stack:** TypeScript, Node.js, OpenCode Plugin API

## Global Constraints

- Plugin must work with `@opencode-ai/plugin` >= 1.0.0
- tiers.json is the source of truth for model selection
- Only two agents: `explore` (read-only) and `general` (read/write)
- No new agent definitions — reuse existing agents with model override

---

## Root Cause Analysis

The Actor tool description: *"defaults to the agent's model, else the parent's"*. The plugin sets `input.agent.general.model` and `input.agent.explore.model` programmatically, but the framework reads from markdown frontmatter. Since the markdown files lack a `model` field, the framework falls back to the parent's model.

**Solution:** Use the Actor tool's `model` parameter to override per invocation. The compose reads tiers.json and passes the model when spawning.

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `src/config.ts` | Modify | Export `loadTiers()` function for compose to read |
| `agents/explore.md` | Keep | No changes needed |
| `agents/general.md` | Keep | No changes needed |

---

### Task 1: Export Tiers Config for Compose

**Covers:** Make tiers.json accessible to the compose orchestrator

**Files:**
- Modify: `src/config.ts`

**Interfaces:**
- Consumes: `tiers.json` at project root or global config
- Produces: `loadTiers()` function exported from plugin

- [ ] **Step 1: Export loadTiers function**

Add to `src/config.ts`:

```typescript
export function loadTiers(directory?: string): ComposeConfig {
  return loadConfig(directory);
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -feat(plugin): export loadTiers for compose model selection

The compose orchestrator needs access to tiers.json to decide which
model to use when spawning subagents. This exports loadTiers() that
returns the parsed config with model mappings.
```

---

### Task 2: Update Compose Skill Instructions

**Covers:** Teach compose to read tiers and pass model to Actor tool

**Files:**
- Modify: `skills/compose/subagent/SKILL.md` (or relevant compose skill)

**Interfaces:**
- Consumes: tiers.json via file read
- Produces: Compose passes `model` parameter to Actor tool

- [ ] **Step 1: Add tier-aware model selection to compose skill**

Add instructions to the compose skill that tell it to:

1. Read `tiers.json` from project root or `~/.config/opencode/tiers.json`
2. When spawning a subagent, determine task complexity:
   - **Light tasks** (exploration, grep, read): use `explore.model`
   - **Medium tasks** (implement, fix, refactor): use `general-medium.model`
   - **Heavy tasks** (complex analysis, multi-file changes): use `general-heavy.model`
3. Pass the model via the Actor tool's `model` parameter

Example Actor call with model override:

```json
{
  "operation": {
    "action": "run",
    "subagent_type": "general",
    "description": "Implement feature X",
    "prompt": "...",
    "model": "opencode/mimo-v2.5-free"
  }
}
```

- [ ] **Step 2: Add model selection logic**

The compose should use this decision tree:

```
Is the task read-only (explore/grep/read)?
  → Yes: use explore.model
  → No: Is it a simple implementation (1-2 files)?
    → Yes: use general-medium.model
    → No: use general-heavy.model
```

- [ ] **Step 3: Commit**

```bash
git add skills/compose/subagent/SKILL.md
git commit -feat(compose): add tier-aware model selection to subagent skill

The compose now reads tiers.json and passes the appropriate model
when spawning subagents, overriding the default agent model.
```

---

### Task 3: Verify End-to-End

**Covers:** Validate model routing works correctly

**Files:**
- Test: manual verification

**Interfaces:**
- Consumes: Task 1 + Task 2 output
- Produces: Confirmation that subagents use tiers.json models

- [ ] **Step 1: Build the plugin**

Run: `npm run build`
Expected: dist/index.js created

- [ ] **Step 2: Test loadTiers function**

```bash
node -e "
const { loadTiers } = require('./dist/config.js');
const cfg = loadTiers('./tiers.json');
console.log('Tiers:', JSON.stringify(cfg, null, 2));
"
```

Expected: Output shows models from tiers.json

- [ ] **Step 3: Run compose with subagent**

Execute a compose task and check the router debug log:

Run: `tail -100 router-debug.log | grep -E "(model|explore|general)"`

Expected: Log shows the model from tiers.json being used, not the parent model

- [ ] **Step 4: Commit (if needed)**

```bash
git add -A
git commit -fix(plugin): verify tier-based model routing end-to-end
```

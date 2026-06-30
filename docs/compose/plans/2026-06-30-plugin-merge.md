# Plugin Unificado: Compose + Router + Memory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the tier-based routing plugin with the compose-memory plugin into a single unified OpenCode plugin with Compose as orchestrator, tiered subagents, and persistent BM25 memory.

**Architecture:** Compose agent replaces the Router as primary orchestrator. Explore (low-cost) and General (medium/high-cost) replace @fast/@medium/@heavy. Memory tool provides BM25 search via SQLite. 15 compose skills orchestrate workflows.

**Tech Stack:** TypeScript, @opencode-ai/plugin, better-sqlite3, zod, vitest

## Global Constraints

- Plugin registers only `config` and `tool` hooks
- System prompts are hardcoded in the plugin — tiers.json only customizes models
- Compose agent is primary mode; explore/general are subagent mode
- checkpoint-writer and dream use the same low-cost model as explore
- All existing tests must continue passing after each task
- One atomic commit per task

---

## File Structure

```
src/
├── index.ts              # Plugin entry: config + tool hooks
├── config.ts             # Agent creation (compose, explore, general)
├── memory/
│   ├── tool.ts           # Memory tool (search/write)
│   ├── store.ts          # SQLite FTS5 store
│   └── reconcile.ts      # Sync files ↔ database
agents/
├── compose.md            # Compose agent definition
├── explore.md            # Explore subagent definition
├── general.md            # General subagent definition
├── checkpoint-writer.md  # Hidden checkpoint agent
└── dream.md              # Hidden memory consolidation agent
prompts/
└── compose-system.txt    # Compose system prompt
skills/
└── compose/              # 15 orchestration skills
test/
├── config.spec.ts        # Updated config tests
├── index.test.ts         # Updated plugin tests
└── memory/
    ├── tool.test.ts      # Memory tool tests
    └── store.test.ts     # Store tests
```

---

### Task 1: Scaffold directories and dependencies

**Covers:** [S6]

**Files:**
- Create: `src/memory/` directory
- Create: `agents/` directory
- Create: `prompts/` directory
- Create: `skills/compose/` directory
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: directory structure, dependencies ready for memory system

- [ ] **Step 1: Create directories**

```bash
mkdir -p src/memory agents prompts skills/compose test/memory
```

- [ ] **Step 2: Add dependencies to package.json**

Add `better-sqlite3` and `zod` to dependencies, `@types/better-sqlite3` to devDependencies:

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "latest",
    "better-sqlite3": "^11.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "typescript": "^5.5.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: dependencies installed successfully

- [ ] **Step 4: Verify existing tests still pass**

Run: `npx vitest run`
Expected: 17 tests pass (existing tests unchanged)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold directories and add memory dependencies"
```

---

### Task 2: Port memory store (SQLite FTS5)

**Covers:** [S4]

**Files:**
- Create: `src/memory/store.ts`
- Create: `test/memory/store.test.ts`

**Interfaces:**
- Consumes: better-sqlite3, zod
- Produces: `MemoryStore` class with `search(query, opts)` and `write(path, scope, scope_id, type, content)` methods

- [ ] **Step 1: Write the failing test**

```typescript
// test/memory/store.test.ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { MemoryStore } from '../../src/memory/store.js';

describe('MemoryStore', () => {
  let dir: string;
  let dbPath: string;
  let store: MemoryStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'memory-store-'));
    dbPath = join(dir, 'memory.db');
    store = new MemoryStore(dbPath);
  });

  afterEach(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('writes and searches content', () => {
    store.write('test.md', 'global', '', 'snapshot', 'The quick brown fox jumps');
    const results = store.search('quick fox');
    expect(results.length).toBe(1);
    expect(results[0].path).toBe('test.md');
    expect(results[0].body).toContain('quick brown fox');
  });

  it('returns empty for no matches', () => {
    store.write('test.md', 'global', '', 'snapshot', 'hello world');
    const results = store.search('nonexistent');
    expect(results.length).toBe(0);
  });

  it('filters by scope', () => {
    store.write('a.md', 'global', '', 'snapshot', 'alpha beta');
    store.write('b.md', 'projects', 'proj1', 'snapshot', 'gamma delta');
    const global = store.search('alpha', { scope: 'global' });
    expect(global.length).toBe(1);
    expect(global[0].path).toBe('a.md');
    const project = store.search('gamma', { scope: 'projects' });
    expect(project.length).toBe(1);
    expect(project[0].path).toBe('b.md');
  });

  it('respects limit parameter', () => {
    for (let i = 0; i < 10; i++) {
      store.write(`file${i}.md`, 'global', '', 'snapshot', `unique term ${i}`);
    }
    const results = store.search('unique', { limit: 3 });
    expect(results.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/memory/store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/memory/store.ts
import Database from 'better-sqlite3';

export interface SearchResult {
  path: string;
  scope: string;
  scope_id: string;
  type: string;
  body: string;
  rank: number;
}

export interface SearchOpts {
  scope?: string;
  scope_id?: string;
  type?: string;
  limit?: number;
}

export class MemoryStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT '',
        scope_id TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT 'snapshot',
        body TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        path, scope, scope_id, type, body,
        content='memory',
        content_rowid='id'
      )
    `);
    const triggerInsert = `CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory BEGIN
      INSERT INTO memory_fts(rowid, path, scope, scope_id, type, body)
      VALUES (new.id, new.path, new.scope, new.scope_id, new.type, new.body);
    END`;
    const triggerDelete = `CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, path, scope, scope_id, type, body)
      VALUES ('delete', old.id, old.path, old.scope, old.scope_id, old.type, old.body);
    END`;
    const triggerUpdate = `CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, path, scope, scope_id, type, body)
      VALUES ('delete', old.id, old.path, old.scope, old.scope_id, old.type, old.body);
      INSERT INTO memory_fts(rowid, path, scope, scope_id, type, body)
      VALUES (new.id, new.path, new.scope, new.scope_id, new.type, new.body);
    END`;
    this.db.exec(triggerInsert);
    this.db.exec(triggerDelete);
    this.db.exec(triggerUpdate);
  }

  search(query: string, opts: SearchOpts = {}): SearchResult[] {
    const limit = opts.limit ?? 10;
    let sql = `
      SELECT m.path, m.scope, m.scope_id, m.type, m.body, rank
      FROM memory_fts f
      JOIN memory m ON m.id = f.rowid
      WHERE memory_fts MATCH ?
    `;
    const params: unknown[] = [query];

    if (opts.scope) {
      sql += ` AND m.scope = ?`;
      params.push(opts.scope);
    }
    if (opts.scope_id) {
      sql += ` AND m.scope_id = ?`;
      params.push(opts.scope_id);
    }
    if (opts.type) {
      sql += ` AND m.type = ?`;
      params.push(opts.type);
    }

    sql += ` ORDER BY rank LIMIT ?`;
    params.push(limit);

    return this.db.prepare(sql).all(...params) as SearchResult[];
  }

  write(path: string, scope: string, scope_id: string, type: string, body: string): void {
    this.db.prepare(
      'INSERT INTO memory (path, scope, scope_id, type, body) VALUES (?, ?, ?, ?, ?)'
    ).run(path, scope, scope_id, type, body);
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/memory/store.test.ts`
Expected: PASS — 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/memory/store.ts test/memory/store.test.ts
git commit -m "feat: add memory store with SQLite FTS5 search"
```

---

### Task 3: Port memory reconcile

**Covers:** [S4]

**Files:**
- Create: `src/memory/reconcile.ts`

**Interfaces:**
- Consumes: `MemoryStore` from Task 2
- Produces: `reconcileMemoryDir(store, dir)` function that syncs markdown files into SQLite

- [ ] **Step 1: Write minimal implementation**

```typescript
// src/memory/reconcile.ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { MemoryStore } from './store.js';

export function reconcileMemoryDir(store: MemoryStore, memoryDir: string): void {
  walkDir(memoryDir, store);
}

function walkDir(dir: string, store: MemoryStore): void {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walkDir(fullPath, store);
      } else if (entry.endsWith('.md')) {
        const content = readFileSync(fullPath, 'utf8');
        const relPath = fullPath;
        const existing = store.search(entry.replace('.md', ''), { limit: 1 });
        const alreadyIndexed = existing.some(r => r.path === relPath);
        if (!alreadyIndexed && content.trim().length > 0) {
          const scope = extractScope(fullPath, dir);
          const scopeId = extractScopeId(fullPath, dir);
          const type = extractType(fullPath);
          store.write(relPath, scope, scopeId, type, content);
        }
      }
    } catch {
      // skip unreadable entries
    }
  }
}

function extractScope(fullPath: string, rootDir: string): string {
  const rel = fullPath.slice(rootDir.length + 1);
  const firstSegment = rel.split('/')[0];
  if (firstSegment === 'global') return 'global';
  if (firstSegment === 'projects') return 'projects';
  if (firstSegment === 'sessions') return 'sessions';
  return 'unknown';
}

function extractScopeId(fullPath: string, rootDir: string): string {
  const rel = fullPath.slice(rootDir.length + 1);
  const parts = rel.split('/');
  if (parts.length >= 3 && (parts[0] === 'projects' || parts[0] === 'sessions')) {
    return parts[1];
  }
  return '';
}

function extractType(fullPath: string): string {
  const filename = fullPath.split('/').pop() ?? '';
  if (filename === 'checkpoint.md') return 'checkpoint';
  if (filename === 'MEMORY.md') return 'snapshot';
  if (filename === 'progress.md') return 'progress';
  return 'snapshot';
}
```

- [ ] **Step 2: Commit**

```bash
git add src/memory/reconcile.ts
git commit -m "feat: add memory directory reconciliation"
```

---

### Task 4: Port memory tool

**Covers:** [S4]

**Files:**
- Create: `src/memory/tool.ts`
- Create: `test/memory/tool.test.ts`

**Interfaces:**
- Consumes: `MemoryStore` (Task 2), `reconcileMemoryDir` (Task 3), @opencode-ai/plugin `tool()`
- Produces: `createMemoryTool(ctx)` function returning an OpenCode tool definition

- [ ] **Step 1: Write the failing test**

```typescript
// test/memory/tool.test.ts
import { mkdtemp, rm, mkdirSync } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { createMemoryTool } from '../../src/memory/tool.js';

describe('createMemoryTool', () => {
  let dir: string;
  let memoryDir: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'memory-tool-'));
    memoryDir = join(dir, 'memory');
    dbPath = join(memoryDir, 'memory.db');
    mkdirSync(memoryDir, { recursive: true });
    mkdirSync(join(memoryDir, 'global'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates a tool with search and write operations', () => {
    const tool = createMemoryTool({ memoryDir, dbPath });
    expect(tool).toBeDefined();
  });

  it('write stores content and search retrieves it', () => {
    const tool = createMemoryTool({ memoryDir, dbPath });
    const writeResult = tool.execute(
      { operation: 'write', path: 'test.md', content: 'important finding', scope: 'global' },
      {} as never
    );
    expect(writeResult).toContain('Wrote');

    const searchResult = tool.execute(
      { operation: 'search', query: 'important finding' },
      {} as never
    );
    expect(searchResult).toContain('important finding');
  });

  it('search returns no results message for empty store', () => {
    const tool = createMemoryTool({ memoryDir, dbPath });
    const result = tool.execute(
      { operation: 'search', query: 'nothing here' },
      {} as never
    );
    expect(result).toBe('No results found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/memory/tool.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/memory/tool.ts
import { tool } from '@opencode-ai/plugin';
import { z } from 'zod';
import { mkdirSync } from 'node:fs';
import { MemoryStore } from './store.js';
import { reconcileMemoryDir } from './reconcile.js';

export function createMemoryTool(ctx: { memoryDir: string; dbPath: string }) {
  let store: MemoryStore | null = null;

  function ensureStore() {
    if (!store) {
      mkdirSync(ctx.memoryDir, { recursive: true });
      mkdirSync(ctx.dbPath.replace(/\/[^/]+$/, ''), { recursive: true });
      store = new MemoryStore(ctx.dbPath);
      reconcileMemoryDir(store, ctx.memoryDir);
    }
    return store;
  }

  return tool({
    description:
      'Search or write to the persistent memory store. Search returns ranked results across memory files. Write saves content to a memory file.',
    args: {
      operation: z.enum(['search', 'write']),
      query: z.string().optional(),
      scope: z.string().optional(),
      scope_id: z.string().optional(),
      type: z.string().optional(),
      limit: z.number().optional(),
      path: z.string().optional(),
      content: z.string().optional(),
    },
    execute(args) {
      const s = ensureStore();

      if (args.operation === 'search') {
        if (!args.query) return 'query is required for search';
        const results = s.search(args.query, {
          scope: args.scope,
          scope_id: args.scope_id,
          type: args.type,
          limit: args.limit,
        });
        if (results.length === 0) return 'No results found';
        return JSON.stringify(results, null, 2);
      }

      if (args.operation === 'write') {
        if (!args.path) return 'path is required for write';
        if (!args.content) return 'content is required for write';
        s.write(
          args.path,
          args.scope ?? 'unknown',
          args.scope_id ?? '',
          args.type ?? 'snapshot',
          args.content,
        );
        return `Wrote to ${args.path}`;
      }

      return 'Invalid operation';
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/memory/tool.test.ts`
Expected: PASS — 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/memory/tool.ts test/memory/tool.test.ts
git commit -m "feat: add memory tool with search and write operations"
```

---

### Task 5: Create agent markdown files

**Covers:** [S3]

**Files:**
- Create: `agents/compose.md`
- Create: `agents/explore.md`
- Create: `agents/general.md`
- Create: `agents/checkpoint-writer.md`
- Create: `agents/dream.md`
- Create: `prompts/compose-system.txt`

**Interfaces:**
- Consumes: nothing (static assets)
- Produces: 5 agent definitions + compose system prompt

- [ ] **Step 1: Create compose system prompt**

```text
// prompts/compose-system.txt
You are the Compose Agent — an orchestrator that coordinates specialized skills into coherent workflows.

Brainstorm scope check — skip compose:brainstorm when ALL true:
- Task is a specific bug fix
- Requirements are fully stated (no design ambiguity)
- No architectural decisions needed

In these cases, skip brainstorm's design/spec phases only. You MUST still invoke compose:debug or compose:tdd and follow their full process — the execution flow is always a complete closed loop.

When a skill matches your task, you MUST invoke it. Skill invocation is non-negotiable — always load the skill first, then follow its guidance.

Every decision goes through the question tool — never stop with natural language questions.

Route every decision, clarification, or approval through the compose:ask skill (it drives the question tool). Never stop the loop with a natural-language question — that ends your turn without finishing the task.

When compose:ask determines no user is available to answer, pick the best option for headless execution yourself and continue (you will still ask again at the next decision point).

Use the skill tool to load skills. When you invoke a skill, its content is loaded and presented to you — follow it directly. Never use the Read tool on skill files.
```

- [ ] **Step 2: Create compose agent**

```markdown
// agents/compose.md
---
description: Compose mode — orchestrates workflows with compose skills for TDD, debugging, planning, and review
mode: primary
color: "#a7a3d8"
prompt: { file: "prompts/compose-system.txt" }
permission:
  edit: allow
  bash: allow
  question: allow
  skill: allow
  task: allow
  actor: allow
---

You are the Compose Agent. You orchestrate specialized skills into coherent workflows.
When a skill matches your task, invoke it. Follow each skill's guidance exactly.
```

- [ ] **Step 3: Create explore agent**

```markdown
// agents/explore.md
---
description: Fast read-only codebase explorer. Only grep, glob, list, read allowed.
mode: subagent
hidden: false
permission:
  read: allow
  glob: allow
  grep: allow
  bash:
    ls: allow
  edit: deny
  write: deny
---

You are a fast codebase explorer. Only read — never modify files.
Be thorough but concise. Return file paths and key findings.
```

- [ ] **Step 4: Create general agent**

```markdown
// agents/general.md
---
description: General-purpose multi-step worker for research and implementation
mode: subagent
hidden: false
permission:
  read: allow
  edit: allow
  write: allow
  bash: allow
  glob: allow
  grep: allow
---

You are a general-purpose agent. Execute multi-step tasks with full tool access.
Be thorough. Return structured results with files touched and findings.
```

- [ ] **Step 5: Create checkpoint-writer agent**

```markdown
// agents/checkpoint-writer.md
---
description: Writes session checkpoints for persistence (hidden)
mode: subagent
hidden: true
permission:
  read: allow
  edit: allow
  write: allow
  glob: allow
  grep: allow
---

You write structured session checkpoints. Extract key state from conversations and persist to memory files.
```

- [ ] **Step 6: Create dream agent**

```markdown
// agents/dream.md
---
description: Consolidates memory from session content (hidden)
mode: subagent
hidden: true
permission:
  read: allow
  edit: allow
  write: allow
  glob: allow
  grep: allow
---

You consolidate session memory. Identify durable knowledge, decisions, and patterns worth preserving.
```

- [ ] **Step 7: Commit**

```bash
git add agents/ prompts/
git commit -m "feat: add agent definitions and compose system prompt"
```

---

### Task 6: Port compose skills

**Covers:** [S5]

**Files:**
- Create: `skills/compose/` (15 skill directories, each with SKILL.md)

**Interfaces:**
- Consumes: nothing (static markdown files)
- Produces: 15 skill directories accessible via compose:* names

- [ ] **Step 1: Clone skills from compose-memory repo**

```bash
cd /home/marcos/Projects/opencode-router-model
git clone --depth 1 https://github.com/marcos2872/opencode-plugin-compose-memory.git /tmp/compose-memory-tmp
cp -r /tmp/compose-memory-tmp/skills/compose/* skills/compose/
rm -rf /tmp/compose-memory-tmp
```

- [ ] **Step 2: Verify skills are in place**

Run: `ls skills/compose/`
Expected: 15 directories (ask, brainstorm, debug, execute, feedback, merge, new-skill, parallel, plan, report, review, subagent, tdd, verify, worktree)

- [ ] **Step 3: Commit**

```bash
git add skills/
git commit -m "feat: add 15 compose orchestration skills"
```

---

### Task 7: Rewrite config.ts for new architecture

**Covers:** [S3, S6]

**Files:**
- Modify: `src/config.ts`

**Interfaces:**
- Consumes: tiers.json (optional), @opencode-ai/plugin Config type
- Produces: `loadConfig()`, `createComposeAgent()`, `createExploreAgent()`, `createGeneralAgent()` functions

- [ ] **Step 1: Rewrite config.ts**

```typescript
// src/config.ts
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

export interface TierConfig {
  model?: string;
}

export interface ComposeConfig {
  explore?: TierConfig;
  general?: TierConfig;
}

const DEFAULT_EXPLORE_MODEL = 'opencode/big-pickle';
const DEFAULT_GENERAL_MODEL = 'llama.cpp/Nex-N2-mini';

const DEFAULT_CONFIG: ComposeConfig = {
  explore: { model: DEFAULT_EXPLORE_MODEL },
  general: { model: DEFAULT_GENERAL_MODEL },
};

function pathExists(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function normalizeConfigPath(tiersJsonPath: string): string {
  return existsSync(tiersJsonPath) && statSync(tiersJsonPath).isDirectory()
    ? join(tiersJsonPath, 'tiers.json')
    : tiersJsonPath;
}

function validateConfig(config: unknown): asserts config is ComposeConfig {
  if (config !== null && typeof config === 'object' && !Array.isArray(config)) {
    const cfg = config as Record<string, unknown>;
    if (cfg.explore !== undefined) {
      if (typeof cfg.explore !== 'object' || cfg.explore === null) {
        throw new Error('explore must be an object');
      }
      const e = cfg.explore as Record<string, unknown>;
      if (e.model !== undefined && typeof e.model !== 'string') {
        throw new Error('explore.model must be a string');
      }
    }
    if (cfg.general !== undefined) {
      if (typeof cfg.general !== 'object' || cfg.general === null) {
        throw new Error('general must be an object');
      }
      const g = cfg.general as Record<string, unknown>;
      if (g.model !== undefined && typeof g.model !== 'string') {
        throw new Error('general.model must be a string');
      }
    }
  }
}

function normalizeConfig(config: unknown): ComposeConfig {
  validateConfig(config);
  const cfg = (config ?? {}) as ComposeConfig;
  return {
    explore: { model: cfg.explore?.model ?? DEFAULT_EXPLORE_MODEL },
    general: { model: cfg.general?.model ?? DEFAULT_GENERAL_MODEL },
  };
}

function readConfig(path: string): ComposeConfig {
  const raw = readFileSync(path, 'utf8');
  return normalizeConfig(JSON.parse(raw));
}

export function loadConfig(tiersJsonPath?: string): ComposeConfig {
  const requestedPath = tiersJsonPath ?? join(process.cwd(), 'tiers.json');
  const projectPath = normalizeConfigPath(requestedPath);
  const globalPath = join(homedir(), '.config', 'opencode', 'tiers.json');

  if (pathExists(projectPath)) {
    return readConfig(projectPath);
  }

  if (pathExists(globalPath)) {
    return readConfig(globalPath);
  }

  return normalizeConfig(DEFAULT_CONFIG);
}

export function createComposeAgent(input: { agent?: Record<string, unknown> }): void {
  if (!input.agent) input.agent = {};
  if (input.agent.compose) return;

  input.agent.compose = {
    mode: 'primary',
    description: 'Compose mode — orchestrates workflows with compose skills',
  };
}

export function createExploreAgent(input: { agent?: Record<string, unknown> }, cfg: ComposeConfig): void {
  if (!input.agent) input.agent = {};

  input.agent.explore = {
    model: cfg.explore?.model ?? DEFAULT_EXPLORE_MODEL,
    mode: 'subagent',
    description: 'Fast read-only codebase explorer',
    permission: {
      read: 'allow',
      glob: 'allow',
      grep: 'allow',
      bash: 'allow',
      edit: 'deny',
      write: 'deny',
    },
  };
}

export function createGeneralAgent(input: { agent?: Record<string, unknown> }, cfg: ComposeConfig): void {
  if (!input.agent) input.agent = {};

  input.agent.general = {
    model: cfg.general?.model ?? DEFAULT_GENERAL_MODEL,
    mode: 'subagent',
    description: 'General-purpose multi-step worker',
    permission: {
      read: 'allow',
      edit: 'allow',
      write: 'allow',
      bash: 'allow',
      glob: 'allow',
      grep: 'allow',
    },
  };
}
```

- [ ] **Step 2: Run existing tests to check for breakage**

Run: `npx vitest run`
Expected: some tests may fail (old Router tests reference removed functions)

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: rewrite config for compose + explore + general architecture"
```

---

### Task 8: Rewrite index.ts

**Covers:** [S2, S3, S4]

**Files:**
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `loadConfig`, `createComposeAgent`, `createExploreAgent`, `createGeneralAgent` (Task 7), `createMemoryTool` (Task 4)
- Produces: Plugin with `config` and `tool` hooks

- [ ] **Step 1: Rewrite index.ts**

```typescript
// src/index.ts
import type { Config, Plugin, PluginInput } from '@opencode-ai/plugin';
import { join } from 'node:path';
import {
  loadConfig,
  createComposeAgent,
  createExploreAgent,
  createGeneralAgent,
} from './config.js';
import { createMemoryTool } from './memory/tool.js';

const plugin = (input: PluginInput) =>
  Promise.resolve({
    config: async (config: Config) => {
      try {
        const cfg = loadConfig(input.directory);
        createComposeAgent(config);
        createExploreAgent(config, cfg);
        createGeneralAgent(config, cfg);
      } catch (e) {
        console.error(`[compose-plugin] config error:`, e);
      }
      return config;
    },
    tool: {
      memory: createMemoryTool({
        memoryDir: join(input.directory, '.opencode', 'memory'),
        dbPath: join(input.directory, '.opencode', 'memory', 'memory.db'),
      }),
    },
  }) as unknown as Plugin;

export default plugin;
```

- [ ] **Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat: rewrite plugin entry with config + tool hooks"
```

---

### Task 9: Update tests

**Covers:** [S8]

**Files:**
- Modify: `test/config.spec.ts`
- Modify: `test/index.test.ts`

**Interfaces:**
- Consumes: new config.ts API (Task 7), new index.ts API (Task 8)
- Produces: passing tests covering new architecture

- [ ] **Step 1: Rewrite config.spec.ts**

```typescript
// test/config.spec.ts
import { writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadConfig,
  createComposeAgent,
  createExploreAgent,
  createGeneralAgent,
} from '../src/config.js';

async function tempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

describe('loadConfig', () => {
  it('returns defaults when no tiers.json exists', async () => {
    const temp = await tempDir('compose-defaults-');
    try {
      const cfg = loadConfig(join(temp.dir, 'tiers.json'));
      expect(cfg.explore?.model).toBe('opencode/big-pickle');
      expect(cfg.general?.model).toBe('llama.cpp/Nex-N2-mini');
    } finally {
      await temp.cleanup();
    }
  });

  it('loads custom models from tiers.json', async () => {
    const temp = await tempDir('compose-custom-');
    try {
      const path = join(temp.dir, 'tiers.json');
      writeFileSync(path, JSON.stringify({
        explore: { model: 'custom/explore-model' },
        general: { model: 'custom/general-model' },
      }));
      const cfg = loadConfig(path);
      expect(cfg.explore?.model).toBe('custom/explore-model');
      expect(cfg.general?.model).toBe('custom/general-model');
    } finally {
      await temp.cleanup();
    }
  });

  it('handles partial config gracefully', async () => {
    const temp = await tempDir('compose-partial-');
    try {
      const path = join(temp.dir, 'tiers.json');
      writeFileSync(path, JSON.stringify({ explore: { model: 'custom/explore' } }));
      const cfg = loadConfig(path);
      expect(cfg.explore?.model).toBe('custom/explore');
      expect(cfg.general?.model).toBe('llama.cpp/Nex-N2-mini');
    } finally {
      await temp.cleanup();
    }
  });
});

describe('agent creation', () => {
  it('creates compose agent', () => {
    const input: { agent?: Record<string, unknown> } = { agent: {} };
    createComposeAgent(input);
    expect(input.agent?.compose).toMatchObject({ mode: 'primary' });
  });

  it('creates explore agent with configured model', () => {
    const input: { agent?: Record<string, unknown> } = { agent: {} };
    createExploreAgent(input, { explore: { model: 'test/model' } });
    expect(input.agent?.explore).toMatchObject({
      model: 'test/model',
      mode: 'subagent',
      permission: expect.objectContaining({ read: 'allow', edit: 'deny' }),
    });
  });

  it('creates general agent with configured model', () => {
    const input: { agent?: Record<string, unknown> } = { agent: {} };
    createGeneralAgent(input, { general: { model: 'test/general' } });
    expect(input.agent?.general).toMatchObject({
      model: 'test/general',
      mode: 'subagent',
      permission: expect.objectContaining({ edit: 'allow', read: 'allow' }),
    });
  });
});
```

- [ ] **Step 2: Rewrite index.test.ts**

```typescript
// test/index.test.ts
import { writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config, PluginInput } from '@opencode-ai/plugin';
import plugin from '../src/index.js';

function makeCtx(directory: string): PluginInput {
  return {
    directory,
    worktree: directory,
    client: {} as PluginInput['client'],
    project: {} as PluginInput['project'],
    experimental_workspace: { register: () => undefined },
    serverUrl: new URL('http://localhost'),
    $: {} as PluginInput['$'],
  };
}

async function tempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

describe('compose plugin', () => {
  let projectDir: string;

  beforeEach(async () => {
    const temp = await tempDir('compose-plugin-');
    projectDir = temp.dir;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it('registers config and tool hooks', async () => {
    const p = (await plugin(makeCtx(projectDir))) as Record<string, unknown>;
    expect(Object.keys(p)).toContain('config');
    expect(Object.keys(p)).toContain('tool');
  });

  it('creates compose, explore, and general agents', async () => {
    const p = (await plugin(makeCtx(projectDir))) as {
      config?: (input: Config) => Promise<Config>;
    };
    const input: Config = { agent: {} };
    await p.config?.(input);

    expect(input.agent?.compose).toBeDefined();
    expect(input.agent?.explore).toBeDefined();
    expect(input.agent?.general).toBeDefined();
  });

  it('explore has read-only permissions', async () => {
    const p = (await plugin(makeCtx(projectDir))) as {
      config?: (input: Config) => Promise<Config>;
    };
    const input: Config = { agent: {} };
    await p.config?.(input);

    expect(input.agent?.explore).toMatchObject({
      permission: expect.objectContaining({ read: 'allow', edit: 'deny', write: 'deny' }),
    });
  });

  it('general has full permissions', async () => {
    const p = (await plugin(makeCtx(projectDir))) as {
      config?: (input: Config) => Promise<Config>;
    };
    const input: Config = { agent: {} };
    await p.config?.(input);

    expect(input.agent?.general).toMatchObject({
      permission: expect.objectContaining({ read: 'allow', edit: 'allow', write: 'allow' }),
    });
  });

  it('logs config errors without crashing', async () => {
    writeFileSync(join(projectDir, 'tiers.json'), '{ invalid json');
    const p = (await plugin(makeCtx(projectDir))) as {
      config?: (input: Config) => Promise<Config>;
    };
    const input: Config = { agent: {} };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await p.config?.(input);

    expect(errorSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: all tests pass (config + index + memory)

- [ ] **Step 4: Commit**

```bash
git add test/
git commit -m "test: rewrite tests for compose + memory architecture"
```

---

### Task 10: Clean up old code and tiers.json

**Covers:** [S7]

**Files:**
- Modify: `tiers.json` (simplified)
- Remove: old Router-specific code references

**Interfaces:**
- Consumes: all previous tasks complete
- Produces: clean codebase with no Router remnants

- [ ] **Step 1: Simplify tiers.json**

```json
{
  "explore": {
    "model": "opencode/big-pickle"
  },
  "general": {
    "model": "llama.cpp/Nex-N2-mini"
  }
}
```

- [ ] **Step 2: Remove old test fixtures referencing Router**

Check `test/index.test.ts` and `test/config.spec.ts` for any remaining references to `router`, `@fast`, `@medium`, `@heavy`, `routerPrompt`, `taskPatterns`, `enforcement`, `routing`. Remove if found.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: no type errors

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: clean up old Router code and simplify tiers.json"
```

---

### Task 11: Final verification

**Covers:** [S8]

**Files:** none (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no type errors

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: no lint errors

- [ ] **Step 4: Verify plugin structure**

```bash
ls agents/          # compose.md, explore.md, general.md, checkpoint-writer.md, dream.md
ls skills/compose/  # 15 skill directories
ls src/memory/      # tool.ts, store.ts, reconcile.ts
ls prompts/         # compose-system.txt
```

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "chore: final cleanup and verification"
```

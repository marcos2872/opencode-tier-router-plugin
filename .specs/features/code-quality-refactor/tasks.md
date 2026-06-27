# Tasks: Code Quality Refactor & Documentation

**Feature**: `code-quality-refactor`  
**Total Effort**: 25.25 hours  
**Total Tasks**: 17  

---

## Phase 1: CRITICAL BUGS (5 hours)

### Task 1.1: Remove `as any` in token hook [1h]

**File**: `src/index.ts:421`  
**Dependency**: None  
**Acceptance Criteria**:
- Type assertion removed
- ToolExecuteOutput interface defined
- Type guard validates output structure
- Tests pass

**Scope**:
1. Define `ToolExecuteOutput` interface with usage fields
2. Replace `output as any` with type guard
3. Add validation for edge cases (missing fields)
4. Update token parser to use typed interface
5. Run tests: `npx vitest src/index.ts`

**Test Verification**:
```typescript
// Should pass: valid usage object
// Should default: missing usage object
// Should parse: string-based output fallback
```

---

### Task 1.2: Type `tokens: any` parameter [0.5h]

**File**: `src/router/token-tracker.ts:180`  
**Dependency**: None  
**Acceptance Criteria**:
- Parameter `tokens: any` replaced with `TokenRecord`
- Public API fully typed
- No `as any` in signature
- Tests pass

**Scope**:
1. Use existing `TokenRecord` type
2. Remove `any` from `recordEvent()` signature
3. Add validation in caller (`index.ts`)
4. Run tests: `npx vitest src/router/token-tracker.ts`

---

### Task 1.3: Fix race condition in LRU eviction [2h]

**File**: `src/router/token-tracker.ts:96-112`  
**Dependency**: Task 1.2  
**Acceptance Criteria**:
- Race condition eliminated
- Multiple evictions don't create duplicates
- LRU order preserved under concurrent access
- Tests pass including race condition test

**Scope**:
1. Review SessionCache eviction logic
2. Identify O(n²) behavior in current implementation
3. Implement Set-based deduplication
4. Add test for concurrent evictions
5. Benchmark O(n) vs O(n²)

**Bug Scenario**:
```
1. Cache has: [A, B, C] (3 items, max=3)
2. Two concurrent evictions triggered
3. Both try to remove oldest
4. Result: duplicates or out-of-order
```

**Expected After Fix**:
```
1. Cache evicts atomically (locks or queue)
2. Only one item removed per eviction
3. No duplicates created
4. LRU order preserved
```

---

### Task 1.4: Add cleanup to OrphanBuffer [1.5h]

**File**: `src/router/orphan-buffer.ts:45`  
**Dependency**: None  
**Acceptance Criteria**:
- Memory leak eliminated
- Periodic cleanup runs every 10s
- Expired items removed
- Tests pass

**Scope**:
1. Add `cleanupInterval` property (10s)
2. Implement `startCleanup()` method
3. Implement `stopCleanup()` method
4. Add test: verify cleanup runs
5. Add test: verify expired items removed

**Memory Leak Scenario**:
```
- Orphan buffer accumulates unmatched events
- No TTL, no cleanup timer
- Eventually: memory exhausted
```

---

## Phase 2: ARCHITECTURE (8 hours)

### Task 2.1: Extract CostCalculator module [2h]

**File**: `src/router/cost-calculator.ts` (NEW)  
**Dependency**: Task 1.2  
**Acceptance Criteria**:
- Module created and exported
- All cost calculations centralized
- Duplicates eliminated from existing files
- Tests pass
- Zero code duplication

**Scope**:
1. Create `src/router/cost-calculator.ts` with `calculateCost()` function
2. Review 3 locations with cost logic:
   - `token-tracker.ts:~200`
   - `metrics-aggregator.ts:~150`
   - `metrics-formatter.ts:~80`
3. Extract common formula: `tokens * costRatio`
4. Add tier-aware calculation
5. Update 3 files to use new module
6. Verify: `grep -r "costRatio.*\*" src/` returns only 1 match

**Formula Extracted**:
```typescript
/**
 * Calculate token cost based on tier's cost ratio.
 * Formula: (inputTokens + outputTokens) * tier.costRatio
 */
export function calculateCost(
  tokens: TokenRecord,
  tier: TierConfig
): number {
  const total = (tokens.inputTokens ?? 0) + (tokens.outputTokens ?? 0);
  return total * tier.costRatio;
}
```

---

### Task 2.2: Add comprehensive JSDoc to all public functions [4h]

**File**: `src/**/*.ts`  
**Dependency**: None  
**Acceptance Criteria**:
- All exported functions documented
- All public interfaces documented
- JSDoc includes examples for non-trivial functions
- TypeDoc builds without warnings
- IDE hover shows complete documentation

**Scope**:
1. Apply JSDoc pattern from `/tmp/opencode/docstring-guide.md`
2. Document:
   - All functions in `src/router/` (8 files)
   - All functions in `src/` root (index.ts, narration.ts)
   - All interfaces and types
3. Pattern: Summary + Details + @param + @returns + @throws + @example
4. Run: `npx typedoc --out docs/api src/`
5. Verify: No warnings, all public exports documented

**Files to Document**:
```
src/index.ts              (10 functions)
src/router/config.ts      (5 functions)
src/router/classifier.ts  (4 functions)
src/router/selector.ts    (6 functions)
src/router/caps.ts        (5 functions)
src/router/token-tracker.ts (8 functions)
src/router/token-commands.ts (4 functions)
src/router/token-event-parser.ts (4 functions)
src/router/metrics-aggregator.ts (6 functions)
src/router/orphan-buffer.ts (4 functions)
src/narration.ts          (2 functions)
```

---

### Task 2.3: Improve error handling in FilesystemStorage [1h]

**File**: `src/router/filesystem-storage.ts:23-30`  
**Dependency**: None  
**Acceptance Criteria**:
- File-not-found distinguished from other errors
- Context logged (error code, message)
- Caller can identify error type
- Tests pass

**Scope**:
1. Review current catch block (silences all errors)
2. Distinguish `ENOENT` (file doesn't exist) from other errors
3. Log unexpected errors with context
4. Maintain graceful degradation
5. Add test: verify error distinction

**Current Code Problem**:
```typescript
catch {
  // Can't tell if file doesn't exist or disk error
  return '';
}
```

**Fixed Code**:
```typescript
catch (err) {
  const error = err as NodeJS.ErrnoException;
  if (error.code === 'ENOENT') {
    // Expected: file doesn't exist yet
    return '';
  }
  // Unexpected error
  console.warn(`[FilesystemStorage] Failed to load ${filename}:`, error.message);
  return '';
}
```

---

### Task 2.4: Add type guards for OpenCodeClient [1h]

**File**: `src/router/selector.ts:147`  
**Dependency**: Task 1.2  
**Acceptance Criteria**:
- Type guard function defined
- Runtime validation before type assertion
- Tests pass
- No more `as unknown` patterns

**Scope**:
1. Define `isOpenCodeClient()` type guard
2. Validate client structure at runtime
3. Check for `session.prompt` function
4. Use guard before assertion
5. Add tests for guard

**Type Guard Pattern**:
```typescript
function isOpenCodeClient(client: unknown): client is OpenCodeClient {
  return client !== null &&
    typeof client === 'object' &&
    'session' in client &&
    typeof (client as any).session?.prompt === 'function';
}
```

---

## Phase 3: REFACTORING (8 hours)

### Task 3.1: Extract PluginOrchestrator [3h]

**File**: `src/plugin-orchestrator.ts` (NEW)  
**Dependency**: Task 2.2, 2.4  
**Acceptance Criteria**:
- `index.ts` reduced to ≤250 lines
- 7 responsibilities → 2 (main entry + delegation)
- SRP compliant
- Tests pass
- No behavioral changes

**Scope**:
1. Create `src/plugin-orchestrator.ts` class
2. Move hook handlers (chat.message, system.transform, etc.)
3. Move session management
4. Move command routing
5. Keep index.ts as thin wrapper
6. Update index.ts hook registrations
7. Add tests for orchestrator

**Extract from index.ts (385 lines, 7 responsibilities)**:
- Config loading (lines 186-200) → keep in index.ts
- Chat message routing (lines 283-310) → PluginOrchestrator
- System transform (lines 351-380) → PluginOrchestrator
- Permission blocking (lines 382-400) → PluginOrchestrator
- Token tracking (lines 415-450) → TokenTracker (already isolated)
- Command execution (lines 480-520) → CommandExecutor (may be new)
- Narration detection (lines 540-560) → NarrationDetector (already isolated)

**Result**: 
- `index.ts`: ~200 lines (just hooks)
- `PluginOrchestrator`: ~150 lines (orchestration)
- `CommandExecutor`: ~80 lines (command handling)

---

### Task 3.2: Optimize touchLRU to O(1) [2h]

**File**: `src/router/token-tracker.ts:139-142`  
**Dependency**: Task 1.3  
**Acceptance Criteria**:
- touchLRU operation is O(1) time
- LRU order preserved
- Tests pass
- Benchmark shows no degradation

**Current Algorithm**: O(n)
```typescript
// Current: searches array for item
const index = this.cache.findIndex(item => item.key === key);
this.cache.splice(index, 1);  // remove
this.cache.push(item);         // add to end
```

**Optimized Algorithm**: O(1)
```typescript
// Use Map with iteration order guarantee
const map = new Map();  // insertion order preserved
map.delete(key);        // O(1)
map.set(key, value);    // O(1), adds to end
```

**Test**:
- Benchmark: 1000 cache hits
- Before: ~10ms (O(n) search)
- After: <1ms (O(1) hash lookup)

---

### Task 3.3: Cache regex patterns [1h]

**File**: `src/router/classifier.ts:25`  
**Dependency**: None  
**Acceptance Criteria**:
- Regex patterns compiled once
- No recompilation in hot path
- Tests pass
- Performance improved

**Scope**:
1. Find regex patterns in classifier.ts
2. Move to module-level constants
3. Compile once at startup
4. Reuse in `classify()` calls
5. Add test: verify caching works

**Example**:
```typescript
// Before: recompiled on each call
const isFastKeyword = /find|grep|search|list|show|read|locate/.test(input);

// After: compiled once
const FAST_KEYWORDS_RE = /find|grep|search|list|show|read|locate/;
const isFastKeyword = FAST_KEYWORDS_RE.test(input);
```

---

### Task 3.4: Add race condition tests [2h]

**File**: `test/race-conditions.spec.ts` (NEW)  
**Dependency**: Task 1.3, 1.4  
**Acceptance Criteria**:
- Tests cover concurrent LRU evictions
- Tests cover concurrent orphan matching
- Tests verify no data corruption
- All tests pass

**Scope**:
1. Create new test file: `test/race-conditions.spec.ts`
2. Test concurrent cache operations
3. Test concurrent evictions
4. Test concurrent orphan buffer matches
5. Use `Promise.all()` to trigger race
6. Verify consistency

**Test Example**:
```typescript
test('LRU: concurrent evictions do not corrupt cache', async () => {
  const cache = new SessionCache();
  // Add 3 items
  for (let i = 0; i < 3; i++) {
    cache.set(`key${i}`, i);
  }
  // Trigger 2 evictions concurrently
  await Promise.all([
    cache.evictOldest(),
    cache.evictOldest(),
  ]);
  // Verify: exactly 1 item removed
  expect(cache.size).toBe(2);
});
```

---

## Phase 4: POLISH (4.25 hours)

### Task 4.1: Move magic numbers to constants [1h]

**File**: Multiple (TBD by grep)  
**Dependency**: None  
**Acceptance Criteria**:
- All magic numbers converted to named constants
- Constants grouped in module or shared file
- No unexplained numbers in code
- Tests pass

**Scope**:
1. Find magic numbers: `grep -rn "[0-9]\{3,\}" src/` 
2. Examples: 5000 (TTL), 100 (LRU size), 210 (tokens), 10000 (buffer size)
3. Move to `src/constants.ts`
4. Document each constant

**Constants to Extract**:
```typescript
// src/constants.ts
export const TOKEN_PROTOCOL_SIZE = 210;  // Delegation protocol tokens
export const LRU_MAX_SIZE = 100;          // Session cache limit
export const SESSION_TTL_MS = 5 * 60 * 1000;  // 5 minutes
export const ORPHAN_BUFFER_SIZE = 10000;  // Max orphan events
export const CLEANUP_INTERVAL_MS = 10 * 1000;  // 10 seconds
```

---

### Task 4.2: Remove unused variables [0.25h]

**File**: `src/router/orphan-buffer.ts:37-38`  
**Dependency**: None  
**Acceptance Criteria**:
- No unused variables
- Code compiles without warnings
- Tests pass

**Scope**:
1. Find unused vars: `tsc --noEmit` or eslint
2. Remove from orphan-buffer.ts
3. Check for other instances
4. Run build: `npm run build`

---

### Task 4.3: Create CONTRIBUTING.md [2h]

**File**: `CONTRIBUTING.md` (NEW, root)  
**Dependency**: Task 2.2 (JSDoc guide)  
**Acceptance Criteria**:
- File created
- Covers: setup, testing, commits, JSDoc pattern
- Links to quality report and docstring guide
- Clear for contributors

**Sections**:
1. Getting Started (setup, build, test)
2. Code Standards (SOLID, Clean Code, TypeScript)
3. Testing (unit tests, coverage ≥85%)
4. Commits (atomic, conventional)
5. Documentation (JSDoc pattern from guide)
6. Review Checklist (quality gates)

---

### Task 4.4: Add lint rule for TODOs [0.5h]

**File**: `.eslintrc.json`  
**Dependency**: None  
**Acceptance Criteria**:
- ESLint rule detects unresolved TODOs
- CI fails if TODOs without linked issues
- Existing TODOs grandfathered (if any)
- Build passes

**Scope**:
1. Add eslint rule: `no-unresolved-todos`
2. Configure: allow `TODO(#ISSUE)`, disallow bare `TODO`
3. Run: `npm run lint`

---

### Task 4.5: Add size limit to JSON.parse [0.5h]

**File**: `src/index.ts:426`  
**Dependency**: Task 2.3  
**Acceptance Criteria**:
- JSON strings validated before parsing
- Size limit prevents DoS
- Tests pass
- No behavioral change for normal input

**Scope**:
1. Create `safeJsonParse()` with size limit (1MB)
2. Use in token tracking (`index.ts:426`)
3. Use in token-tracker session load
4. Add test: reject >1MB input

**Implementation**:
```typescript
function safeJsonParse<T>(json: string, maxSize: number = 1024 * 1024): T | null {
  if (json.length > maxSize) {
    console.warn(`JSON exceeds size limit (${json.length} > ${maxSize})`);
    return null;
  }
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
```

---

## Atomic Commits

One commit per task, each following:

```
<type>(<scope>): <subject>

<body: why, not what>

Fixes: spec.md AC-NNN
Task: code-quality-refactor/#N
```

Example:
```
feat(token-tracker): remove 'as any' type assertion in token hook

Replace unsafe 'as any' with strict ToolExecuteOutput interface.
Add type guard to validate output structure before access.
Prevents undefined access on missing usage fields.

Fixes: spec.md AC-001
Task: code-quality-refactor/1.1
```

---

## Gate (Run Before Commit)

```bash
npm run typecheck       # Type check
npx vitest run          # All tests
npx eslint src/         # Lint (if configured)
```

All must pass. Zero warnings.

---

## Verification Criteria

| Task | Verification | Evidence |
|------|--------------|----------|
| 1.1-1.4 | Tests pass | `vitest run` output |
| 2.1 | Zero duplication | `grep -r "costRatio" src/` |
| 2.2 | TypeDoc builds | `typedoc --out docs` no warnings |
| 2.3 | Error distinctions | Unit tests for ENOENT vs other |
| 2.4 | Type guards used | Code review, tests pass |
| 3.1 | Lines reduced | `wc -l src/index.ts` ≤250 |
| 3.2 | Benchmark | Before/after perf test |
| 3.3 | Regex cached | Code review |
| 3.4 | Race tests pass | `vitest run test/race-conditions.spec.ts` |
| 4.* | No warnings | `npm run build`, `npm run typecheck` |

---

## Execution Plan

**Recommended**: Sequential (one phase per day)

- **Wed 2026-06-27**: Phase 1 (5h)
- **Thu-Fri 2026-06-28-29**: Phase 2 (8h)
- **Mon 2026-07-01**: Phase 3 (8h)
- **Tue 2026-07-02**: Phase 4 (4.25h)
- **Wed 2026-07-03**: Verification & Merge

**Alternative**: Parallel (by sub-agent)
- Workers: Phase1, Phase2, Phase3, Phase4 (one per agent)
- Verifier runs after Phase4

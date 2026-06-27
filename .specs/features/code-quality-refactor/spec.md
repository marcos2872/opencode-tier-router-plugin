# Feature: Code Quality Refactor & Complete Documentation

**Status**: In Planning  
**Priority**: HIGH  
**Effort**: 25.25 hours (4 phases)  
**Scope**: Bug fixes (critical), refactoring (architecture), documentation (JSDoc)

---

## 1. Requirements & Acceptance Criteria

### Goal
Improve code quality from 82/100 to 92+/100 by fixing critical bugs, eliminating architectural violations, and adding comprehensive JSDoc documentation to all public APIs.

### AC-001: CRITICAL BUGS FIXED
**WHEN** code is deployed to production  
**THEN** zero critical type safety bugs (no `as any` without justification)  
**AND** zero race conditions in LRU eviction  
**AND** zero memory leaks in orphan buffer  
**VERIFICATION**: Type checking passes, unit tests pass, no SonarQube critical issues

### AC-002: ARCHITECTURE VIOLATIONS RESOLVED
**WHEN** code is reviewed  
**THEN** SRP is not violated (no single file >300 lines with >3 responsibilities)  
**AND** no direct type assertions without guards (`as any` fully eliminated)  
**AND** all internal modules properly encapsulated  
**VERIFICATION**: Architecture tests pass, eslint rules pass

### AC-003: ZERO TYPE SAFETY ISSUES
**WHEN** code is type-checked  
**THEN** no `any` usage in public APIs  
**AND** null/undefined safety checks present  
**AND** type guards for runtime validation  
**VERIFICATION**: `npm run typecheck` passes, strict mode enabled

### AC-004: ERROR HANDLING IMPROVED
**WHEN** errors occur  
**THEN** they are logged with context (not silenced)  
**AND** can be distinguished (file-not-found vs. permission error)  
**AND** recovery is attempted gracefully  
**VERIFICATION**: Error handling unit tests pass

### AC-005: CODE DUPLICATION ELIMINATED
**WHEN** cost calculation is needed  
**THEN** logic is centralized in one module (CostCalculator)  
**AND** no copy-paste across token-tracker.ts, metrics-aggregator.ts, etc  
**VERIFICATION**: grep for "costRatio *\*" returns only 1 match

### AC-006: COMPLETE JSDOC DOCUMENTATION
**WHEN** developer hovers over any public function  
**THEN** IDE shows complete JSDoc with examples  
**AND** all public interfaces are documented  
**AND** all exported types have descriptions  
**VERIFICATION**: TypeDoc generates zero warnings, all public exports documented

### AC-007: PERFORMANCE OPTIMIZED
**WHEN** LRU cache operations run  
**THEN** touchLRU is O(1), not O(n)  
**AND** regex patterns are cached (not recompiled per call)  
**VERIFICATION**: Performance benchmarks show no degradation

### AC-008: COMPREHENSIVE TEST COVERAGE
**WHEN** tests run  
**THEN** race conditions have specific test cases  
**AND** error scenarios are tested  
**AND** coverage remains ≥85%  
**VERIFICATION**: `npm run test` passes, coverage report shows ≥85%

---

## 2. Architecture Decisions

### AD-101: CostCalculator Module
**Reasoning**: Cost calculation logic duplicated in 3 places (token-tracker.ts, metrics-aggregator.ts, metrics-formatter.ts).  
**Decision**: Extract to `src/router/cost-calculator.ts` with single entry point.  
**Impact**: DRY principle, testable isolation, easier to change pricing logic.

### AD-102: SessionCache Extraction  
**Reasoning**: SessionCache is private, not testable, violates SRP in TokenTracker.  
**Decision**: Extract `src/router/session-cache.ts` with public interface `CacheStrategy<K, V>`.  
**Impact**: Better testing, reusable cache for other modules.

### AD-103: PluginOrchestrator Extraction
**Reasoning**: `index.ts` (385 lines, 7 responsibilities) violates SRP.  
**Decision**: Extract hook orchestration into `src/plugin-orchestrator.ts`.  
**Impact**: Testable plugin layer, clearer concerns.

### AD-104: Safe JSON Parsing
**Reasoning**: Multiple `JSON.parse()` without error handling.  
**Decision**: Centralize in `src/utils/safe-json.ts` with fallback values.  
**Impact**: Consistent error handling, no crashes on malformed JSON.

### AD-105: Type-Safe Token Events
**Reasoning**: `tokens: any` parameter in public APIs breaks type safety.  
**Decision**: Define explicit `TokenRecord` interface, use in all public APIs.  
**Impact**: Type safety for token tracking, better IDE support.

---

## 3. Testing Strategy

### Unit Tests
- **Existing**: 6.260 lines of tests (19 files)
- **New**: 
  - Race condition test for LRU eviction (50 lines)
  - OrphanBuffer cleanup test (30 lines)
  - Type guard tests for OpenCodeClient (40 lines)
  - Safe JSON parse tests (20 lines)

### Verification
- Gate: `npm run typecheck && npx vitest run`
- Coverage: ≥85% (current 85%, maintain)
- No new warnings in build/test output

---

## 4. Phases (Adaptive Breakdown)

### Phase 1: CRITICAL (4 tasks, 5h) ⚠️
Fix bugs that could break production.

1. Remove `as any` in token hook
2. Type `tokens: any` parameter
3. Fix race condition in LRU eviction
4. Add cleanup to OrphanBuffer

### Phase 2: ARCHITECTURE (4 tasks, 8h)
Fix structural violations.

1. Extract CostCalculator
2. Add comprehensive JSDoc
3. Improve error handling
4. Add type guards

### Phase 3: REFACTORING (4 tasks, 8h)
Improve design and performance.

1. Extract PluginOrchestrator
2. Optimize touchLRU to O(1)
3. Cache regex patterns
4. Add race condition tests

### Phase 4: POLISH (5 tasks, 4.25h)
Quality improvements.

1. Move magic numbers to constants
2. Remove unused variables
3. Create CONTRIBUTING.md
4. Add lint rule for TODOs
5. Add size limit to JSON.parse

---

## 5. Success Metrics

| Metric | Current | Target | Tool |
|--------|---------|--------|------|
| Code Quality Score | 82/100 | 92+/100 | Manual audit |
| Type Safety | 85/100 | 95/100 | TypeScript strict |
| Code Duplication | 3 cost calcs | 1 | grep |
| Documentation | 65/100 | 90/100 | TypeDoc |
| Test Coverage | 85% | 85%+ | Vitest |
| Critical Bugs | 2 | 0 | Code review |

---

## 6. Dependencies & Constraints

- Must not change public APIs (breaking change)
- Must maintain backward compatibility
- Must not reduce test coverage below 85%
- Must not introduce new ESLint warnings
- TypeScript strict mode must remain enabled

---

## 7. Rollout Plan

1. **Phase 1** (Wed 2026-06-27) → Internal review
2. **Phase 2** (Thu-Fri 2026-06-28-29) → Feature branch
3. **Phase 3** (Mon 2026-07-01) → Feature branch
4. **Phase 4** (Tue 2026-07-02) → Feature branch
5. **Verification** (Wed 2026-07-03) → Merge to main + release

---

## 8. Reference Documents

- Quality Report: `/tmp/opencode/quality-report.md`
- Correction Plan: `/tmp/opencode/correction-plan.csv`
- Docstring Guide: `/tmp/opencode/docstring-guide.md`

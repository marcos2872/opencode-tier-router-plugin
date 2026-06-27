# Contributing to opencode-tier-router-plugin

## Getting Started

1. Clone the repository
2. Run `npm install`
3. Run `npm run build` to compile TypeScript
4. Run `npx vitest run` to execute all tests
5. Run `npm run typecheck` to verify types

## Code Standards

- **SOLID**: Single responsibility, Open/closed, Liskov substitution, Interface segregation, Dependency inversion
- **Clean Code**: Meaningful names, small functions, no side effects
- **TypeScript strict**: Enable `strict: true` in tsconfig, no `any` without justification
- **SRP**: No single file should have more than 2-3 responsibilities

## Testing

- Write unit tests for all new code
- Maintain test coverage ≥85%
- Place tests in `test/` directory following `*.spec.ts` naming convention
- Run `npx vitest run` before committing

## Commit Messages

Use conventional commits format:

```
<type>(<scope>): <description>

<body: why the change was made>

Fixes: spec.md AC-NNN
Task: <feature>/<task-id>
```

Types: feat, fix, refactor, perf, test, docs, style, chore

Keep commits **atomic** — one logical change per commit.

## Documentation

All exported functions must have JSDoc:

```typescript
/**
 * Brief description of what the function does.
 *
 * @param paramName - Description of the parameter
 * @returns Description of the return value
 * @throws Description of when it throws
 * @example
 * ```typescript
 * const result = myFunction('input');
 * ```
 */
```

## Review Checklist

Before submitting a PR:

- [ ] `npm run typecheck` passes
- [ ] `npx vitest run` passes (all tests)
- [ ] No `any` or `as any` without justification
- [ ] JSDoc added for all public APIs
- [ ] Commit messages follow conventional commits
- [ ] One logical change per commit
- [ ] Tests cover new functionality
- [ ] No magic numbers (use constants from `src/constants.ts`)

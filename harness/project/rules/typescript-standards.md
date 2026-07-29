# TypeScript Standards

## Goal

Maintain consistent, type-safe code across the monolithic extension without introducing runtime surprises or build failures.

## Repo Facts

- TypeScript 5.x with strict mode
- ESLint 9 flat config (`eslint.config.mjs`)
- No Prettier — formatting follows ESLint rules
- Test framework: `node:test` (no Jest, no Mocha)
- Output: `out/` (CommonJS, for VSCode extension host)

## Core Rules

1. Use explicit return types on exported functions
2. Prefer `interface` over `type` for object shapes that may be extended
3. Use `const` by default; `let` only when reassignment is needed
4. No `any` without a comment explaining why it's necessary
5. Use `node:` prefix for Node.js built-in imports (`import * as fs from 'fs'` is legacy but accepted in existing code)
6. Error handling: catch specific errors; avoid empty catch blocks
7. Async functions must handle rejections (no floating promises)
8. No default exports — use named exports

## Design Checklist

- [ ] Types defined close to usage or in a `types.ts` within the same module
- [ ] Shared types between modules go in `core/types.ts`
- [ ] No runtime type assertions (`as unknown as X`) without justification

## Implementation Checklist

- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` passes (or only pre-existing warnings)
- [ ] New test file added in `src/test/` for non-trivial logic

## Common Smells

- Using `as any` to silence a type error instead of fixing the type
- Defining the same interface in multiple modules instead of sharing via `core/types.ts`
- Using `require()` instead of ES module imports

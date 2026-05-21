# Verification Matrix

> Status date: 2026-05-21

This file records verification methods, results, and gaps for the current initiative.

## Verification Levels

| Level     | Meaning                              |
| --------- | ------------------------------------ |
| `format`  | Format check                         |
| `lint`    | Static rule check                    |
| `compile` | Compilation or syntax-level check    |
| `test`    | Unit test / contract test            |
| `smoke`   | Manual or semi-automated critical path verification |
| `real`    | Real environment / real device integration |

## Current Records

| Work package | Scope | Level    | Command / Method | Result | Uncovered items          |
| ------------ | ----- | -------- | ---------------- | ------ | ------------------------ |
| CORE_VSCODE_BOUNDARY-01 | Adapter boundary | `test` | `node --test --test-reporter=spec out/test/architectureBoundary.test.js` | pass | Runtime behavior covered by full suite |
| CORE_VSCODE_BOUNDARY-01 | Static/type checks | `lint` / `compile` | `npm run lint`; `./node_modules/.bin/tsc --noEmit -p ./` | pass | none |
| CORE_VSCODE_BOUNDARY-01 | Full regression | `test` | `env HOME=/private/tmp/compilot-test-home npm test` | pass, 125/125 | Uses temp HOME to avoid writing user config |

## Current Verification Conclusion

- Strongest verification so far: full automated suite, lint, and TypeScript all pass.
- Biggest gap: no Extension Development Host manual smoke test in this pass.

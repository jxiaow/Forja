# Verification Matrix

> Status date: 2026-07-09

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
| TS-01 | operations docs | `format` | `node harness/core/automation/check-process.js --summary --max-issues 3 docs/operations/target-store-redesign` | pass | Runtime behavior not covered |
| TS-01 | TargetStore schema | `test` | Future: `node --test src/test/targetStore.test.js` | not run | Implementation not started |
| TS-02 | legacy migration | `test` | Future: old activeTarget + pinnedProject + targetToolchains fixtures | not run | Implementation not started |
| TS-03 | CLI behavior | `test` | Future: `list/use/status/build --plan/run --plan` contract tests | not run | Implementation not started |
| TS-04 | VSCode UI flow | `smoke` | Future: select target, switch mode/arch, reopen workspace | not run | Implementation not started |
| TS-05 | legacy writes removed | `lint` | Future: `rg "saveActiveTarget|pinnedProject|targetToolchains" src` audit | not run | Implementation not started |

## Current Verification Conclusion

- Strongest verification so far: operations 文档通过 process check。
- Biggest gap: TargetStore API、迁移行为、CLI/UI 调用点都还未实现。

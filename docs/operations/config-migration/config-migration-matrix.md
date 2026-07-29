# Verification Matrix

> **状态：superseded。** 本矩阵不再作为当前版本验收依据。当前验收使用 `docs/operations/workroot-redesign/workroot-redesign-board.md` 中 WS-00~WS-10 的新配置契约。

> Status date: 2026-05-20

## Verification Levels

| Level     | Meaning                              |
|-----------|--------------------------------------|
| `compile` | TypeScript 编译通过                  |
| `test`    | 单元测试通过                         |
| `smoke`   | 手动验证三种场景下配置读写正确       |
| `real`    | 实际多根工作区 + CLI 端到端验证      |

## Current Records

| Work package | Scope | Level | Command / Method | Result | Uncovered items |
|--------------|-------|-------|------------------|--------|-----------------|
| (pending) | | | | | |

## Historical Verification Conclusion

- 本矩阵只记录旧 `projects/` 方案，不代表新 workspace store 已完成。
- 新版本不读取旧配置，因此不再补做旧格式迁移验证。

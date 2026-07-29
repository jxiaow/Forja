# Verification Matrix

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

## Current Verification Conclusion

- Strongest verification so far: settingsIO 稀疏写入已通过 compile + test
- Biggest gap: 新路径方案尚未实施，无验证记录

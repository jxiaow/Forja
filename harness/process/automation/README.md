# Automation

本目录承载规则到自动检查的映射，以及后续候选检查项。

## Current Files

- `rule-to-check-map.md`
- `check-process.js` - harness core 流程检查，可随 `harness/process/` 迁移

项目专属检查不放在本目录；生成 adapter 后放在 `../project/local/automation/`。

## Quick Use

- 想知道某条规则是否适合自动化时，先看 `rule-to-check-map.md`
- 默认低成本收口时，优先运行 `node harness/process/automation/check-process.js --changed --summary --max-issues 3`
- 提交前暂存区流程检查入口是 `node harness/process/automation/check-process.js --staged --summary --max-issues 3`
- 想检查指定文件或目录时，运行 `node harness/process/automation/check-process.js --summary --max-issues 3 <path> [...]`
- 若目标仓库已在 `package.json` 配置 `process:check`，也可以用 `npm run process:check -- --changed`
- 想执行全量流程文档检查时，运行 `node harness/process/automation/check-process.js`
- 若项目 adapter 提供入口检查，可用项目定义的入口检查脚本检查当前工作区、暂存区或指定文件
- 想调整失败输出体积时，追加 `--max-issues <n>`
- 想只看失败规则统计时，追加 `--summary`
- 检查失败时，默认把完整详情写到 `.tmp/harness-check-report.json`

自动化层先接管低歧义、易遗漏、可重复的检查，不替代需求、设计和验证判断。

## Cost Control

- 默认检查当前变更集，不全仓扫描历史存量。
- lint-staged 使用暂存区模式，不读取未暂存文件。
- 检查失败时先看规则名和少量位置，再决定是否扩大检查。
- 检查默认只展示前 5 个问题，批量排查时再用 `--max-issues` 调高。
- 批量失败时优先用 `--summary` 看规则分布，再按规则或文件缩小范围。
- 终端输出保持短；需要定位时读取 `.tmp/harness-check-report.json` 或重跑指定文件检查。
- 全量 lint/test/build 只用于阶段收口、高风险改动或结论依赖全量结果时。

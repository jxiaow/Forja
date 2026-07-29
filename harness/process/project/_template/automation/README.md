# Project Automation

本目录只放项目专属自动检查。通用流程检查留在 `harness/process/automation/`。

## When To Add A Check

只有满足这些条件才新增脚本：

- 能从文件路径或 AST/文本规则稳定判断
- 误报成本低于人工漏检成本
- 检查范围可以收窄到 changed/staged/files
- 失败输出能用少量行定位问题

## Candidate Checks

迁移到新仓库时优先考虑：

- 新模块、命令、导出或扩展是否接入注册入口
- 受保护入口是否经过权限或授权边界
- 新依赖是否写入对应 package/workspace
- 高风险入口是否缺少最小验证说明

## Output Rules

- 支持 `--changed`
- 支持 `--staged`
- 支持 `--files <path> [...]`
- 支持 `--summary`
- 支持 `--max-issues <n>`
- 支持 `--report <path>`
- 默认报告路径使用 `.tmp/harness-check-report.json`

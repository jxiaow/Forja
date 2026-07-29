# 维护 AgentHarness

本文面向 harness 本身的维护者。只把 harness 复制到仓库中使用的普通用户，一般不需要阅读本文。

## 职责分层

规则应放在最窄且稳定的位置：

- `AGENTS.md`：仓库级硬约束、触发规则、红线和导航。
- `README.md`：高层项目介绍和快速开始。
- `docs/workflow-reference.md`：通用执行模型、任务尺寸和长周期工作流。
- `templates/`：每类任务的最小分析字段。
- `gates/`：阶段收口字段、示例和反例。
- `rules/`：可移植的实现和验证规则。
- `automation/`：通用流程检查。
- `project/`：仓库事实、业务链路、高风险路径和可替换的 adapter 内容。

## 维护检查表

维护 harness 时，需要检查：

- 模板触发、gate 顺序和工作流默认值是否一致
- 仓库专属事实是否留在 `project/` 或项目专属 rules 中
- 自动化映射表格是否能正常渲染
- Markdown 表格中包含 `|` 的正则是否已转义
- 新规则是否有人工判断点或候选自动检查

## 导出检查表

发布开源导出前：

1. 运行有针对性的流程检查。
2. 运行 harness 测试。
3. 用 `node harness/process/export-open-source.js --target <dir>` 导出。
4. 确认项目本地 adapter 内容没有被包含。
5. 确认 examples 和本地化 README 文件已包含。

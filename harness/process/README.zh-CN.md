# AgentHarness

AgentHarness 是一个给 AI coding agent 使用的可移植流程层。它让 agent 在直接动手改代码之前，先说明需求、选择设计方案、在项目规则内实现、验证结果，并输出清晰的交付收口。

它适合在真实仓库里使用 Codex、Claude Code、Gemini CLI 或自定义 coding agent 的团队。在这些仓库里，一句“直接改代码”经常会变成跳过上下文、重构半途而止、验证含糊，或文档变乱。

English README: [README.md](README.md)

## 为什么需要它

AI coding agent 很有用，但它们会以可预测的方式失败：

- 需求边界还没清楚就开始写代码。
- 做局部修复时违反项目架构。
- 把一个小工作包说成“已完成”，但更大的迁移仍然没结束。
- 把稳定文档、过渡计划和执行 checklist 混在同一个地方。
- 没说明实际运行了什么验证，就说某件事已经验证过。

AgentHarness 把这些失败模式收敛成一个小而可重复的工作流：

```text
Requirement -> Design -> Implementation -> Verification -> Delivery
```

重点不是增加仪式感，而是让 agent 的工作可审阅、可恢复，并且更不容易跑偏。

## 你会得到什么

- **任务模板**：覆盖 bug 修复、新功能、重构、UI 调整和跨模块改动。
- **阶段 gate**：强制 agent 记录范围、设计、实现、验证和交付。
- **Autopilot 规则**：gate 是过程记录，不是审批暂停点。
- **项目适配层**：记录仓库事实、高风险路径和本地规则。
- **运行态文档**：承接长周期迁移和整改工作。
- **轻量流程检查**：发现 Markdown 结构问题和已知 harness 规则问题。

## 30 秒示例

没有流程层时：

```text
User: Fix the deployment page bug.
Agent: I changed three files. It should work now.
```

使用 AgentHarness 时：

```text
Task type
Bug

Requirement gate
- Symptom: deployment page fails when the selected host is missing.
- Boundary: keep API shape and routing unchanged.
- Expected behavior: show an actionable empty state.
- Verification: targeted unit test and smoke path.

Design gate
- Fix point: normalize missing host state in the store, not inside the component.
- Risk: host selection is shared by deployment and branch flows.
- Rules: preserve Pinia state path and existing router entry.

Verification gate
- `npm run test:unit -- deploy-host-selection`: pass
- Manual smoke: deployment page empty state renders
- Not covered: real SSH connection
```

agent 仍然可以快速推进，但 reviewer 能看到它理解了什么、改了什么、以及什么没有验证。

更多示例：

- [Bug fix gate output](examples/bug-fix-gate-output.md)
- [Long-running remediation board](examples/long-running-remediation.md)

## 快速开始

把这个目录复制到你的仓库中：

```text
your-repo/
└── harness/
    └── process/
```

在仓库根目录创建或更新 `AGENTS.md`。可以从这个模板开始：

```text
harness/process/AGENTS.template.md
```

生成项目适配层：

```bash
node harness/process/project/create-adapter.js --target harness/process/project/local --name "Local Project Adapter"
```

把你的仓库事实填到适配层里：

- `harness/process/project/local/local.md`
- `harness/process/project/local/rules/`
- 可选：`harness/process/project/local/automation/`

要求 agent 遵循 harness。一个最小的根目录 `AGENTS.md` 可以这样写：

```md
# AGENTS.md

Use `harness/process/` as the development workflow.

Before editing code:
- classify the task
- output Requirement gate
- output Design gate
- read the relevant rules

After editing:
- output Implementation gate
- run necessary verification
- output Verification and Delivery gates
```

## 可选 npm Scripts

只有把包装命令加到你自己的 `package.json` 后，`npm run ...` 才能使用。

```json
{
  "scripts": {
    "process:check": "node harness/process/automation/check-process.js",
    "harness:ops:init": "node harness/process/operations/create-operation-docs.js",
    "harness:create-adapter": "node harness/process/project/create-adapter.js"
  }
}
```

之后可以运行：

```bash
npm run process:check
npm run harness:ops:init -- desktop-restructure
npm run harness:create-adapter -- --target harness/process/project/local --name "Local Project Adapter"
```

## 核心模型

AgentHarness 有两层：

- **Core**：模板、gate、规则、运行态工作流和检查，可在不同仓库之间复用。
- **Project adapter**：仓库专属事实，例如模块边界、高风险文件、本地命令和领域规则。

不要把业务事实放进 core。把它们放进 `project/local/`，这样 harness 才能复制到另一个仓库，而不会携带上一个仓库的架构。

## 仓库结构

```text
harness/process/
├── AGENTS.template.md
├── README.md
├── README.zh-CN.md
├── automation/
├── docs/
├── examples/
├── gates/
├── operations/
├── project/
├── rules/
└── templates/
```

## 更多文档

- [Workflow reference](docs/workflow-reference.md)
- [Maintaining AgentHarness](docs/maintaining.md)
- [中文工作流参考](docs/workflow-reference.zh-CN.md)
- [中文维护说明](docs/maintaining.zh-CN.md)

## License

MIT. See [LICENSE](LICENSE).

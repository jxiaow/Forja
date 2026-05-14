# 工作流参考

本文包含 AgentHarness 的详细流程规则。根 README 保持简短；把 harness 接入真实仓库时，再阅读本文。

## 默认工作流

对每个任务，agent 应该：

1. 从 `templates/` 选择最接近的模板。
2. 判断任务尺寸：`tiny`、`normal` 或 `long-running`。
3. 输出 Requirement gate。
4. 输出 Design gate。
5. 阅读相关 `rules/` 和项目规则。
6. 实现改动。
7. 输出 Implementation gate。
8. 运行必要验证。
9. 输出 Verification gate。
10. 输出 Delivery gate。

默认情况下，gate 不是审批检查点。如果没有真实阻塞，agent 记录 gate 后继续执行。

## 任务尺寸

| Size | 适用场景 | 额外要求 |
| ---- | -------- | -------- |
| `tiny` | 单文件文案、样式或局部配置改动 | 仍要输出 Requirement 和 Design gate |
| `normal` | 常规 bug、新功能、重构或 UI 调整 | 实现前阅读相关规则 |
| `long-running` | 仓库结构、workspace、迁移或多阶段整改 | 实现前创建 `docs/operations/<initiative>/` 文档 |

## 执行模型

AgentHarness 默认按 autopilot 执行：

1. 没有真实阻塞时，agent 从需求和设计继续推进到实现、验证和交付。
2. Requirement 和 Design gate 必须在实现前输出。它们是过程记录，不是审批暂停点。
3. 长周期或多阶段任务必须在实现前创建阶段级 todo、checklist 和执行顺序。
4. 完成一个工作包不等于 final closeout。agent 应继续推进下一个可执行事项。
5. “继续”、“开始”、“接着做”默认表示继续当前活动阶段。
6. 只有当前目标完成或出现真实阻塞时，才允许 final closeout。
7. 持久化决策可以写入 `docs/development/changes/`，但只应在阶段收口、高风险工作完成后，或用户明确要求时写入。
8. 外部技能或计划工具不应放大流程输出；将它们的结果折叠进 harness gate，除非有真实阻塞，否则继续推进。

真实阻塞只包括：

- 命令需要用户授权
- 继续执行会覆盖或破坏已有工作
- 需求变化导致继续执行会明显偏离目标
- 缺少关键输入，且无法从仓库自行判断

## 收口规则

final closeout 前，agent 必须判断当前目标类型：

- `single-task`：有边界的任务；只有请求结果和必要验证完成后才能收口。
- `staged/ongoing`：长周期整改、迁移或多阶段工作；只有当前阶段没有可执行剩余项，或出现真实阻塞时才能收口。
- `continuation`：用户说“继续”、“开始”、“接着做”等；继承当前活动阶段并继续下一项。
- `explicit-closeout`：用户要求总结、停止或收口；报告当前已验证状态。

如果 `docs/operations/<initiative>/` 下存在活动执行板或 checklist，agent 必须在 final closeout 前读取它，并确认最高优先级可执行项已经推进。

## 长周期工作

对于迁移、仓库重构或连续整改，先创建一个 operations 工作区：

```bash
node harness/process/operations/create-operation-docs.js <initiative>
```

这会创建：

```text
docs/operations/<initiative>/
├── current-<initiative>.md
├── <initiative>-board.md
├── <initiative>-matrix.md
└── <initiative>-decisions.md
```

把这些文件作为以下内容的事实来源：

- 阶段目标
- 工作包顺序
- backlog 状态
- 验证矩阵
- 决策和重开条件

一个工作包完成，不等于整个任务完成。除非阶段完成或出现真实阻塞，否则 agent 应该继续推进下一个最高优先级事项。

## 长周期整改工作流

仓库结构调整、workspace 改动、包重命名、应用入口重命名、迁移和多阶段整改，都使用这个工作流。

实现前：

1. 创建或复用 `docs/operations/<initiative>/`。
2. 写清阶段级 todo/checklist、执行顺序、非目标和第一个工作包。
3. 更新执行板，明确当前最高优先级工作包。

每个工作包应记录：

- `ID`
- 目标
- 范围
- 风险
- 验证方式
- 完成标准
- 前置依赖
- 状态

工作包完成后：

1. 更新执行板。
2. 更新验证矩阵。
3. 如果决策、暂缓项或重开条件变化，同步记录。
4. 除非阶段完成或出现阻塞，否则继续推进下一项。

## 文档放置

使用两层文档：

- `docs/development/`：稳定架构、模块、环境搭建和长期维护文档。
- `docs/operations/`：临时执行文档，例如计划、执行板、checklist、验证矩阵和迁移状态。

不要把过渡 checklist 和阶段决策长期混在稳定开发文档里。

## 精简输出规则

agent 默认输出应该保持紧凑：

- 起手一句话说明目标和第一步动作。
- 任务类型单独成行。
- Requirement 和 Design gate 保持短列表。
- 不要把 gate 当作暂停点。
- 如果更大的目标仍有工作，不要因为单个工作包完成就输出 final closeout。
- final closeout 中区分已完成内容、验证、未验证项和真实剩余风险。

## 精简执行默认值

默认命令和上下文使用应保持小范围：

1. 只搜索目标路径，并排除 `target/`、`node_modules/`、`dist/` 等生成输出。
2. 尽量只对当前任务相关路径运行 `git status`。
3. 先定位再读取文件窗口，不整段通读大文件。
4. 截断长输出，只保留决策所需内容。
5. 优先使用 changed-file 流程检查；只有结论依赖更大范围检查时，才运行全量 lint/test。
6. 如果必须运行大范围检查，在 Verification gate 说明原因和范围。

详情见 [../rules/token-efficiency.md](../rules/token-efficiency.md)。

## 验证

对于常规改动，优先使用有针对性的检查：

```bash
node harness/process/automation/check-process.js --changed --summary --max-issues 5
```

开发 harness 本身时，运行 harness 测试：

```bash
npm run harness:test
```

流程检查不是业务测试。它只证明 harness 可见的流程文件通过了当前已实现的检查。

### 本地 dev server 与浏览器验证

前端改动不默认启动本地 dev server。只有当验证结论依赖真实浏览器运行态时才启动，例如新页面、大幅 UI 改版、响应式/交互/路由问题、需要截图，或用户明确要求预览。

小范围文案、间距、颜色变量、静态样式契约或纯逻辑改动，默认使用静态检查、单元测试、契约测试或构建验证，不主动占用端口。

如果确实需要启动服务，agent 应先说明目的、命令和预计端口；启动后给出 URL。收口前确认是否停止服务，或说明为什么需要保留。端口冲突时只做一次合理切换，并清理失败启动留下的残留进程。

服务启动本身不等于浏览器验证。Verification gate 必须写清实际检查过的路径、视口、状态和未覆盖项。

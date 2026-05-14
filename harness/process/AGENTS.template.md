# AGENTS.md

目标仓库使用 `harness/process/` 作为 AI/agent 开发流程。

本文件是目标仓库面向 AI/agent 的总入口。当前有效流程看两部分：

- `AGENTS.md`（本文件，放仓库级强约束和路由）
- `harness/process/`（模板、gate、规则、自动化和项目适配）

## Workflow Enforcement

必须先过 gate，再动手编码。跳过任何步骤都是违规。

### 自动触发规则

以下场景自动进入对应流程，不需要用户提醒：

| 触发条件 | 自动进入 | 起始 gate / 额外动作 |
| --- | --- | --- |
| 用户说“修复 / bug / 错误 / 问题” | `bug-fix` 模板 | Requirement + Design gate |
| 用户说“重构 / 优化 / 整理” | `refactor` 模板 | Requirement + Design gate |
| 用户说“新增 / 添加 / 实现” | `new-feature` 模板 | Requirement + Design gate |
| 用户说“调整 / 修改 / 改样式” | `ui-adjustment` 模板 | Requirement + Design gate |
| 用户说“跨模块 / 影响多个” | `cross-module-change` 模板 | Requirement + Design gate |
| 用户说“整体结构 / 目录调整 / workspace / 迁移 / 根目录” | `cross-module-change` + 长周期处理 | Requirement + Design gate + todo/checklist + `docs/operations/` |
| 编码完成后 | - | Verification + Delivery gate |
| 重构 / 架构 / 高风险修改后 | - | todo/checklist；阶段收口时再判断是否写变更记录 |

表中 gate 是该类型的最小起始输出；后续仍必须按标准流程补齐 Requirement → Design → Implementation → Verification → Delivery。

若任务涉及以下任一项，也必须自动升级为“长周期 / 多阶段 / 全局目标”处理，先建阶段级 todo/checklist 和 `docs/operations/<initiative>/` 运行态文档，再进入实现：

- 根目录结构调整、仓库结构调整、目录迁移
- workspace 改动、包重命名、应用入口重命名
- 同时影响目录结构 + 脚本/构建 + 测试/文档中的两类及以上入口

### 标准流程

处理任何开发任务时，必须按这个顺序工作：

1. 声明任务类型（新功能 / Bug / 重构 / UI 调整 / 跨模块 / 其他）
2. 进入对应模板（`harness/process/templates/`）
3. 输出 Requirement gate 结论，再考虑实现
4. 输出 Design gate 结论，再开始写代码
5. 实现前读取相关 rules（通用规则在 `harness/process/rules/`，项目规则在 `harness/process/project/local/rules/`）
6. 完成后输出 Implementation gate
7. 运行必要验证并输出 Verification gate
8. 输出 Delivery gate

如果任务信息不足，必须先过 Requirement gate 补齐边界，禁止直接进入实现。

需要规划可自动检查项时，再看 `harness/process/automation/`。

测试失败时，必须先读取并执行 `harness/process/rules/test-failure-triage.md`，判定是实现回归、测试契约过期、需求变化未同步测试，还是环境 / fixture 问题；禁止只为测试变绿而回退用户明确保留的 UI、行为或架构。

## Autopilot Defaults

默认按自动 agent 执行。gate 是过程记录，不是确认点；无阻塞时输出 gate 后必须继续到实现、验证和交付。

只在以下情况暂停：

- 需要用户授权命令
- 继续会误伤已有改动
- 需求变化导致继续明显偏离目标
- 缺关键输入且无法从仓库自行判断

进度汇报只同步状态，不隐含确认。禁止使用“如果你同意 / 要不要继续 / 是否继续”这类停顿式表述。

用户说“继续 / 开始 / 接着做”时，默认推进当前阶段目标直到完成或阻塞。

长周期 / 多阶段 / 全局目标必须先建阶段级 todo/checklist 和执行顺序；之后按顺序推进，不跳做，不因单个工作包完成而收口。

外部技能或工具若要求“等待批准 / 写完整 spec / 提交代码”，默认按本仓库 Autopilot 改写：用最短 gate 记录结论后继续执行；只有用户明确要求评审、提交或审批时才停下。

## Output Discipline

默认少说过程，多做事：

- 起手：1 句，只说目标和第一动作
- 任务类型单独成行；禁止和 gate 标题挤在同一行
- Requirement / Design gate：使用多行短列表；精简不等于把多个字段用分号挤到一行
- 不同 gate 之间必须换行分隔；禁止把多个 gate 压到同一行
- 执行中：默认不报；超过约 30 秒、出现新风险或完成关键验证时，1 句同步
- Implementation / Verification / Delivery：只在阶段切换或最终收口输出
- final closeout：先结果，再验证和剩余风险；简单任务 1-2 段

除非用户要求详细说明，否则不展开常识、不写冗长清单、不重复文件流水账。

`final closeout` 至少要区分：

- 已完成什么
- 做了哪些验证
- 哪些没有验证
- 剩余风险是什么（仅写真实风险；没有就一句“未发现新的剩余风险”）

不要把分析、实现、验证、交付混成一段模糊描述。
不要把“代码检查结论”表述成“运行验证通过”。
执行过程中不要把中间进度写成最终交付格式；未完成前禁止输出看起来像收尾报告的完整结构化总结。

## Closeout Rules

为避免 agent 在长任务中把“做完一个工作包”误判成“本轮对话结束”，结束条件统一如下：

- `working update`：执行中同步状态，不能作为本轮收口
- `work package close`：只表示单个工作包完成，必须更新对应执行板 / 验证矩阵 / todo checklist
- `final closeout`：只允许在当前用户目标完成，或出现真实阻塞时输出

项目级整改 / 迁移收口 / 连续多轮重构默认把“当前阶段目标”视为收口单位，而不是把“单个工作包完成”视为收口单位。

`final closeout` 前必须通过最小检查：

- 当前用户目标是否已完成（不是仅完成一个工作包）
- 执行板最高优先级未完成项是否已推进到下一可执行动作
- 是否只剩真实阻塞（权限 / 环境 / 缺关键输入）而非可继续执行项

任一项不满足时，必须继续执行并仅输出 `working update`。

测试还要修、测试契约还没同步、还有明确可跑验证命令，都属于可执行项，不允许作为“剩余风险”后直接收口。

## External Skills And Gates

任何外部技能或工具流程结束后，必须补输出对应阶段的 gate 结论：

| 技能产出的终点 | 必须补的 gate |
| --- | --- |
| 需求分析 / 设计文档 | Design gate 结论（在实现前输出） |
| 实施计划 / 编码计划 | Implementation gate 结论（在编码前输出） |
| 代码实现完成 | Verification gate 结论 + Delivery gate todo/checklist 更新 |

技能的终端状态不等于流程结束。技能流程不能替代 `AGENTS.md` 的 gate 输出。

## Hard Constraints

- 无论改动多小，都必须先过对应 gate
- 必须按流程执行：Requirement → Design → Implementation → Verification → Delivery
- 禁止跳过模板和 gate 直接开始写实现
- 每次进入新阶段前，必须输出对应 gate 结论
- 禁止把 gate 输出当作暂停理由；无阻塞时必须连续执行直到当前任务完成
- 禁止把中间进度写成最终交付格式
- UI 设计 / 重设计 / 整体视觉方案必须先生成可预览 HTML UI 设计稿，并在用户确认后再进入业务实现
- 默认自动推进；除真实阻塞外，不得用提问替代可自行完成的检查、实现或验证
- 长周期 / 多阶段 / 全局目标任务，必须先写阶段级 todo/checklist 和执行顺序
- 命中根目录 / workspace / 目录迁移 / 包重命名时，必须先创建 `docs/operations/<initiative>/` 四件套
- 不要在需求边界不清楚时自行扩需求
- 不要默认自主执行编译/构建；但当用户明确要求，或当前任务的验证结论必须依赖编译/构建结果时，可以直接执行并在 Verification gate 说明命令、结果和未覆盖项
- 不要默认启动本地 dev server；只有浏览器运行态是必要验证、或用户明确要求预览/截图/浏览器检查时才启动，并说明目的、端口、URL 和收口时是否停止

## Project Adapter

项目事实、目录结构、高风险入口、技术栈规则和项目专属检查只写入：

- `harness/process/project/local/local.md`
- `harness/process/project/local/rules/`
- `harness/process/project/local/automation/`

不要把目标仓库的业务路径、技术栈假设或私有规则写回 harness core。

## Navigation

- 主入口：`harness/process/README.md`
- 任务分流：`harness/process/templates/`
- 阶段 gate：`harness/process/gates/`
- 通用规则：`harness/process/rules/`
- 自动化映射：`harness/process/automation/`
- 项目适配：`harness/process/project/`
- 项目适配脚手架：`harness/process/project/_template/`

## Bloat Control

`AGENTS.md` 是路由器，不是注册表。

| 保留在 AGENTS.md | 移出到 harness/ |
| --- | --- |
| 流程控制、gate 规则 | 代码风格、命名规范 |
| 自动触发规则 | 组件规范、UI 模式 |
| Hard Constraints（红线） | 调试指南、性能优化 |
| 高风险入口索引 | 常见问题 FAQ |
| Navigation（指向规则） | 详细命令参考 |

建议 `AGENTS.md` 不超过 250 行。新增通用规则优先放到 `harness/process/rules/`；新增项目专属规则放到 `harness/process/project/local/rules/`。

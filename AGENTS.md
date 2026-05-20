# AGENTS.md - Compilot 开发指南

## 本文件是当前仓库面向 AI/agent 的总入口。流程层：`harness/core/`（通用）+ `harness/project/`（项目专属）。

## Workflow Enforcement

**必须先过 gate，再动手编码。跳过任何步骤都是违规。**

### 自动触发规则（不需要用户提醒）

以下场景**自动进入**对应流程，禁止跳过：

| 触发条件                                        | 自动进入                         | 起始 gate / 额外动作                                            |
| ----------------------------------------------- | -------------------------------- | --------------------------------------------------------------- |
| 用户说"修复/bug/错误/问题"                      | bug-fix 模板                     | Scope + Build gate                                              |
| 用户说"重构/优化/整理"                          | refactor 模板                    | Scope + Build gate                                              |
| 用户说"新增/添加/实现"                          | new-feature 模板                 | Scope + Build gate                                              |
| 用户说"调整/修改/改样式"                        | ui-adjustment 模板               | Scope + Build gate                                              |
| 用户说"跨模块/影响多个"                         | cross-module-change 模板         | Scope + Build gate                                              |
| 用户说"整体结构/目录调整/workspace/迁移/根目录" | cross-module-change + 长周期整改 | Scope + Plan gate + todo/checklist + `docs/operations/`         |
| 编码完成后                                      | —                                | Build + Close gate                                              |

**关键规则：** 以上触发不需要用户提醒，识别到关键词就必须自动进入对应流程。

若任务涉及以下任一项，也必须**自动升级**为"长周期 / 多阶段 / 全局目标"处理：

- 根目录结构调整、仓库结构调整、目录迁移
- workspace 改动、包重命名、应用入口重命名
- 同时影响目录结构 + 脚本/构建 + 测试/文档中的两类及以上入口

### 标准流程

```
Scope → [Plan] → Build → Close
```

1. 声明任务类型（新功能 / Bug / 重构 / UI 调整 / 跨模块 / 其他）
2. 输出 Scope gate（解决什么、怎么改、boundary、风险、怎么验证）
3. （仅长任务）输出 Plan gate，建运行态工作区
4. 实现前补看相关规则（`harness/core/rules/` + `harness/project/rules/`）
5. 实现
6. 输出 Build gate（实际改了什么，是否偏离 Scope）
7. 验证；输出 Close gate

如果任务信息不足，必须先过 Scope gate 补齐边界，**禁止**直接进入实现。

### Autopilot 默认规则

默认按自动 agent 执行。gate 是过程记录，不是确认点；无阻塞时输出 gate 后必须继续到实现、验证和交付。

只在以下情况暂停：需要用户授权命令；继续会误伤已有改动；需求变化导致继续明显偏离目标；缺关键输入且无法从仓库自行判断。

禁止使用"如果你同意 / 要不要继续 / 是否继续"这类停顿式表述。

长周期 / 多阶段 / 全局目标必须先建阶段级 todo/checklist 和执行顺序；之后按顺序推进。

### 默认精简输出

- 起手：1 句，只说目标和第一动作
- Gate：多行短列表；不同 gate 之间换行分隔
- 执行中：默认不报；关键节点 1 句同步
- Close gate：结果 → 已验证 → 未验证 → 风险

### 结束条件定义

- `working update`：执行中同步状态，不能作为本轮收口
- `work package close`：单个工作包完成
- `final closeout`：只允许在当前用户目标完成，或出现真实阻塞时输出

---

## Hard Constraints

- **无论改动多小**，都**必须**先过对应 gate
- **禁止**跳过模板和 gate 直接开始写实现
- **禁止**把 gate 输出当作暂停理由
- **默认自动推进**；除真实阻塞外，不得用提问替代可自行完成的动作
- 长周期任务**必须先写阶段级 todo/checklist**
- 命中根目录 / workspace / 目录迁移时，**必须先创建 `docs/operations/<initiative>/`**
- 不修改 `extension.ts` 的 activate 函数签名或导出
- 不删除或重命名现有 VSCode 命令 ID（可新增别名命令，旧 ID 必须保留并正常工作）
- 不修改 `package.json` 中已发布的 `activationEvents`
- 不把平台相关逻辑写进 `shared/`（shared 必须不依赖 vscode）
- 不在 CLI 模块中引入 `vscode` 依赖
- 不在 Qt 模块中使用 `vscode.workspace.getConfiguration`（应走 settingsStore）
- 不在 SDK 模块中使用 Qt 的 settingsStore（应走 vscode settings）
- 不让 `sdk/` 和 `qt/` 之间产生直接 import 依赖
- 新增命令后同步 `package.json` contributes 和 `extension.ts` 注册
- 新增配置项后同步 `package.json` configuration（SDK）或 `core/settingsIO.ts`（Qt）
- 打包必须用 `npm run package:all`，禁止用 compile 替代
- 不默认自主执行编译/构建（除非验证必须依赖）
- 测试失败时先执行 `harness/core/rules/test-failure-triage.md`

## Output Discipline

`final closeout` 至少区分：已完成什么、做了哪些验证、哪些没有验证、剩余风险。

---

## Navigation

| 内容 | 路径 |
| --- | --- |
| 项目配置 | `harness/project/profile.md` |
| 项目规则 | `harness/project/rules/` |
| 任务模板 | `harness/core/templates/` |
| 阶段 gate | `harness/core/gates/` |
| 通用规则 | `harness/core/rules/` |
| 自动化 | `harness/core/automation/` |
| 运行态文档模板 | `harness/core/operations/` |

通用规则：
- `token-efficiency.md` — 低 token 执行与最小化命令范围
- `test-failure-triage.md` — 测试失败分流

项目规则：
- `architecture-dependencies.md` — 架构分层、依赖方向
- `typescript-standards.md` — TypeScript 编码规范
- `module-communication.md` — 模块通信、状态管理
- `vscode-extension-patterns.md` — VSCode 扩展开发模式
- `platform-abstraction.md` — 平台抽象、跨平台策略
- `build-and-package.md` — 构建打包命令约束

常见阅读组合：

- 新功能开发：`new-feature` + `architecture-dependencies` + `vscode-extension-patterns`
- Bug 修复：`bug-fix` + `module-communication` + `typescript-standards`
- 重构：`refactor` + `architecture-dependencies` + `typescript-standards`
- 跨模块改动：`cross-module-change` + `architecture-dependencies` + `module-communication`
- 平台相关：`new-feature` + `platform-abstraction` + `architecture-dependencies`
- CLI 相关：`new-feature` + `architecture-dependencies` + `build-and-package`

---

## 膨胀控制

AGENTS.md 是路由器，不是注册表。**硬限制：不超过 250 行。** 新增通用规则放 `harness/core/rules/`；项目专属规则放 `harness/project/rules/`。

---

_更新时间: 2026-05-20_

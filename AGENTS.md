# AGENTS.md - Compilot 开发指南

## 本文件是当前仓库面向 AI/agent 的总入口。流程层：`harness/core/`（通用）+ `harness/project/`（项目专属）。

## Workflow Enforcement

**必须先过 gate，再动手编码。跳过任何步骤都是违规。**

### 自动触发规则（不需要用户提醒）

触发判定基于**实际改动范围**，不基于用户措辞。每次动手前评估：

| 改动范围 | 分类 | 流程 |
| --- | --- | --- |
| 单文件、≤15 行、不改接口/类型/导出 | Patch | 直接执行，无 gate |
| 多文件、改接口、改数据结构、新命令/协议、跨目录 | Task | Scope → Solution → Build → Close |

累积升级（同一会话内满足任一即升级为 Task）：
- 改动文件 ≥ 5 个
- 修改了 interface / type / export 签名
- 跨越 ≥ 2 个顶层 src/ 目录
- 变更了存储数据格式

详见 `harness/core/rules/iterative-scope-control.md`。

Task 分类参考（用于 Scope gate 的 task type 字段）：

| 场景特征 | 任务类型 | 参考模板 |
| --- | --- | --- |
| 修复已有功能的错误 | bug-fix | `templates/bug-fix.md` |
| 新增功能或入口 | new-feature | `templates/new-feature.md` |
| 不改行为只改结构 | refactor | `templates/refactor.md` |
| 视觉/交互调整 | ui-adjustment | `templates/ui-adjustment.md` |
| 跨多个模块的改动 | cross-module | `templates/cross-module-change.md` |

若任务涉及以下任一项，也必须**自动升级**为"长周期 / 多阶段 / 全局目标"处理：

- 根目录结构调整、仓库结构调整、目录迁移
- workspace 改动、包重命名、应用入口重命名
- 同时影响目录结构 + 脚本/构建 + 测试/文档中的两类及以上入口

### 标准流程

```
Scope → Solution → [Plan] → Build → Close
```

1. 声明任务类型（新功能 / Bug / 重构 / UI 调整 / 跨模块 / 其他）
2. 输出 Scope gate（解决什么、怎么改、boundary、风险、怎么验证）
3. 输出 Solution gate（目标行为、选定方案、对外影响面、兼容性、验证影响）
4. （仅长任务）输出 Plan gate，建运行态工作区
5. 实现前补看相关规则（`harness/core/rules/` + `harness/project/rules/`）
6. 实现
7. 输出 Build gate（实际改了什么，是否偏离 Scope/Solution）
8. 验证；输出 Close gate

如果任务信息不足，必须先过 Scope gate 补齐边界，**禁止**直接进入实现。
如果 Solution gate 涉及 CLI/API/输出协议/配置语义/用户流程/已有入口行为变化，且该精确方向尚未被用户批准，**必须暂停等待确认**。

### Autopilot 默认规则

默认按自动 agent 执行。gate 默认是过程记录，不是确认点；无阻塞且无未批准公开行为方案时，输出 gate 后必须继续到实现、验证和交付。

只在以下情况暂停：需要用户授权命令；继续会误伤已有改动；需求变化导致继续明显偏离目标；缺关键输入且无法从仓库自行判断；Solution gate 暴露了尚未批准的公开行为方案。

禁止使用"如果你同意 / 要不要继续 / 是否继续"这类停顿式表述。

长周期 / 多阶段 / 全局目标必须在 Solution gate 后先建阶段级 todo/checklist 和执行顺序；之后按顺序推进。

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

- **Task 级改动必须**先过 Scope gate 和 Solution gate 再实现；Patch 级可直接执行
- **禁止**把 gate 输出当作暂停理由，除非 Solution gate 涉及未批准的公开行为方案
- **累积升级不可逆**：同一会话内一旦触发，后续全部按 Task 处理
- **默认自动推进**；除真实阻塞外，不得用提问替代可自行完成的动作
- 长周期任务**必须在 Solution gate 后先写阶段级 todo/checklist**
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
- `iterative-scope-control.md` — 迭代式对话的范围控制与累积升级

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

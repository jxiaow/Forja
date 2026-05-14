# Rule To Check Map

## Goal

把 development process harness 中的规则按"可自动检查程度"分类，给后续工具化落地提供最小映射。

## Categories

- `fully-automatable`
  - 规则边界清楚，可直接用脚本或 ESLint 实现
- `semi-automatable`
  - 可自动发现疑点，但仍需人或 AI 判断
- `human-ai-judgment`
  - 依赖语义理解，不适合做强制自动卡口

## Current Mapping

`Process` 行属于 harness core，默认随 `harness/process/` 迁移。项目入口、接口契约、样式、构建等规则属于 project adapter；迁移到其他仓库时应替换这些行和对应脚本。

| Rule Area     | Example Rule                            | Type              | Notes                                                        |
| ------------- | --------------------------------------- | ----------------- | ------------------------------------------------------------ |
| Code Style    | 格式化规则                              | fully-automatable | 复用项目 formatter                                           |
| Code Style    | 静态检查规则                            | fully-automatable | 复用项目 lint/typecheck                                      |
| Entry Points  | 新能力已接入注册入口                    | semi-automatable  | 扫描项目定义的命令、导出、路由、插件或构建入口               |
| Interfaces    | 公共接口未被意外删除或改名              | semi-automatable  | 扫描导出、命令、事件、配置或 schema 差异                     |
| Data Access   | 上层不直接操作底层存储实现              | semi-automatable  | 扫描项目定义的边界和禁止依赖                                 |
| Error Model   | 错误返回或退出码使用统一模型            | semi-automatable  | 扫描手写错误响应、退出码或异常模式                           |
| Style System  | 样式不绕过项目 token                    | semi-automatable  | 仅适用于有 UI/样式系统的项目                                 |
| Build         | 新文件已接入构建或发布入口              | semi-automatable  | 需文件差异扫描                                               |
| Architecture  | 禁止反向依赖                            | human-ai-judgment | 需人工判断依赖方向                                           |
| Communication | 通信方式选择                            | human-ai-judgment | 需人工判断                                                   |
| Requirement   | 需求边界是否清楚                        | human-ai-judgment | 依赖上下文理解                                               |
| Design        | 方案是否合理                            | human-ai-judgment | 依赖架构权衡                                                 |
| Verification  | 验证是否充分                            | human-ai-judgment | 依赖任务语义                                                 |
| Process       | `in_progress` 阶段禁止 `final closeout` | semi-automatable  | 扫描执行板状态与交付文本关键字                               |
| Process       | 未完成时必须有下一动作或阻塞说明        | semi-automatable  | 扫描执行板的 `next action`/`block reason` 字段               |
| Process       | 收口必须带证据锚点                      | semi-automatable  | 扫描结果 / 验证命令 / 未验证项 / 风险                        |
| Process       | 非阻塞下一步不能写进 final closeout     | semi-automatable  | 扫描 final closeout 中的下一步建议                           |
| Process       | 下一步不能成为 final closeout 必填项    | semi-automatable  | 扫描把下一步写成收口必填字段的表述                           |
| Process       | 无真实风险时禁止输出风险样板话          | semi-automatable  | 扫描未验证项和风险的空值组合                                 |
| Process       | 任务类型和多个 gate 输出必须换行分隔    | semi-automatable  | 扫描同一行出现任务类型 + gate 或多个 gate 标记               |
| Process       | 进行中默认维护 checklist                | semi-automatable  | 扫描 checklist 更新与收口时机                                |
| Process       | 长周期任务先写阶段级 todo 和执行顺序    | semi-automatable  | 扫描阶段计划 / 顺序字段 / 当前阶段锚点                       |
| Docs          | 运行态文档不混放到 development          | semi-automatable  | 扫描执行板/矩阵/决策类文档所在目录                           |
| Git           | 提交信息格式正确                        | semi-automatable  | 正则匹配 `<type>: <message>` 格式                            |
| Git           | 不提交敏感文件                          | semi-automatable  | 扫描 `.env`, `credentials`, `*.pem`                          |
| Git           | 不提交无关文件                          | semi-automatable  | 扫描 `*.log`, `node_modules/`, 临时文件                      |
| Git           | 分支命名符合规范                        | semi-automatable  | 正则匹配 `feature/<name>`、`fix/<name>` 或 `refactor/<name>` |
| Git           | 提交粒度合理                            | human-ai-judgment | 需判断改动是否相关                                           |
| Git           | 提交信息有意义                          | human-ai-judgment | 需语义理解判断 message 质量                                  |

## Candidate Checks

### Fully Automatable

- 项目 formatter 检查
- 项目 lint/typecheck 检查
- 新增文件是否加入对应入口或注册表

上面这些检查默认都应支持排除：

- `node_modules/`
- 与当前 diff 无关的历史存量文件

### Semi Automatable

- 扫描跨模块改动是否同时触发多个高层目录修改
- 扫描执行中状态是否缺少下一动作或阻塞说明
- 扫描 `final closeout` 是否出现在 `in_progress` 状态下
- 扫描 `final closeout` 是否包含结果、最近验证命令、未验证项和风险
- 扫描 `final closeout` 是否夹带非阻塞下一步建议
- 扫描文档是否把下一步写成 `final closeout` 必填项
- 扫描 `final closeout` 是否用“无未验证项 + 无风险”凑样板
- 扫描同一行是否出现任务类型 + gate 或多个 gate 输出标记
- 扫描长周期任务是否先出现阶段级 todo/checklist 与顺序字段
- 扫描运行态文档是否错误放在 `docs/development/`
- 扫描新增文件是否接入项目定义的入口
- 扫描上层模块是否直接依赖项目定义的底层实现
- 扫描公共接口、命令、事件或配置是否被意外删除
- 扫描错误响应、退出码或异常模型是否绕过项目统一模式
- 扫描提交信息是否符合 `<type>: <message>` 格式
- 扫描暂存区是否有 `.env`, `credentials`, `*.pem`, `*.key` 文件
- 扫描暂存区是否有 `*.log`, `node_modules/`, 临时文件
- 扫描分支名是否符合 `feature|fix|refactor/<name>` 格式

### Human / AI Judgment

- 判断需求边界是否清晰
- 判断设计方案是否符合既有模式
- 判断验证覆盖是否足够
- 判断重构是否真正改善边界
- 判断跨模块改动是否破坏职责分层
- 判断项目入口接入方式是否正确
- 判断模块组织方式是否合理
- 判断多个改动是否应该拆分提交（提交粒度）
- 判断提交信息是否真正描述了改动内容（语义质量）
- 判断是否应该创建新分支或在现有分支上继续

## Automation Rollout

自动化按低成本、低歧义、易遗漏的顺序落地。

默认成本策略：日常使用 `node harness/process/automation/check-process.js --changed --summary --max-issues 3`；只在阶段收口或高风险入口中扩大到全量 lint/test/build。

显式目标：需要覆盖 git diff 之外的文件或目录时，运行 `node harness/process/automation/check-process.js --summary --max-issues 3 <path> [...]`。

输出预算：检查默认只展示前 5 个问题；需要更多时追加 `-- --max-issues <n>`。

摘要模式：批量失败时追加 `-- --summary`，只看各规则命中数量。

详细报告：默认失败详情写入 `.tmp/harness-check-report.json`，终端只保留摘要。

### Phase 0: Process Checks

这些检查最先落地，因为它们能直接降低 agent 误收口和跳步概率：

当前入口：

- 工作区：`npm run process:check -- --changed`
- 暂存区：`npm run process:check -- --staged`
- 全量文档：`npm run process:check`

1. `final closeout` 是否包含结果、最近验证命令、未验证项和风险
2. `in_progress` 阶段是否错误输出 `final closeout`
3. `final closeout` 是否夹带非阻塞下一步建议
4. 文档是否把下一步写成 `final closeout` 必填项
5. `final closeout` 是否用无风险样板话填充格式
6. 同一行是否出现任务类型 + gate 或多个 gate 输出标记
7. `long-running` 任务是否先出现阶段级 todo/checklist、执行顺序和当前工作包
8. 运行态执行板、验证矩阵、决策记录是否误放到 `docs/development/`

### Phase 1: Project Entry Checks

这些检查覆盖最容易遗漏的接入点：

当前入口由项目 adapter 定义。若 adapter 提供入口检查脚本，优先支持：

- 工作区检查
- 暂存区检查
- 指定文件检查

1. 新增能力是否挂载到项目定义的入口或注册表
2. 公共接口、命令、事件或配置是否保持兼容
3. 上层模块是否绕过项目定义的边界直接依赖底层实现
4. 错误响应、退出码或异常模型是否使用统一模式
5. 样式 token 检查（仅适用于有 UI/样式系统的项目）

### Phase 2: Existing Tooling

这些检查优先复用已有工具，不重复造轮子：

1. 项目 lint/typecheck（如项目已有配置）
2. Formatter / Markdown 格式检查（如项目已有配置）
3. Git 提交信息和敏感文件扫描

注意：

- 不建议第一阶段把历史存量一次性做成全仓硬阻塞
- 资源接入检查更适合先覆盖新增文件

## Suggested Output Format

后续工具化检查建议统一输出：

- `rule`
- `severity`
- `location`
- `message`
- `suggestion`

## Principle

自动化层的目标不是替代规则，而是先把：

- 最稳定
- 最容易漏
- 最低歧义

的规则变成可重复执行的检查。

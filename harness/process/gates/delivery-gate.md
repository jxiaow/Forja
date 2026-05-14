# Delivery Gate

## Goal

只在真正收口时输出可消费的交付，不把中间进度写成收尾报告。

## Default

- 进行中：更新 backlog / 验证矩阵 / checklist
- 阶段收口：输出 `Verification + Delivery`
- 需要长期留档时：再补 `docs/development/changes/`

## Final Closeout Conditions

`final closeout` 前先判定当前目标类型：

- `single-task`：一次性任务；用户要求的结果和必要验证都完成后可收口
- `staged/ongoing`：长周期、多阶段或连续推进任务；当前阶段 checklist 无可执行剩余项，或存在真实阻塞时才可收口
- `continuation`：用户只说“继续 / 开始 / 接着做 / 按计划执行”；继承上一个活动阶段目标，继续下一项，不把工作包完成当最终完成
- `explicit-closeout`：用户明确说“总结 / 收口 / 先到这 / 到这里”；按当前已验证状态收口

只有同时满足以下条件，才允许输出 `final closeout`：

1. 已完成目标类型判定，且不属于仍应继续推进的 `continuation`
2. 当前用户目标已完成，而非仅完成一个工作包
3. 已无可继续的下一动作，或存在真实阻塞
4. 若使用执行板或 checklist，已读取它并确认同阶段最高优先级项已推进且无下一可执行动作

否则只能输出 `working update` 并继续执行。

如果仍有可执行下一项，优先继续执行，不输出 Delivery gate。

## Executable Risk Is Not Closeout Risk

`Verification gate` 后、`Delivery gate` 前必须先分类所有未验证项和风险：

- `actionable`：当前仓库、当前权限、当前信息下还能继续修复、验证、补测试或收窄实现
- `blocked`：继续需要用户授权、外部环境、缺关键输入，或继续会误伤已有改动
- `accepted residual`：目标已完成，但仍有无法在当前任务内证明或消除的真实运行环境风险

只要存在 `actionable` 项，当前阶段不能进入 `final closeout`。必须把它转回 `Implementation gate` 或 `Verification gate` 继续处理。

以下内容不是“剩余风险”，而是必须继续处理的可执行待办：

- 测试失败还没有分流或修复
- 测试契约尚未同步当前需求或当前 UI
- 还有明确可跑的验证命令
- 已知代码问题有明确修复面且不需要新授权
- 已知运行风险可以通过代码、测试、超时、取消、重试、诊断日志等方式继续收窄

这类事项存在时，禁止输出 `final closeout`。继续执行下一步，或在权限、环境、关键输入缺失时说明真实阻塞。

测试失败收口前必须按 `../rules/test-failure-triage.md` 判定失败类型，不能把“测试还要修”包装成风险后停下。

## Evidence Anchors

`final closeout` 默认应包含：

1. 结果
2. 最近一次关键验证命令与结果
3. 未验证项和真实剩余风险

没有未验证项或真实风险时，用一句话说明即可，不展开风险清单，不写泛泛的“下一步”建议。

## Change Log Retention

默认优先维护 todo/checklist。只有以下情况才需要写 `docs/development/changes/`：

- 阶段已收口的流程重构或架构调整
- 已完成并需要沉淀的高风险入口修改
- 需要保留长期决策上下文的重大 Bug 修复
- 用户明确要求写变更记录

以下情况默认不写：

- 中间工作包推进
- 已通过 checklist 记录的日常步骤
- 单纯样式、命名、注释、测试补充

## Checklist Template

```text
- [x] 已完成项
- [ ] 待做项
- [-] 阻塞项：原因
```

## Recommended Output

```text
结果：...
验证：...
未验证/风险：...
```

也可以按短段落或短列表输出，只要能清楚区分结果、验证和风险。

默认要求：

- 简单任务优先 1-2 段短文，不强制分节
- 允许格式化输出，不要求压成一行或单一标签行
- 不重复列文件清单
- 中间阶段不用完整骨架
- 不把“无风险/可继续”包装成冗长收口；继续执行优先

## Good / Bad

Good：

```text
结果：已收窄部署状态标签样式，长文本不会挤压操作按钮。
验证：`npm run lint` 通过。
未验证/风险：未做端到端手动 smoke，真实窗口缩放仍需人工看一遍。
```

Bad：

```text
全部完成。
```

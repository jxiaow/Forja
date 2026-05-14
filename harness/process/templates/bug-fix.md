# Bug Fix Template

## Goal

定位根因，用尽量小的修复面解决问题。

## Minimal Analysis

默认只补这 5 项：

- 问题现象
- 期望行为
- 根因或怀疑主链
- 修复面
- 验证方式

## Test Failure Triage

如果触发条件是测试失败，或验证阶段发现测试失败，必须先执行
`harness/process/rules/test-failure-triage.md`，再决定修测试、修实现或修 fixture。

Bug gate 需要补充：

- 失败类型：实现回归 / 测试契约过期 / 需求变化未同步测试 / 环境或 fixture 问题
- 证据：当前需求、实现、测试断言之间的差异
- 修复方向：为什么改这个面，而不是回退另一个面

禁止只为让测试变绿而回退用户明确保留的 UI、行为或架构。

## Only Add When Relevant

- 有稳定复现：补复现步骤和触发条件
- 有环境差异：补 Web / 桌面运行时 / OS
- 有日志、堆栈、截图：只引用关键证据
- 还没复现成功：明确哪些结论只是代码路径分析
- 测试失败：补 Test failure triage 结论

## Recommended Output

```text
Bug gate
- 现象：...
- 根因/主链：...
- 测试分流：...
- 修复面：...
- 验证：...
```

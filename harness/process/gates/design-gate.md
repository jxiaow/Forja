# Design Gate

## Goal

先确定落点、边界和风险，再开始写实现。

## Minimal Fields

默认使用多行短列表，最多写这 6 项：

- 改动落点
- 方案选择
- 为什么这样做
- 改动边界
- 主要风险
- 验证思路

## Only Add When Relevant

- 高风险入口：为什么必须改这里，而不是更局部
- 跨模块：通信链怎么走（API / IPC / Store）
- UI：是否涉及主题、CSS 变量、现有组件模式
- Bug：修复点为什么打到根因

## Recommended Output

```text
Design gate
- 改动落点：...
- 方案选择：...
- 为什么这样做：...
- 改动边界：...
- 主要风险：...
- 验证思路：...
```

默认要求：

- 简单任务可以压缩字段数量，但不要把多个字段用分号挤在一行
- 与其他 gate 同时输出时，当前 gate 前后必须换行分隔
- 复杂任务优先 4-6 行短列表
- 不因压缩省略关键风险或验证思路
- 只保留决策和边界
- 不写实现流水账

## Good / Bad

Good：

```text
Design gate
- 改动落点：DeploymentStatus scoped CSS
- 方案选择：复用现有 CSS 变量，调整 flex-wrap 和 min-width
- 改动边界：不改组件 props、store 或状态枚举
- 主要风险：长文本仍可能挤压操作区
- 验证思路：检查窄屏、长项目名和多状态组合
```

Bad：

```text
Design gate
- 先改改看，不行再说。
```

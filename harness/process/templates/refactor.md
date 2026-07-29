# Refactor Template

## Goal

改善边界、可读性或复用，不改变既有外部行为。

## Minimal Analysis

默认只补这 5 项：

- 重构目标
- 行为是否保持不变
- 边界
- 核心整理点
- 验证方式

## Only Add When Relevant

- 触达高风险入口：说明为什么必须改这里
- 涉及跨模块：说明依赖方向和通信边界
- 需要分步：说明先做哪一层，后做哪一层
- 长周期 / 多阶段：先列阶段级 todo/checklist、执行顺序和当前第一阶段
- 只是搬文件：说明为什么这次仍有结构收益

## Recommended Output

```text
Refactor gate
- 目标：...
- 边界：...
- 整理点：...
- 验证：...
```

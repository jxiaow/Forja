# New Feature Template

## Goal

明确功能目标、落点和边界，避免把新增功能做成无边界扩张。

## Minimal Analysis

默认只补这 5 项：

- 功能目标
- 面向谁 / 入口在哪
- 主要落点
- 成功标准
- 明确不做什么

## Only Add When Relevant

- 涉及界面：补主题、响应式、组件或视图模式
- 涉及运行时桥接：补 adapter / command / IPC / message 边界
- 涉及公共接口：补入口、状态容器、组合逻辑和通信链
- 涉及新文件：补应用入口、注册入口、导出入口或依赖清单

## Recommended Output

```text
Feature gate
- 目标：...
- 落点：...
- 关键改动：...
- 验证：...
```

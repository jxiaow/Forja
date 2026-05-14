# Cross Module Change Template

## Goal

控制跨模块改动的边界、依赖方向和通信方式。

## Minimal Analysis

默认只补这 5 项：

- 涉及模块
- 主改动落点
- 为什么不能只改一个模块
- 关键接口 / 通信链
- 验证方式

## Only Add When Relevant

- 触达运行时桥接：补 adapter / command / IPC / message 边界
- 触达公共接口：补入口、权限边界和通信链
- 触达状态管理：补状态容器、缓存或持久化边界
- 长周期 / 多阶段：先列阶段级 todo/checklist、执行顺序和当前第一阶段
- 存在更小切入点：说明为什么这次不用

## Recommended Output

```text
Cross-module gate
- 模块：...
- 主落点：...
- 通信链：...
- 验证：...
```

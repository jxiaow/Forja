# Module Communication

## Goal

约束模块之间通过稳定边界通信，避免直接耦合内部状态。

## Repo Facts

写出目标仓库主要通信路径：

- 输入层到处理层：
- 处理层到数据/存储层：
- 公共接口到内部模块：
- 插件/扩展到宿主：
- 进程、线程、服务或包之间：
- 配置来源到消费者：

## Core Rules

- 优先走既有 facade、service、adapter、port 或公开接口。
- 不跨层读取内部状态。
- 配置读取集中在既有配置层。
- 跨模块改动要明确调用方向和失败路径。

## Design Checklist

- 调用方和被调用方边界是什么？
- 是否已有现成通信路径？
- 错误、重试和状态由谁承接？

## Implementation Checklist

- 没有绕过既有 facade/service/adapter/port。
- 没有新增反向依赖。
- 失败路径可观测。
- 测试覆盖通信边界。

## Common Smells

- 上层直接操作下层内部状态。
- 下层反向依赖上层状态或展示逻辑。
- 配置在多个模块重复读取。
- 为一次调用新增旁路通道。

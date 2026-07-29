# Local Project Adapter

本文件承载目标仓库专属事实。可移植的 harness core 保持在 `harness/process/README.md`、`templates/`、`gates/`、`automation/` 和通用 `rules/` 中。

迁移 harness 到其他仓库时，优先替换本文件和项目专属规则，不要改 core gate 语义。

## Adapter Files

- `rules/` - 项目专属稳定规则
- `automation/` - 项目专属自动检查；没有稳定检查时只保留 README
- `automation/tests/` - 项目专属自动检查测试；没有脚本时不需要创建

## Repository Shape

列出目标仓库的核心目录和职责。只写真实存在、会影响开发落点的目录。

```text
repo-root/
├── app-or-package-a/  # 作用
├── app-or-package-b/  # 作用
├── docs/              # 文档
└── tests/             # 测试
```

## Product Chain Map

按用户任务最常命中的链路分组。不要预设一定有 UI、API 或后端。可选示例：

- 输入链：CLI、HTTP、UI、队列、文件、插件等
- 处理链：业务逻辑、任务调度、编译、推理、转换等
- 输出链：API 响应、文件、包导出、事件、部署产物等
- 配置链：环境变量、配置文件、工作区配置、密钥来源
- 数据链：数据库、缓存、本地文件、远端存储等
- 集成链：第三方服务、运行时、SDK、系统能力等

每条链路写清楚默认落点、入口文件和主要验证方式。

## High-Risk Changes

列出改动前必须额外收窄边界的真实入口：

- 应用启动入口
- 命令、路由、导出或插件注册入口
- 权限/认证/授权入口
- 全局状态入口
- 构建和测试配置
- 环境变量和密钥配置

## Execution Defaults

agent 默认要分别判断：

- 逻辑落点
- 接口边界
- 依赖方向
- 构建/路由/注册接入点
- 最小验证命令

## Common Reading Sets

按任务类型给出规则组合：

- 新功能开发：`new-feature` + `rules/architecture-dependencies.md`
- Bug 修复：`bug-fix` + 相关通信/接口/代码规则
- UI 调整：`ui-adjustment` + 项目 UI profile 规则（若存在）
- 跨模块改动：`cross-module-change` + 架构/通信/接口规则
- 重构：`refactor` + 架构/代码规则

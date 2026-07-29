# Project Adapter Scaffold

本目录承载项目适配层。迁移 harness 到新仓库时，复制 core 后，用 `_template/` 快速生成目标仓库的 adapter。

## Why Adapter Exists

core 只描述通用流程、gate、模板、通用检查和低 token 执行规则。adapter 只描述目标仓库事实：

- 仓库结构和关键入口
- 产品链路和模块落点
- 高风险文件
- 项目专属稳定规则
- 项目专属自动检查

不要把业务路径、框架栈、路由入口、UI 组件库写回 core。

## Scaffold Order

生成新项目 adapter 时按顺序做：

1. 运行 `node harness/process/project/create-adapter.js --target harness/process/project/local --name "Local Project Adapter"` 生成初始 adapter。
   没有 Node.js 时，手动复制 `harness/process/project/_template/` 到 `harness/process/project/local/`。
2. 读取仓库结构：manifest、workspace 配置、主要源码目录、测试目录、文档目录、构建配置。
3. 识别产品链路：输入、处理、输出、配置、数据、运行时、集成服务、发布链路等。
4. 写 `local.md`：只记录项目事实、链路、落点和高风险入口。
5. 写 `rules/architecture-dependencies.md`：分层、依赖方向、落点、反向依赖气味。
6. 写通用规则：入口接入、代码规范、模块通信、接口契约、可观测性与运行操作。
7. 按项目技术栈从 `profiles/` 选择性补充规则；不适用的 profile 不进入 `local/`。
8. 写 `automation/README.md`：说明哪些检查已接入、哪些只作为候选。
9. 只有确实能稳定自动判断时，才新增项目检查脚本。

## Rule Template Contract

每个项目规则文件都应尽量保持同一骨架：

- `Goal`：这条规则防什么问题
- `Repo Facts`：目标仓库的真实目录、入口、依赖方向
- `Core Rules` 或领域规则：必须遵守的稳定约束
- `Design Checklist`：实现前要确认什么
- `Implementation Checklist`：改完要检查什么
- `Common Smells`：AI 容易犯的错误

允许没有 `Repo Facts` 的通用风格规则，但不得留下占位符、猜测路径或不存在的入口。

## Fast Prompt For AI

迁移时可以直接给 AI 这段任务：

```text
根据 harness/process/project/_template/ 生成目标仓库 adapter。
先读取 manifest/workspace/源码目录/测试目录/文档目录/构建配置，再写 harness/process/project/local/local.md 和 rules/。
adapter 只写目标仓库事实，不改 harness core。
规则文件统一包含 Goal、Repo Facts、Core Rules、Design Checklist、Implementation Checklist、Common Smells。
默认模板必须保持语言、框架、前后端形态无关；技术栈规则只能从 profiles 选择性提炼。
不确定的入口不要编造，写“未发现稳定入口”，并在 Verification gate 说明未覆盖项。
```

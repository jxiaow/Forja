# Adapter Template

这是项目适配层脚手架。复制本目录内容到 `harness/process/project/local/` 后，用真实仓库事实替换模板内容。

## Files

- `local.md` - 项目适配总入口
- `rules/architecture-dependencies.md` - 分层和依赖方向
- `rules/entrypoints.md` - 应用、命令、导出、注册、构建和测试入口
- `rules/code-standards.md` - 语言、格式、错误处理、依赖和测试组织
- `rules/interface-contracts.md` - 公共接口、协议、配置和数据格式兼容性
- `rules/module-communication.md` - 模块通信与状态边界
- `rules/observability-and-ops.md` - 日志、诊断、配置、发布和运行态文档
- `automation/README.md` - 项目自动检查说明

## Fill Rules

- 只写已经从仓库确认的事实。
- 默认模板不假设语言、框架、前后端形态或部署方式。
- 需要技术栈规则时，从 `../profiles/` 选择性提炼，不要整包套用。
- 不要保留 `<placeholder>`、`TBD`、猜测路径。
- 高风险入口必须能映射到真实文件或真实目录。
- 如果暂时没有项目检查脚本，保留 `automation/README.md` 说明候选项即可。

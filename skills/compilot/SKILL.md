---
name: compilot
description: C++ 项目构建工具。Qt (qmake) 项目和 SDK (.sln/Makefile) 项目的构建、运行、清理和环境管理。当任务涉及 C++ 项目编译、运行、环境检测或远程同步时使用。
---

# compilot

当需要处理本地 C++ 项目，且机器上已经可用 `compilot` 命令时使用。

## 适用场景

- 基于 qmake 的 Qt/C++ 项目的构建、运行、清理
- .sln 或 Makefile 的 SDK/库项目的构建
- 需要检测 Qt/VS 环境或项目状态
- 需要同步变更文件到远程服务器

## 不适用

- 项目不是 C++ 项目（不是 .pro/.sln/Makefile）
- 机器上没有 `compilot` 命令
- 只是读代码或改代码，不涉及构建/运行

## 核心原则

1. 项目 `init` 后，配置已保存，后续命令**不需要重复指定参数**
2. 直接带 `--execute`，不需要先 dry-run
3. 加 `--json --brief` 获取精简结构化输出，省 token
4. run 加 `--detach` 后台启动程序，CLI 立即返回

## Qt 命令参考

```bash
# 首次使用（只需一次）
compilot qt init --execute --json --brief

# 查看状态（含环境检测、项目列表）
compilot qt status --json --brief

# 编译
compilot qt build --execute --json --brief

# 编译并运行（后台启动，立即返回）
compilot qt run --execute --detach --json --brief

# 查看程序运行日志
compilot qt logs --json

# 停止程序
compilot qt stop --execute --json --brief

# 清理
compilot qt clean --execute --json --brief

# 同步到远程
compilot qt sync --execute --json --brief
```

## SDK 命令参考

```bash
# 查看状态
compilot sdk status --json

# 编译
compilot sdk build --execute --json

# 重新编译（clean + build）
compilot sdk rebuild --execute --json

# 清理
compilot sdk clean --execute --json
```

## 执行规则

- **不要拆解命令**：`compilot qt run` 会先杀旧进程、编译、再启动，不要自己拆步骤
- **不要猜路径**：不要自己拼 qmake/jom/msbuild 命令，统一用 compilot
- **判断成功失败**：看返回的 `ok` 字段
- **编译失败时**：返回结果中 `errors` 字段包含提取的错误行，直接分析即可
- **需要完整日志时**：读 `logFile` 路径指向的文件

## 错误处理

- `ok: false` 时看 `errors` 和 `diagnostics` 字段
- 环境未配置时先 `compilot qt init --execute`
- 多个项目文件时用 `compilot qt status --json` 或 `compilot sdk status --json` 看 `candidates`，再加 `--project` 指定

---
name: compilot
description: Use when a C++ Qt qmake, .sln, or Makefile project needs build, run, clean, environment status, or remote sync work through the compilot CLI.
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

1. 先用 `status --json --brief` 看环境、项目候选和已保存配置
2. 多个候选项目时，必须从 `candidates` 选择并显式加 `--project`
3. `build`、`run`、`clean`、`sync`、`init` 都有副作用；只有用户明确要执行时才加 `--execute`
4. 加 `--json --brief` 获取精简结构化输出，省 token
5. `build`、`run`、`rebuild` 执行时必须加 `--detach`（编译耗时长，避免阻塞）
6. `clean`、`sync`、`init`、`stop` 不需要 `--detach`（执行很快，直接等结果）
7. `--detach` 模式下命令立即返回，通过 `logs` 查看实际执行结果

## Qt 命令参考

```bash
# 查看状态（含环境检测、项目列表）
compilot qt status --json --brief

# 初始化并保存本地配置
compilot qt init --execute --json --brief

# 查看编译计划（默认 dry-run）
compilot qt build --json --brief

# 执行编译
compilot qt build --execute --detach --json --brief

# 编译并运行
compilot qt run --execute --detach --json --brief

# 查看运行日志（build/run 后查看实际输出和错误）
compilot qt logs --json

# 停止程序
compilot qt stop --execute --json --brief

# 执行清理
compilot qt clean --execute --json --brief

# 执行远程同步
compilot qt sync --execute --json --brief
```

## SDK 命令参考

```bash
# 查看状态
compilot sdk status --json

# 执行编译
compilot sdk build --execute --detach --json

# 执行重新编译（clean + build）
compilot sdk rebuild --execute --detach --json

# 执行清理
compilot sdk clean --execute --json
```

## 执行规则

- **不要拆解命令**：`compilot qt run` 会先杀旧进程、编译、再启动，不要自己拆步骤
- **不要猜路径**：不要自己拼 qmake/jom/msbuild 命令，统一用 compilot
- **build/run/rebuild 必须加 --detach**：编译耗时长，不加会阻塞
- **clean/sync/init/stop 不加 --detach**：执行很快，直接拿结果
- **detach 后看 logs**：`--detach` 返回 `ok: true` 只表示任务已启动；必须再看 `compilot qt logs --json` 确认编译是否成功
- **非 detach 直接看结果**：`ok` 字段直接反映成功/失败，`errors` 字段包含错误行
- **执行前确认目标**：看 `project`、`candidates`、`diagnostics`、`commands`、`nextActions`
- **需要完整日志时**：读 `logFile` 路径指向的文件

## 错误处理

- `ok: false` 时看 `errors` 和 `diagnostics` 字段
- 环境未配置时先看 `status` 的 `diagnostics` / `nextActions`，需要保存配置时再 `compilot qt init --execute`
- 多个项目文件时用 `compilot qt status --json` 或 `compilot sdk status --json` 看 `candidates`，再加 `--project` 指定

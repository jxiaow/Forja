---
name: qt-pilot-cli
description: 基于 qmake 的 Qt/C++ 项目构建、运行、清理和环境管理。当任务涉及 Qt 项目编译、运行、qmake、环境检测或远程同步时使用。
---

# qt-pilot-cli

当需要处理本地基于 qmake 的 Qt/C++ 项目，且机器上已经可用 `qt-pilot` 命令时使用。

## 适用场景

- 任务涉及基于 qmake 的 Qt/C++ 项目的构建、运行、清理
- 需要检测 Qt/VS 环境或项目状态
- 需要同步变更文件到远程服务器

## 不适用

- 项目不是基于 qmake 的 Qt 项目
- 机器上没有 `qt-pilot` 命令
- 只是读代码或改代码，不涉及构建/运行

## 核心原则

1. 项目 `init` 后，配置已保存在 `.qtpilot/settings.json`，后续命令**不需要重复指定** `--project`、`--mode`、`--arch` 等参数
2. **查询类命令**加 `--json`（status）
3. **执行类命令不加 `--json`**，直接在终端执行，用户能看到实时输出
4. 直接带 `--execute`，不需要先 dry-run 再确认

## 命令参考

```bash
# 首次使用：初始化环境配置（只需执行一次）
qt-pilot init --execute

# 查看状态
qt-pilot status --json

# 日常使用：直接执行即可，无需额外参数
qt-pilot qmake --execute
qt-pilot build --execute
qt-pilot run --execute
qt-pilot clean --execute
qt-pilot stop --execute
qt-pilot sync --execute
```

仅在需要覆盖已保存配置时才加参数：

```bash
# 临时切换模式
qt-pilot build --execute --mode release

# workspace 下有多个 .pro 且未 init 时指定项目
qt-pilot build --execute --project "path/to/xxx.pro"

# 指定同步服务器
qt-pilot sync --execute --server "开发服务器"
```

## 执行规则

- **直接执行**：构建、运行、清理等操作直接带 `--execute`，不需要先 dry-run 再问用户
- **在 IDE 终端中执行**：build、qmake、clean 命令在终端中执行，用户能看到实时编译输出
- **run 用后台进程**：`qt-pilot run --execute` 会先编译再启动程序，程序不会自动退出，必须用后台进程方式执行
- **不要拆解命令**：`qt-pilot run --execute` 会先编译再启动程序，不要自己拆成 build + 手动启动 exe
- **不要猜路径**：不要自己拼 qmake/jom/make/VsDevCmd 命令，统一用 qt-pilot
- **判断成功失败**：看命令退出码，0 为成功，非 0 为失败；失败时从终端输出中分析错误原因

## 错误处理

- 编译失败时直接从终端输出分析错误
- 环境未配置时先执行 `qt-pilot init --execute`
- 多个 `.pro` 文件时用 `qt-pilot status --json` 查看 `candidates`，然后用 `--project` 指定

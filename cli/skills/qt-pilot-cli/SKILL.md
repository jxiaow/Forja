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

1. **查询类命令**加 `--json` 获取结构化输出（status、projects）
2. **执行类命令不加 `--json`**，直接在终端执行，用户能看到实时输出
3. 构建/运行类命令直接带 `--execute`，不需要先 dry-run 再确认
4. 多个 `.pro` 文件时用 `--project <path>` 指定

## 命令参考

```bash
# 初始化（首次使用或环境变更后）
qt-pilot init --execute

# 查看状态（用 --json 解析结果）
qt-pilot status --json

# 生成 Makefile
qt-pilot qmake --execute

# 编译
qt-pilot build --execute

# 编译并运行（先 build 再启动程序）
qt-pilot run --execute

# 清理
qt-pilot clean --execute

# 停止运行中的程序
qt-pilot stop --execute

# 同步变更文件到远程
qt-pilot sync --execute

# 指定项目
qt-pilot build --execute --project "path/to/xxx.pro"

# 指定模式和架构
qt-pilot build --execute --mode release --arch x86
```

## 执行规则

- **直接执行**：构建、运行、清理等操作直接带 `--execute`，不需要先 dry-run 再问用户
- **在 IDE 终端中执行**：所有 `--execute` 命令必须在 IDE 的终端中执行（不要用后台进程），这样用户能看到实时编译输出
- **不要拆解命令**：`qt-pilot run --execute` 会先编译再启动程序，不要自己拆成 build + 手动启动 exe
- **不要猜路径**：不要自己拼 qmake/jom/make/VsDevCmd 命令，统一用 qt-pilot
- **判断成功失败**：看命令退出码，0 为成功，非 0 为失败；失败时从终端输出中分析错误原因

## 错误处理

- 编译失败时直接从终端输出分析错误
- 如果需要结构化错误信息，可以加 `--json` 重新执行一次查看 `diagnostics` 和 `nextActions`
- 环境未配置时先执行 `qt-pilot init --execute`
- 多个 `.pro` 文件时用 `qt-pilot status --json` 查看 `candidates`，然后用 `--project` 指定

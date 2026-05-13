# qt-pilot-cli

当需要处理本地基于 qmake 的 Qt/C++ 项目，且机器上已经可用 `qt-pilot` 命令时使用。适用于让智能体通过结构化 JSON 探测项目状态、选择 `.pro` 文件、规划 qmake/build/run 命令，或在得到用户明确同意后执行这些命令。

## 适用场景

- 任务涉及基于 qmake 的 Qt/C++ 项目的构建、运行、清理
- 需要检测 Qt/VS 环境或项目状态
- 需要同步变更文件到远程服务器

## 不适用

- 项目不是基于 qmake 的 Qt 项目
- 机器上没有 `qt-pilot` 命令
- 只是读代码或改代码，不涉及构建/运行

## 核心原则

1. 所有命令加 `--json` 获取结构化输出
2. **构建/运行类命令直接用 `--execute` 执行**，不需要先 dry-run 再确认
3. 构建失败时读返回结果中的 `logFile` 路径分析错误
4. 多个 `.pro` 文件时用 `--project <path>` 指定

## 命令参考

```bash
# 初始化（首次使用或环境变更后）
qt-pilot init --execute --json

# 查看状态
qt-pilot status --json

# 生成 Makefile
qt-pilot qmake --execute --json

# 编译
qt-pilot build --execute --json

# 编译并运行（先 build 再启动程序）
qt-pilot run --execute --json

# 清理
qt-pilot clean --execute --json

# 停止运行中的程序
qt-pilot stop --execute --json

# 同步变更文件到远程
qt-pilot sync --execute --json

# 指定项目
qt-pilot build --execute --project "path/to/xxx.pro" --json

# 指定模式和架构
qt-pilot build --execute --mode release --arch x86 --json
```

## 执行规则

- **直接执行**：构建、运行、清理等操作直接带 `--execute`，不需要先 dry-run 再问用户
- **在 IDE 终端中执行**：所有 `--execute` 命令必须在 IDE 的终端中执行（不要用后台进程），这样用户能看到实时编译输出
- **不要拆解命令**：`qt-pilot run --execute` 会先编译再启动程序，不要自己拆成 build + 手动启动 exe
- **不要猜路径**：不要自己拼 qmake/jom/make/VsDevCmd 命令，统一用 qt-pilot

## 返回结果关键字段

| 字段 | 含义 |
|------|------|
| `ok` | 命令是否成功 |
| `action` | 执行的动作 |
| `project` | 当前选中的项目路径 |
| `commands` | 实际执行的 shell 命令列表 |
| `shellCommand` | 拼接好的完整 shell 命令 |
| `diagnostics` | 警告或错误信息 |
| `candidates` | 项目选择有歧义时的 `.pro` 候选列表 |
| `nextActions` | 下一步建议 |
| `exitCode` | 进程退出码（execute 模式） |
| `logFile` | 执行日志文件路径 |
| `resolved` | 最终解析的 mode、arch、Qt 路径、VS DevShell 路径 |

## 错误处理

- `ok: false` 时查看 `diagnostics` 和 `nextActions`
- 编译失败时读 `logFile` 获取完整编译输出
- `candidates` 非空但 `project` 为 null 时，需要用 `--project` 指定
- 环境未配置时先执行 `qt-pilot init --execute --json`

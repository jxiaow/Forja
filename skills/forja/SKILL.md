---
name: forja
description: Use when a C++ Qt qmake, .sln, or Makefile project needs build, run, clean, environment status, or sync work through the forja CLI.
---

# forja

当需要处理本地 C++ 项目，且机器上已经可用 `forja` 命令时使用。

## 适用场景

- 基于 qmake 的 Qt/C++ 项目的构建、运行、清理
- .sln 或 Makefile（含 makefile、GNUmakefile）的 SDK/库项目的构建
- 需要检测 Qt/VS 环境或项目状态
- 需要同步变更文件到服务器

## 不适用

- 项目不是 C++ 项目（不含 .pro/.sln/Makefile）
- 机器上没有 `forja` 命令
- 只是读代码或改代码，不涉及构建/运行

## 核心原则

1. **先 status 再动手**：用 `status --json` 看环境就绪状态和 diagnostics
2. **init 只做自动初始化**：不要给 `init` 传 `--project`、`--mode`、`--arch`、工具链路径或 target
3. **use 负责显式选择**：项目、mode、arch、Qt/VS 路径只通过 `use` 写入保存配置
4. **执行命令只读配置**：`build`、`run`、`clean` 不传项目或构建配置参数
5. **默认执行**：命令默认执行，加 `--plan` 仅查看计划
6. **加 --json**：获取结构化输出，省 token
7. **run 必须 --detach**：程序启动后不会自行退出，不加会阻塞终端
8. **build/clean 不加 --detach**：前台执行完直接返回结果
9. **activeTarget 决定项目类型**：通过 `forja use target --project <path>` 选择 Qt (.pro) 或 SDK (.sln/Makefile)

## 决策流程

```
用户要求构建/运行 →
  1. forja status --json
  2. 看 diagnostics / nextActions：
     - 没有本地配置 → 运行 init --json，让 CLI 保存可自动确定的配置
     - 缺项目或 target → 运行 list targets --json，展示候选，让用户选择后运行 use target --project <path> --json
     - 缺 mode/arch 确认 → 按 status 建议运行 use target --mode ... --arch ... --json
     - 缺 Qt/VS 工具链 → 运行 list env --json，展示候选，让用户选择后运行 use qt/sdk 写入路径
     - 缺 Makefile → 先 build qmake --json
  3. 配置齐全后执行 build/run/clean：
     - 不追加 --project、--mode、--arch、--qt-path、--vs-dev-shell
     - 需要切换配置时，先运行 use，再重新 status
  4. 执行命令，检查 ok 字段：
     - ok: true → 完成
     - ok: false → 看 errors 和 diagnostics 定位问题
```

**关键：当存在多个候选（多个 Qt 版本、多个 .pro 文件、多个 VS 版本、
debug/release、x86/x64）且用户未设置过时，必须展示选项让用户选择，
禁止自动选择后静默执行。**

## 命令参考

| 命令 | 用途 | 关键参数 |
|------|------|----------|
| `status` | 当前配置和就绪状态 | |
| `init` | 自动检测并保存能确定的配置 | |
| `list` | 列表（targets/servers/env/remote/config） | `targets`, `servers`, `env`, `remote`, `config` |
| `use` | 配置（target/execution/sync/remote/qt/sdk） | 见下方子命令 |
| `server` | 服务器管理（add/update/remove） | `add`, `update`, `remove` |
| `build` | 编译 | `fresh`, `qmake`, `rcc`, `--plan` |
| `run` | 编译并运行 | `designer <ui-file>`, `--detach`（必须） |
| `stop` | 停止运行中的程序 | |
| `clean` | 清理构建产物 | `--plan` |
| `doctor` | 诊断和修复 | `--remote`, `fix` |
| `sync` | 同步变更文件到服务器 | `--yes`, `--reset`, `plan` 子命令 |

### use 子命令

| 子命令 | 用途 | 关键参数 |
|--------|------|----------|
| `use target` | 选择项目和构建配置 | `--project`, `--mode`, `--arch` |
| `use execution` | 切换本地/远程执行 | `--local`, `--remote` |
| `use sync` | 配置同步服务器 | `--server`, `--remote-path`, `--enable`, `--disable` |
| `use remote` | 配置远程执行 | `--server`, `--remote-path` |
| `use remote repo` | 配置远程仓库映射 | `set/remove/clear`, `--local`, `--remote`, `--role` |
| `use remote forja-bin` | 配置远程 Forja 二进制路径 | `set/clear`, `--path` |
| `use remote build-order` | 配置远程构建顺序 | `set/clear`, 位置参数 `qt:build` 等 |
| `use remote transfer` | 配置远程部署传输 | `set/clear`, `--server`, `--path`, `--artifact` |
| `use qt` | 配置 Qt 工具链 | `--qt-path`, `--vs-dev-shell`, `--qmake-target` |
| `use sdk` | 配置 SDK 工具链 | `--vs-dev-cmd` |

### server 子命令

| 子命令 | 用途 | 关键参数 |
|--------|------|----------|
| `server add` | 添加服务器 | `--name`, `--host`, `--username`, `--port` |
| `server update` | 修改服务器 | `--id`, `--name`, `--host`, `--username`, `--port` |
| `server remove` | 删除服务器 | `--id` |

### 通用参数

| 参数 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径，默认当前目录 |
| `--plan` | 仅显示命令计划，不执行 |
| `--detach` | 仅 `run` 可用，后台启动程序并写日志 |
| `--json` | 结构化 JSON 输出 |

## JSON 输出关键字段

```jsonc
{
  "ok": true,              // 操作是否成功
  "action": "status",      // 当前动作
  "ready": true,           // 是否就绪可执行（status 专有）
  "checks": {              // 各项检查结果（status 专有）
    "settings": true,
    "project": true,
    "qtPath": true,
    "jom": true,
    "makefile": true
  },
  "missing": ["project"],  // 缺失项列表
  "target": "MyApp",       // 项目名
  "project": "app.pro",    // 项目文件
  "exitCode": 0,           // 进程退出码（build/run）
  "errors": [],            // 编译错误行（最多 20 条）
  "diagnostics": [],       // 诊断信息（warning/error 级别）
  "nextAction": "init",    // 建议的下一步命令
  "nextActions": [],       // 建议的下一步命令列表
  "logFile": "...",        // 日志文件路径（detach 模式）
  "resolved": {            // 实际使用的配置
    "mode": "debug",
    "arch": "x86",
    "qtPath": "...",
    "vsDevShell": "...",
    "jomPath": "..."
  }
}
```

## 执行规则

- **不要拆解命令**：`forja run` 会先杀旧进程、编译、再启动，不要自己拆步骤
- **不要猜路径**：不要自己拼 qmake/jom/msbuild 命令，统一用 forja
- **多候选必须让用户选**：`list targets` / `list env` 返回多个候选时，列出选项让用户决定，不要自动取第一个
- **首次配置必须确认**：status 中 resolved 的 qtPath、vsDevShell、project 如果是自动检测的，先展示给用户确认再执行
- **只有 run 加 --detach**：程序启动后不会自行退出，不加会阻塞
- **detach 后看 status**：`run --detach` 返回 `ok: true` 表示程序已启动且已解析到目标进程 PID；用 `status --process --json` 随时确认运行状态和日志路径
- **非 detach 直接看结果**：`ok` 字段直接反映成功/失败
- **命令耗时与超时**：`build`、`run --detach`、`clean` 都是前台阻塞命令，会等执行完成后返回 JSON 结果；其中 `build` 和 `run --detach`（内含编译步骤）耗时取决于增量编译量，通常几十秒到几分钟。执行时应设置足够的超时（建议 15 分钟），不要因默认超时中断后反复重试。这些命令最终都会自行退出，**不是长驻进程，禁止用后台进程方式启动**
- **执行前确认目标**：看 `activeTarget`、`project`、`candidates`、`diagnostics`
- **需要完整日志时**：读 `logFile` 路径指向的文件

## 常见场景示例

```bash
# 首次使用：先看状态，再自动初始化
forja status --json
forja init --json

# 显式选择配置
forja use target --project src/app.pro --mode release --json

# 日常编译
forja build --json

# 编译并后台运行
forja run --detach --json

# 查运行状态和日志路径
forja status --process --json

# 停止程序
forja stop --json

# 只看编译计划不执行
forja build --plan --json

# 同步：先看状态，再预览或单文件同步
forja remote set --server dev --remote-path /remote/app --json
# 将当前本地 CLI 打包并安装/更新到远端
forja remote bootstrap --json
forja server --json
forja server add --name dev --host 127.0.0.1 --username dev --json
forja use sync --server server-1 --remote-path /remote/app --enable --json
forja sync --reset --json
forja server update server-1 --host 10.0.0.2 --json
forja server remove server-1 --json
forja sync plan --json

# SDK 编译：配置先用 use，build 只读保存配置
forja status --json
forja use target --project Makefile --mode release --json
forja build --json

# 远程高级配置
forja use remote repo set --local qt_client --remote qt_client --role primary --json
forja use remote forja-bin set --path /home/dev/.local/bin/forja --json
forja use remote build-order set qt:build sdk:rebuild --json
forja use remote transfer set --server server-2 --path /deploy/app --artifact out/app --json
```

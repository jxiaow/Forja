# Forja

C++ 项目构建管理工具，同时提供 VSCode 扩展和 CLI。支持 Qt (qmake)、Visual Studio (.sln)、Makefile 和 CMake 项目。本地构建/运行，远程文件同步。

## 支持的项目类型

| 类型 | 项目文件 | 构建工具 |
|------|----------|----------|
| Qt | `.pro` | qmake + jom/make |
| Visual Studio | `.sln` | MSBuild |
| Makefile | `Makefile` | make |
| CMake | `CMakeLists.txt` | cmake |
| 自定义脚本 | `.sh` / `.bat` | 用户脚本 |

## 安装

### VSCode 扩展

```bash
code --install-extension forja-<version>.vsix          # stable
code --install-extension forja-<version>-dev.<ts>.vsix  # dev
```

### CLI

```bash
npm install -g forja-cli-<version>.tgz
```

扩展和 CLI 共享配置，任一侧的变更在另一侧立即可见。

## 快速开始

```bash
# 1. 初始化工作区（注册 workroot，扫描项目）
forja init

# 2. 选择构建目标
forja use target

# 3. 构建
forja build

# 4. 运行
forja run
```

也可以用 VSCode：打开工作区后，点击活动栏 Forja 图标打开配置面板完成设置，状态栏点击 Build/Run。

## CLI 命令

所有命令支持 `--json` 输出和 `--lang zh|en` 切换语言。

### `forja init`

注册 workroot 并配置初始目标。

```bash
forja init                          # 交互式初始化
forja init --lang zh                # 设置界面语言
```

### `forja status`

显示配置就绪状态、诊断信息和下一步操作建议。

### `forja list`

```bash
forja list targets                  # 当前活动目标
forja list targets --all            # 所有已保存目标
forja list env                      # 工具链环境信息
```

### `forja use`

```bash
forja use target                              # 交互式选择目标
forja use target --project app.pro            # 按项目文件选择
forja use target --mode release               # 切换构建模式
forja use target --arch x64                   # 切换架构
forja use target --qt /path/to/qt             # 设置 Qt 路径
forja use target --build-script build.sh      # 设置自定义构建脚本
forja use target --executable-name myapp      # 设置输出文件名

# 子命令
forja use target qmake-args                   # 查看 qmake 参数
forja use target qmake-args --add CONFIG+=foo # 添加（自动去重）
forja use target qmake-args --rm CONFIG+=foo  # 删除
forja use target suppress-warnings            # 查看被抑制的警告
forja use target suppress-warnings --add C4819
forja use target remove                       # 删除已保存目标

forja use --jobs 8                            # 设置全局并行编译数
```

### `forja build`

```bash
forja build                       # 构建当前目标
forja build fresh                 # 清理后重建
forja build qmake                 # 仅运行 qmake（Qt 项目）
forja build rcc                   # 仅编译资源文件（Qt 项目）
forja build --plan                # 预演模式，只显示命令
forja build --jobs 8              # 指定并行数
forja build --project app.pro     # 构建指定项目
```

### `forja run`

```bash
forja run                         # 编译并运行
forja run --detach                # 后台运行
forja run designer mainwindow.ui  # 打开 Qt Designer
forja run custom <name>           # 运行自定义命令
```

### `forja stop`

停止运行中的程序。

### `forja clean`

清理构建产物。

### `forja server`

管理远程服务器。

```bash
forja server                                  # 列出服务器
forja server add --name dev --host 10.0.0.1 --username dev
forja server --detail <id>                    # 查看详情
forja server update <id> --port 2222
forja server remove <id>
```

认证方式：SSH 密钥（默认）或密码（`--auth-mode password`）。

### `forja remote`

```bash
forja remote                                  # 查看远程配置
forja remote setup --server dev --remote-path /home/dev/project
forja remote bootstrap                        # 部署 Forja CLI 到远端
```

### `forja sync`

基于 git diff 增量上传变更文件。

```bash
forja sync                        # 同步变更文件
forja sync --dry-run              # 预览，不实际上传
forja sync --file src/main.cpp    # 同步指定文件
forja sync status                 # 查看同步状态
forja sync reset                  # 重置同步状态
forja sync ignore --add "*.log"   # 添加忽略规则
forja sync ignore --rm "*.tmp"    # 删除忽略规则
```

## VSCode 命令

命令面板（`Ctrl+Shift+P`）：

| 命令 | 说明 |
|------|------|
| `Forja: Build` | 编译当前目标 |
| `Forja: Run` | 编译并运行 |
| `Forja: Debug` | 编译并调试 |
| `Forja: Stop` | 停止运行中的程序 |
| `Forja: Clean` | 清理构建产物 |
| `Forja: Sync Changes` | 同步变更文件 |
| `Forja: Status` | 查看状态 |
| `Forja: Init Workspace` | 初始化工作区 |
| `Forja: Use Target` | 选择/切换目标 |
| `Forja: Open Config Page` | 打开配置面板 |
| `Forja: Open with Qt Designer` | 用 Designer 打开 .ui 文件 |
| `Forja Remote: Bootstrap` | 部署 CLI 到远端 |

## 配置面板

点击活动栏 Forja 图标打开，包含以下页面：

| 页面 | 内容 |
|------|------|
| **概览** | 当前目标、环境状态、C/C++ 标准、QMake TARGET、IntelliSense 配置 |
| **环境** | Qt 路径、VS DevShell、Designer 路径 |
| **项目** | 选择项目文件、构建模式、架构、工具链 |
| **同步** | 服务器配置、远程路径、同步开关、忽略规则 |

## Workroot 模型

Forja 以 **workroot** 为单位管理配置：

- `forja init` 注册一个 workroot 目录
- 所有目标、工具链、模块配置存储在 `~/.forja/workspaces/<hash>.json`
- 子目录自动继承父级 workroot 的配置（最长前缀匹配）
- 一个 workroot 下可保存多个 target，同时只有一个 active

## 配置存储

| 文件 | 内容 |
|------|------|
| `~/.forja/config.json` | 全局配置（语言、并行数） |
| `~/.forja/workspaces.json` | workroot 注册表 |
| `~/.forja/workspaces/<hash>.json` | 工作区配置（targets、工具链、模块偏好） |
| `~/.forja/servers.json` | 远程服务器列表 |
| `.forja/sync-state.json` | 同步运行状态 |

环境变量 `FORJA_CONFIG_DIR` 可覆盖 `~/.forja` 基础目录。

## 环境要求

- **Windows**：Visual Studio (MSVC) + Qt（含 jom）
- **Linux**：GCC + make + Qt
- **调试**：VSCode C/C++ 扩展
- **同步/远程**：OpenSSH

## License

MIT

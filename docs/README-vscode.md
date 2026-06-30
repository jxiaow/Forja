# Forja — VSCode 扩展

C++ 项目构建扩展，支持 Qt (qmake) 和 SDK (.sln/Makefile) 项目，覆盖本地和远程执行。

## 安装

```bash
# Stable
code --install-extension forja-<version>.vsix

# Dev
code --install-extension forja-<version>-dev.vsix
```

扩展和 CLI 共享配置存储（`~/.forja/projects/<hash>.json`），在任一侧做的变更在另一侧立即可见。

## 快速开始

1. 打开包含 `.pro`、`.sln` 或 `Makefile` 的工作区
2. 扩展自动激活，状态栏出现构建按钮
3. 点击活动栏 Forja 图标打开配置面板，完成初始设置：
   - **概览**页查看当前状态和待办项
   - **环境**页选择 Qt / Visual Studio 工具链
   - **项目**页选择要构建的项目文件
4. 状态栏切换 Debug/Release、x86/x64
5. 点击 Build 编译，Run 运行

> 也可以用 CLI 完成初始配置：`forja init && forja use target --project app.pro`

## 状态栏

| 按钮 | 说明 |
|------|------|
| `项目名 · Debug x86` | 点击打开操作菜单：切换模式/架构、执行构建、切换项目、切换执行位置 |
| `Run` | 构建并运行；构建中显示旋转图标 |
| `Debug` | 构建并启动调试 |
| `同步` | 同步启用时显示，点击上传变更文件 |

切换 mode/arch 后自动执行 QMake（Qt 项目），确保 Makefile 与配置一致。

## 命令

命令面板（`Ctrl+Shift+P`）搜索 `Forja`：

| 命令 | 说明 |
|------|------|
| `forja.build` | 编译当前目标 |
| `forja.run` | 编译并运行 |
| `forja.run.detached` | 后台编译并运行 |
| `forja.stop` | 停止运行中的程序 |
| `forja.clean` | 清理构建产物 |
| `forja.sync` | 同步变更文件到服务器 |
| `forja.config.openPage` | 打开配置面板指定页 |
| `forja.qt.selectProject` | 选择 .pro 文件 |
| `forja.qt.qmake` | 生成 Makefile |
| `forja.qt.rcc` | 编译 .qrc 资源 |
| `forja.qt.designer` | 用 Qt Designer 打开 .ui |
| `forja.qt.testConnection` | 测试 SSH 连接 |
| `forja.sdk.build` | 编译 SDK 项目 |
| `forja.sdk.rebuild` | 重新编译 SDK |
| `forja.sdk.clean` | 清理 SDK |

## 配置面板

点击活动栏 Forja 图标打开，包含以下页面：

| 页面 | 内容 |
|------|------|
| **概览** | 项目名称、环境状态、C/C++ 标准、QMake TARGET、IntelliSense 配置 |
| **环境** | Qt 路径、VS DevShell、Designer 路径；SDK 的 Visual Studio 配置 |
| **项目** | 选择 .pro / .sln / Makefile，支持浏览工作区外项目 |
| **同步** | 服务器配置、远程路径、同步开关、忽略规则 |

在配置面板中修改 mode/arch 会同步写入 activeTarget，CLI 的 `forja build` 立即生效。

## 远程执行

Forja 支持通过 SSH 在远程服务器上构建和运行：

```bash
# 1. 添加服务器（CLI 或配置面板）
forja server add --name dev --host 192.168.1.10 --username dev

# 2. 配置远程执行目标
forja use remote --server dev --remote-path /home/dev/workspace

# 3. 远程初始化
forja init --remote

# 4. 切换执行位置
forja use execution --remote
```

切换后，状态栏 Build/Run 自动走远程路径。远程诊断：`forja doctor --remote`。

远程 Forja 二进制默认安装在 `$HOME/.forja/bin/forja`，可通过 `forja use remote forja-bin set --path <path>` 覆盖。

## 同步

基于 git diff 增量上传变更文件，适用于本地编辑、远端编译的场景：

1. 配置面板「同步」页配置服务器（一次配置，所有项目共享）
2. 设置远程路径并开启同步
3. 点击状态栏「同步」按钮或执行 `forja sync`
4. 仅上传有变化的文件

认证方式：SSH 密钥（默认）或密码（通过 SSH_ASKPASS 机制）。

## 诊断与修复

```bash
forja doctor                # 本地诊断：检查配置完整性
forja doctor --remote       # 远程诊断：检查 SSH/Forja/锁状态
forja doctor fix --remote   # 自动修复：部署/更新远程 Forja
```

诊断覆盖：配置文件损坏、工具链缺失、项目文件不存在、远程锁死、SSH 连接失败等。

## 配置存储

| 文件 | 内容 |
|------|------|
| `~/.forja/projects/<hash>.json` | 当前 workspace 的 Qt/SDK/sync/remote 配置 |
| `~/.forja/servers.json` | 服务器列表 |
| `.forja/sync-state.json` | 同步运行状态 |

主要配置项：

| 配置项 | 说明 |
|--------|------|
| `qtPath` | Qt 安装路径（留空自动检测） |
| `vsDevShellPath` | Launch-VsDevShell.ps1 路径 |
| `vsInstall` | Visual Studio 安装根目录 |
| `mode` | 构建模式：debug / release |
| `arch` | 目标架构：x86 / x64 |
| `pinnedProject` | 当前固定的项目文件 |
| `designerPath` | Qt Designer 路径 |
| `qmakeTarget` | 覆盖 QMake TARGET |

## 环境要求

- **Windows**：Visual Studio（MSVC 工具链）+ Qt（含 jom）
- **Linux**：gcc/g++ + make + Qt
- **调试**：需安装 C/C++ 扩展
- **同步/远程**：OpenSSH 可用（Windows 10+ 自带）

## License

MIT

# Forja — VSCode 扩展

C++ 项目构建扩展，支持 Qt (qmake) 和 C++ (.sln/Makefile) 项目。本地构建、运行和环境管理由扩展与 CLI 共同提供；开启远程模式后，所有命令自动 bridge 到远端执行。

## 安装

```bash
# Stable
code --install-extension forja-<version>.vsix

# Dev
code --install-extension forja-<version>-dev.<timestamp>.vsix
```

扩展和 CLI 共享新配置存储（`~/.forja/workspaces/<hash>.json`），在任一侧做的变更在另一侧立即可见。旧 `~/.forja/projects/` 不读取、不迁移、不兼容。

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
| `Forja: Status` | 查看状态 |
| `Forja: Init Workspace` | 初始化工作区 |
| `Forja: List` | 列出候选项 |
| `Forja: Use Target` | 选择/切换目标 |
| `Forja: Remote` | 查看远程模式状态 |
| `Forja: Open Config Page` | 打开配置面板 |
| `Forja: Server` | 管理远程服务器 |
| `Forja: Build` | 编译当前目标 |
| `Forja: Run` | 编译并运行 |
| `Forja: Debug` | 编译并调试 |
| `Forja: Stop` | 停止运行中的程序 |
| `Forja: Clean` | 清理构建产物 |
| `Forja: Sync Changes` | 同步变更文件 |
| `Forja: Open with Qt Designer` | 用 Qt Designer 打开 .ui 文件 |
| `Forja: 打开远程页` | 打开远程配置页 |
| `Forja: 测试远程连接` | 测试 SSH 连接 |
| `Forja Remote: Bootstrap` | 部署 CLI 到远端 |

## 配置面板

点击活动栏 Forja 图标打开，包含以下页面：

| 页面 | 内容 |
|------|------|
| **项目** | 选择 .pro / .sln / Makefile，构建模式，IntelliSense 配置 |
| **环境** | Qt 路径、VS DevShell、Designer 路径、C++ 的 Visual Studio 配置 |
| **同步** | 服务器配置、远程路径、同步开关、忽略规则 |
| **高级** | 扫描排除目录、自定义命令等 |

在配置面板中修改 mode/arch 会同步写入 activeTarget，CLI 的 `forja build` 立即生效。

## 远程模式

开启远程模式后，所有命令（除 remote 管理和 sync 外）自动 bridge 到远端执行，包括构建、运行、调试、状态查询等。

```bash
# 1. 添加服务器（CLI 或配置面板）
forja server add --name dev --host 192.168.1.10 --username dev

# 2. 开启远程模式
forja remote on

# 3. 部署远端 Forja CLI（可选）
forja remote bootstrap

# 4. 同步变更文件
forja sync
```

服务器记录由 `forja server` 管理；远程模式开关属于当前 workroot。

## 同步

基于 git diff 增量上传变更文件，适用于本地编辑、远端编译的场景：

1. 使用 Forja: Server 管理服务器记录（一次配置，所有项目共享）
2. 使用 `forja remote on` 开启远程模式
3. 点击状态栏「同步」按钮或执行 `forja sync`
4. 仅上传有变化的文件

认证方式：SSH 密钥（默认）或密码（通过 SSH_ASKPASS 机制）。

## 诊断与修复

```bash
forja status                # 查看配置就绪状态和下一步操作
```

诊断覆盖本地配置、工具链和项目文件；远端连通性通过 `forja remote bootstrap` 与 `forja sync --dry-run` 验证。

## 配置存储

| 文件 | 内容 |
|------|------|
| `~/.forja/workspaces.json` | 已注册 workroot |
| `~/.forja/workspaces/<hash>.json` | 当前 workspace 的 Qt/C++/sync/remote 配置 |
| `~/.forja/servers.json` | 服务器列表及最近使用的远端目录 |
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
| `executableName` | 构建后重命名可执行文件 |

## 环境要求

- **Windows**：Visual Studio（MSVC 工具链）+ Qt（含 jom）
- **Linux**：gcc/g++ + make + Qt
- **调试**：需安装 C/C++ 扩展
- **同步/远程**：OpenSSH 可用（Windows 10+ 自带）

## License

MIT

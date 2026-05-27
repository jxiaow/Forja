# Compilot

C++ 项目构建扩展，支持 Qt (qmake) 和 SDK (.sln/Makefile) 项目。

## 安装

```bash
code --install-extension compilot-x.x.x.vsix
```

## 功能

- 状态栏一键切换 Debug/Release、x86/x64
- QMake / Build / Clean / Run / Debug
- RCC 资源编译（自动增量检测）
- 自动检测 Visual Studio 和 Qt 环境
- 配置面板可视化管理构建参数
- 远程同步：基于 git diff 增量上传变更文件
- `.pri`/`.pro` 文件监听：删除源文件时提示从工程文件中移除
- 自动生成 `c_cpp_properties.json` 用于 IntelliSense
- SDK 模块：.sln / Makefile 项目的 Build / Rebuild / Clean

## 快速开始

1. 打开包含 `.pro`、`.sln` 或 `Makefile` 的工作区
2. 扩展自动激活，状态栏出现构建按钮
3. 点击状态栏选择 Qt 或 SDK 项目、模式和架构
4. Qt 项目执行 QMake → Build → Run；SDK 项目执行 Build / Rebuild / Clean

## 状态栏

| 按钮 | 说明 |
|------|------|
| `项目名 · Debug x86` | 点击打开操作菜单：切换模式/架构、执行构建、切换项目、切换执行位置 |
| `项目名 · Debug x86 · 远程` | 远程模式时显示，Run 按钮触发远程部署流程 |
| `Run` | 本地模式：构建并运行；远程模式：远程编译部署；构建中显示旋转图标 |
| `Debug` | 构建并启动调试 |
| `同步` | 远程同步启用时显示，点击上传变更文件 |

## 命令

命令面板（`Ctrl+Shift+P`）搜索 `Compilot`：

| 命令 | 说明 |
|------|------|
| Compilot Qt: 选择项目 | 选择 .pro 文件作为当前项目 |
| Compilot Qt: QMake | 生成 Makefile |
| Compilot Qt: Build | 编译 |
| Compilot Qt: Run | 编译并运行 |
| Compilot Qt: Clean | 清理 |
| Compilot Qt: 停止 | 终止程序 |
| Compilot Qt: 调试 | 编译并调试 |
| Compilot Qt: RCC 编译 | 编译 .qrc 资源 |
| Compilot Qt: 用 Qt Designer 打开 | 打开 .ui 文件 |
| Compilot Qt: 同步变更文件到远程 | SCP 上传变更 |
| Compilot Qt: 测试远程连接 | 测试 SSH 连接 |
| Compilot Remote: Run Deploy | 远程编译部署（完整流程） |
| Compilot Remote: Restart | 远程重启程序（不重新编译） |
| Compilot Remote: Show Logs | 显示远程部署日志 |
| Compilot SDK: Build | 编译 SDK 项目 |
| Compilot SDK: Rebuild | 重新编译 |
| Compilot SDK: Clean | 清理 |

## 配置面板

点击活动栏 Compilot 图标打开：

- **概览**：项目名称、环境状态、C/C++ 标准、QMake TARGET、IntelliSense 生成
- **环境**：Qt VS DevShell、Qt 路径、Designer 路径、Qt 源码路径，以及 SDK Visual Studio 配置
- **同步**：服务器配置、远程路径、同步开关、忽略规则
- **高级**：文件提醒和 QMake 提醒等开关

## 远程编译部署（设计稿，暂未实现）

完整远程编译部署流程（branchSync、baselineCheck、build、transfer、stop、launch）仍是设计稿。当前 VSCode 侧已实现的是远程同步配置和文件同步，不读取独立的部署配置文件。

## 远程同步

适用于本地编辑、远程编译的场景：

1. 配置面板「同步」Tab 配置服务器（一次配置，所有项目共享）
2. 设置远程路径并开启同步
3. 点击状态栏「同步」按钮或命令面板执行同步
4. 基于 git diff 识别变更，仅上传有变化的文件

认证方式：SSH 密钥（默认）或密码（通过 SSH_ASKPASS 机制，无需 sshpass）。

## 配置项

项目级配置通过 settings store 存储在用户数据目录 `~/.compilot/projects/<hash>.json`，服务器列表存储在 `~/.compilot/servers.json`，同步运行状态存储在 `.compilot/sync-state.json`。

| 配置项 | 说明 |
|--------|------|
| `qtPath` | Qt 安装路径（留空自动检测） |
| `vsDevShellPath` | Launch-VsDevShell.ps1 路径 |
| `designerPath` | Qt Designer 路径 |
| `qtSourcePath` | Qt 源码路径（调试跳转用） |
| `mode` | 构建模式：debug / release |
| `arch` | 目标架构：x86 / x64 |
| `vsInstall` | Visual Studio 安装根目录；Qt 推导 DevShell，SDK 推导 VsDevCmd |
| `qmakeTarget` | 覆盖 QMake TARGET |
| `rccProjectPath` | RCC 项目路径（留空自动扫描） |
| `pinnedProject` | 当前固定的项目文件：Qt 为 `.pro`，SDK 为 `.sln` 或 `Makefile` |
| `cStandard` / `cppStandard` | C/C++ 标准（IntelliSense 用） |
| `fileSyncPromptEnabled` | 删除文件时是否提示从 .pri/.pro 移除 |
| `qmakeReminderEnabled` | .pro/.pri 变更后是否提示重新 QMake |

## 环境要求

- **Windows**：Visual Studio（MSVC 工具链）+ Qt（含 jom）
- **Linux**：gcc/g++ + make + Qt
- **调试**：需安装 C/C++ 扩展（推荐 [v1.24.3](https://github.com/microsoft/vscode-cpptools/releases/tag/v1.24.3)）
- **远程同步**：OpenSSH 可用（Windows 10+ 自带）

## License

MIT

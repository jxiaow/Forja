# Compilot — VSCode Extension

VSCode 扩展，为 C++ 项目提供一站式构建、运行、调试和环境管理能力。

- **Qt 模块**：基于 qmake 的 Qt/C++ 项目，支持 Windows（MSVC）和 Linux
- **SDK 模块**：基于 .sln 或 Makefile 的 SDK/库项目，支持 Windows（MSBuild）和 Linux（make）

## 功能

### Qt 模块

- 状态栏快速切换 Debug/Release 模式和 x86/x64 架构
- 一键执行 QMake、Build、Clean、Run、Debug
- 自动检测 Visual Studio 和 Qt 安装路径
- 配置面板：分 Tab 可视化管理构建参数
- 远程同步：基于 git diff 增量同步变更文件到远程服务器
- 资源管理器右键 `.ui` 文件用 Qt Designer 打开
- `.pri`/`.pro` 文件监听：删除源文件时提示从工程文件中移除
- 自动生成 `c_cpp_properties.json` 用于 IntelliSense

### SDK 模块

- 自动扫描工作区内的 `.sln` 和 `Makefile` 项目
- Build / Rebuild / Clean 操作
- 状态栏显示当前项目和构建模式

## 激活条件

工作区包含以下任一文件时自动激活：`.pro`、`.sln`、`Makefile`

---

## 快速开始

### Qt 项目

1. 打开包含 `.pro` 文件的工作区
2. 扩展自动激活，状态栏出现构建按钮
3. 点击状态栏图标选择模式（Debug/Release）和架构（x86/x64）
4. 依次执行：**QMake → Build → Run**

### SDK 项目

1. 打开包含 `.sln` 或 `Makefile` 的工作区
2. SDK 模块自动激活，状态栏出现构建按钮
3. 通过操作菜单选择项目并执行 Build/Rebuild/Clean

---

## 状态栏

| 按钮 | 说明 |
|------|------|
| `$(bug) 项目名 · Debug x86` | 点击打开操作菜单：切换模式/架构、执行构建、切换项目 |
| `$(play) Run` | 构建并运行；构建中显示旋转图标；运行中变为 Stop |
| `$(debug-alt) Debug` | 构建并启动调试（需安装 C/C++ 扩展） |
| `$(cloud-upload) 同步` | 远程同步启用时显示，点击上传变更文件 |

---

## 配置面板

点击活动栏 Compilot 图标打开配置面板，分为三个 Tab：

### 概览

- **项目名称**：当前项目，可点击切换到其他 `.pro` 文件
- **环境状态**：标签形式展示 VS/Qt/jom 的检测结果
- **项目设置**：C/C++ 标准、QMake TARGET、IntelliSense 配置生成
- **更多设置**（折叠）：排除目录、手动指定 .pro、文件同步提醒、QMake 提醒

### 环境

- **Visual Studio**（仅 Windows）：显示 DevShell 路径及来源，支持手动覆盖
- **Qt**：显示 Qt 路径及来源，支持手动覆盖，可配置 Designer 和源码路径

### 同步

远程同步配置，将本地变更通过 SCP 上传到远程服务器：

- **启用开关**：按项目独立控制
- **服务器配置（全局）**：地址、端口、用户名、认证方式（SSH 密钥/密码）
- **项目路径**：当前项目对应的远程目录
- **同步变更文件**：基于 git diff 获取变更列表，跳过已同步且未再修改的文件

---

## 远程同步

适用于本地编辑、远程编译的开发场景。

### 使用方式

1. 在配置面板「同步」Tab 中配置服务器信息（一次配置，所有项目共享）
2. 设置当前项目的远程路径并开启同步
3. 修改代码后触发同步：
   - 点击状态栏「同步」按钮
   - 或在命令面板执行 `Compilot Qt: 同步变更文件到远程`
4. 扩展通过 git diff 识别变更文件，仅上传有变化的部分

### 认证方式

- **SSH 密钥**（默认）：使用 `~/.ssh/id_rsa` 或指定私钥路径
- **密码**：首次同步时弹窗输入，会话内缓存（需安装 `sshpass`）

### 同步逻辑

1. 通过 `git diff` 获取变更文件列表
2. 对比本地同步记录（`.compilot/sync-state.json`），跳过已同步且未再修改的文件
3. 上传成功后记录文件 mtime，避免重复推送

### 前提条件

- Windows 10+ 自带 OpenSSH（`ssh`/`scp` 命令可用）
- 密码认证需安装 `sshpass`（可通过 Git Bash 或 WSL 获取）

---

## 命令

通过命令面板（`Ctrl+Shift+P`）搜索 `Compilot` 可访问所有命令：

### Qt 命令

| 命令 | 说明 |
|------|------|
| `Compilot Qt: 选择项目` | 选择 `.pro` 文件作为当前项目 |
| `Compilot Qt: 显示操作菜单` | 打开操作菜单 |
| `Compilot Qt: QMake` | 运行 qmake 生成 Makefile |
| `Compilot Qt: Build` | 编译项目 |
| `Compilot Qt: Clean` | 清理构建产物 |
| `Compilot Qt: Run` | 构建并运行 |
| `Compilot Qt: 停止` | 终止正在运行的程序 |
| `Compilot Qt: 调试` | 构建并启动调试 |
| `Compilot Qt: 用 Qt Designer 打开` | 用 Designer 打开选中的 `.ui` 文件 |
| `Compilot Qt: 同步变更文件到远程` | 上传 git 变更文件到远程服务器 |
| `Compilot Qt: 测试远程连接` | 测试 SSH 连接是否正常 |

### SDK 命令

| 命令 | 说明 |
|------|------|
| `Compilot SDK: Build` | 编译当前 SDK 项目 |
| `Compilot SDK: Rebuild` | 重新编译（Clean + Build） |
| `Compilot SDK: Clean` | 清理构建产物 |
| `Compilot SDK: Show Actions` | 打开 SDK 操作菜单 |

---

## 配置项

项目级配置存储在 `.compilot/settings.json`：

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `qtPath` | string | Qt 安装路径（留空则自动检测） |
| `designerPath` | string | Qt Designer 可执行文件路径 |
| `qtSourcePath` | string | Qt 源码路径（用于调试时源码跳转） |
| `vsDevShellPath` | string | `Launch-VsDevShell.ps1` 路径 |
| `selectedProject` | object | 当前选中的 `.pro` 文件 |
| `manualProPath` | string | 手动指定的 `.pro` 文件绝对路径 |
| `qmakeTarget` | string | 覆盖 QMake TARGET 值 |
| `arch` | `x86` \| `x64` | 目标架构，默认 `x86` |
| `mode` | `debug` \| `release` | 构建模式，默认 `debug` |
| `cStandard` | string | C 语言标准（IntelliSense 用） |
| `cppStandard` | string | C++ 标准（IntelliSense 用） |
| `scanExcludeDirs` | string[] | IntelliSense 扫描时额外排除的目录 |
| `fileSyncPromptEnabled` | boolean | 删除文件时是否提示从 .pri/.pro 中移除 |
| `qmakeReminderEnabled` | boolean | .pro/.pri 变更后是否提示重新 QMake |

VSCode settings.json 中保留的配置（machine scope）：

| 配置项 | 说明 |
|--------|------|
| `compilot.qt.qtPath` | Qt 安装路径 |
| `compilot.qt.vsDevShellPath` | Launch-VsDevShell.ps1 路径 |
| `compilot.qt.designerPath` | Qt Designer 路径 |
| `compilot.qt.mode` | 构建模式 |
| `compilot.qt.arch` | 目标架构 |
| `compilot.sdk.selectedProject` | SDK 当前项目 |
| `compilot.sdk.mode` | SDK 构建模式 |
| `compilot.sdk.arch` | SDK 目标架构 |
| `compilot.sdk.vsDevCmdPath` | VsDevCmd.bat 路径 |
| `compilot.sdk.scanDepth` | 项目扫描深度 |

---

## 注意事项

- **Windows**：需安装 Visual Studio（含 MSVC 工具链），构建使用 `jom`（Qt 自带）或 `nmake`
- **Linux**：需安装 `gcc`/`g++` 和 `make`，Qt 需在 PATH 中或通过配置指定
- **Run/Debug**：依赖 qmake 生成的 Makefile 确定可执行文件路径，首次运行前请先执行 QMake
- **调试与代码跳转**：需安装 C/C++ 扩展。基于 VSCode 的 IDE（Kiro、Cursor 等）建议使用 [v1.24.3](https://github.com/microsoft/vscode-cpptools/releases/tag/v1.24.3)，兼容性最佳
- **Qt Designer**：优先使用配置的 `designerPath`，未配置时从 `qtPath` 推断
- **文件监听**：`.pri`/`.pro` 变更后会提示重新运行 QMake
- **远程同步**：需 OpenSSH 可用（Windows 10+ 自带），密码认证需安装 `sshpass`

# Compilot

VSCode 扩展，为 C++ 项目提供构建、运行、调试和环境配置能力。支持两大模块：

- **Qt 模块**：基于 qmake 的 Qt/C++ 项目，Windows（MSVC）和 Linux
- **SDK 模块**：基于 .sln 或 Makefile 的 SDK/库项目

## 功能

### Qt 模块

- 状态栏快速切换 Debug/Release 模式和 x86/x64 架构
- 一键 QMake、Build、Clean、Run、Debug
- 自动检测 Visual Studio 和 Qt 安装路径
- 配置面板：Tab 分区可视化管理所有构建参数
- 远程同步：基于 git diff 将变更文件同步到远程服务器
- 资源管理器右键 `.ui` 文件：用 Qt Designer 打开
- `.pri`/`.pro` 文件监听：删除 `.cpp`/`.h`/`.ui` 文件时提示同步移除
- 自动生成 `c_cpp_properties.json`（IntelliSense 配置）

### SDK 模块

- 自动扫描工作区内的 `.sln` 和 `Makefile` 项目
- Build / Rebuild / Clean 操作
- 状态栏显示当前 SDK 项目和模式
- 支持 Windows（MSBuild）和 Linux（make）

## 激活条件

以下场景会激活扩展：
- 工作区包含 `.pro` 文件
- 工作区包含 `.sln` 文件
- 工作区包含 `Makefile`

---

## 快速开始

### Qt 项目

1. 打开包含 `.pro` 文件的工作区
2. 扩展自动激活，状态栏出现构建按钮
3. 点击状态栏图标选择模式（Debug/Release）和架构（x86/x64）
4. 依次执行：**QMake → Build → Run**

### SDK 项目

1. 打开包含 `.sln` 或 `Makefile` 的工作区
2. SDK 模块自动激活，状态栏出现 SDK 构建按钮
3. 通过操作菜单选择项目和执行 Build/Rebuild/Clean

---

## 状态栏

| 按钮 | 说明 |
|------|------|
| `$(bug) 项目名 · Debug x86` | 点击打开操作菜单，可切换模式/架构、执行构建、切换项目 |
| `$(play) Run` | 构建并运行；构建中显示 `$(loading~spin) 构建中...`；运行中变为 `$(debug-stop) Stop` |
| `$(debug-alt) Debug` | 构建并启动调试（需安装 C/C++ 扩展） |
| `$(cloud-upload) 同步` | 远程同步已启用时显示，点击同步变更文件 |

---

## 配置面板

点击活动栏 Compilot 图标打开配置面板。面板分为三个 Tab：

### 概览

- **项目名称**：当前项目，点击「切换」选择其他 `.pro` 文件
- **环境状态**：以芯片标签展示 VS/Qt/jom 检测状态
- **项目设置**：C/C++ 标准、QMake TARGET、生成 IntelliSense 配置
- **更多设置**（折叠）：排除目录、手动指定 .pro、文件同步提醒、QMake 提醒

### 环境

- **Visual Studio**（仅 Windows）：显示当前 DevShell 路径及来源，可手动覆盖
- **Qt**：显示当前 Qt 路径及来源，可手动覆盖，可选配置 Designer 和源码路径

### 同步

远程同步功能，将本地变更文件通过 SCP 上传到远程服务器。

- **启用开关**：每个项目独立控制
- **服务器配置（全局）**：地址、端口、用户名、认证方式（SSH 密钥/密码），所有项目共享
- **项目路径**：当前项目在远程服务器上的对应路径
- **同步变更文件**：基于 git diff 获取变更文件，跳过已同步且未再修改的文件

---

## 远程同步

适用于本地编辑、远程编译的开发场景。

### 使用方式

1. 在配置面板「同步」Tab 中配置服务器信息（一次配置，所有项目共享）
2. 设置当前项目的远程路径并开启同步
3. 修改代码后，通过以下方式触发同步：
   - 点击状态栏「同步」按钮
   - 命令面板执行 `Compilot Qt: 同步变更文件到远程`
4. 扩展自动识别 git 变更文件，只上传需要同步的部分

### 认证方式

- **SSH 密钥**（默认）：使用 `~/.ssh/id_rsa` 或指定私钥路径
- **密码**：首次同步时弹窗输入，会话内缓存（需要安装 `sshpass`）

### 同步逻辑

- 通过 `git diff` 获取变更文件列表
- 对比本地同步记录（`.qtpilot/sync-state.json`），跳过已同步且未再修改的文件
- 上传成功后记录文件 mtime，避免重复推送

### 前提条件

- Windows 10+ 自带 OpenSSH（`ssh`/`scp` 命令可用）
- 密码认证需要安装 `sshpass`（可通过 Git Bash 或 WSL 获取）

---

## 命令

通过命令面板（`Ctrl+Shift+P`）搜索 `Compilot` 可访问所有命令：

### Qt 命令

| 命令 | 说明 |
|------|------|
| `Compilot Qt: 选择项目` | 手动选择 `.pro` 文件 |
| `Compilot Qt: 显示操作菜单` | 打开状态栏操作菜单 |
| `Compilot Qt: QMake` | 运行 qmake 生成 Makefile |
| `Compilot Qt: Build` | 编译项目 |
| `Compilot Qt: Clean` | 清理构建产物 |
| `Compilot Qt: Run` | 构建并运行 |
| `Compilot Qt: 停止` | 终止正在运行的程序 |
| `Compilot Qt: 调试` | 构建并启动调试 |
| `Compilot Qt: 用 Qt Designer 打开` | 用 Qt Designer 打开选中的 `.ui` 文件 |
| `Compilot Qt: 同步变更文件到远程` | 将 git 变更文件上传到远程服务器 |
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

配置存储在 `.qtpilot/settings.json` 中（项目级），不再使用 VSCode settings.json：

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `qtPath` | string | Qt 路径（留空自动检测） |
| `designerPath` | string | Qt Designer 可执行文件路径 |
| `qtSourcePath` | string | Qt 源码路径（调试用） |
| `vsDevShellPath` | string | `Launch-VsDevShell.ps1` 路径 |
| `selectedProject` | object | 当前选中的 `.pro` 文件记录 |
| `manualProPath` | string | 手动指定 `.pro` 文件绝对路径 |
| `qmakeTarget` | string | QMake TARGET 覆盖 |
| `arch` | `x86`/`x64` | 目标架构，默认 `x86` |
| `mode` | `debug`/`release` | 构建模式，默认 `debug` |
| `cStandard` | string | IntelliSense C 标准 |
| `cppStandard` | string | IntelliSense C++ 标准 |
| `scanExcludeDirs` | string[] | IntelliSense 额外排除目录 |
| `fileSyncPromptEnabled` | boolean | 文件变更时是否提示同步 |
| `qmakeReminderEnabled` | boolean | .pro/.pri 变更后是否提示 QMake |

VSCode settings.json 中仍保留以下配置（machine scope）：

| 配置项 | 说明 |
|--------|------|
| `compilot.qt.qtPath` | Qt 安装路径 |
| `compilot.qt.vsDevShellPath` | Launch-VsDevShell.ps1 路径 |
| `compilot.qt.designerPath` | Qt Designer 路径 |
| `compilot.qt.mode` | 编译模式 |
| `compilot.qt.arch` | 目标架构 |
| `compilot.sdk.selectedProject` | SDK 当前项目 |
| `compilot.sdk.mode` | SDK 编译模式 |
| `compilot.sdk.arch` | SDK 目标架构 |
| `compilot.sdk.vsDevCmdPath` | VsDevCmd.bat 路径 |
| `compilot.sdk.scanDepth` | 项目扫描深度 |

---

## 注意事项

- **Windows**：需要安装 Visual Studio（含 MSVC 工具链），构建使用 `jom`（Qt 自带）或 `nmake`
- **Linux**：需要安装 `gcc`/`g++` 和 `make`，Qt 需在 PATH 中或通过配置指定
- **Run/Debug**：依赖 qmake 生成的 `Makefile` 来确定可执行文件路径，请确保在 Run/Debug 前已执行过 QMake
- **调试和代码跳转**：需要安装 C/C++ 扩展。基于 VSCode 的 IDE（如 Kiro、Cursor 等）请使用 [v1.24.3](https://github.com/microsoft/vscode-cpptools/releases/tag/v1.24.3) 版本，该版本兼容性最佳
- **Qt Designer**：优先使用配置的 `designerPath`，否则尝试从 `qtPath` 推断
- `.pri`/`.pro` 文件变更后会提示重新运行 QMake
- **远程同步**：需要 OpenSSH 可用（Windows 10+ 自带），密码认证需要 `sshpass`

---

## CLI

Compilot 还提供独立的命令行工具 `compilot-cli`，供终端手动使用、脚本自动化和 AI 编程工具集成。

### 安装

```bash
# 从本地打包文件安装
npm install -g compilot-cli-x.x.x.tgz
```

### 快速开始

```bash
# 在 Qt 项目目录下初始化（检测环境，只需一次）
cd your-qt-project
compilot qt init --execute

# 之后直接用
compilot qt build --execute
compilot qt run --execute

# SDK 项目
compilot sdk build --execute
compilot sdk status --json
```

### 与扩展的关系

| | 扩展（IDE 内） | CLI（终端/AI 工具） |
|---|---|---|
| 执行方式 | VSCode Task（IDE 终端） | cp.exec（Node.js 子进程） |
| 实时输出 | ✅ 终端里直接看 | ✅ streaming 模式 |
| 后台启动 | 不需要（终端不阻塞 IDE） | `--detach`（CLI 立即返回） |
| 适用场景 | 日常开发 | AI 工具集成、脚本、CI |

两者共享底层逻辑（命令规划、环境检测、配置读写），执行方式不同。

### AI 工具集成

安装后附带 Skill 文件（`skills/compilot/SKILL.md`），复制到对应 AI 工具的 skills 目录即可：

- **Kiro**: 项目内 `skills/compilot/` 目录自动加载
- **其他工具**: 复制 `SKILL.md` 到对应 skills 目录

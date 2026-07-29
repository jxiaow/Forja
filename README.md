# Qt Pilot

VSCode 扩展，为基于 qmake 的 Qt/C++ 项目提供构建、运行、调试和环境配置能力，当前以 Windows（MSVC）场景为主。

## 功能

- 状态栏快速切换 Debug/Release 模式和 x86/x64 架构
- 一键 QMake、Build、Clean、Run、Debug
- 自动检测 Visual Studio 和 Qt 安装路径
- 配置面板：可视化管理所有构建参数
- 资源管理器右键 `.ui` 文件：用 Qt Designer 打开
- `.pri`/`.pro` 文件监听：删除 `.cpp`/`.h`/`.ui` 文件时提示同步移除
- 自动生成 `c_cpp_properties.json`（IntelliSense 配置）

## 激活条件

以下场景会激活扩展：
- 工作区包含 `.pro` 文件
- 打开 Qt Pilot 侧边栏配置视图
- 从命令面板执行 Qt Pilot 命令

---

## 快速开始

1. 打开包含 `.pro` 文件的工作区
2. 扩展自动激活，状态栏出现构建按钮
3. 点击状态栏图标选择模式（Debug/Release）和架构（x86/x64）
4. 依次执行：**QMake → Build → Run**

---

## 状态栏

| 按钮 | 说明 |
|------|------|
| `$(bug) 项目名 · Debug x86` | 点击打开操作菜单，可切换模式/架构、执行构建、切换项目 |
| `$(play) Run` | 构建并运行；构建中显示 `$(loading~spin) 构建中...`；运行中变为 `$(debug-stop) Stop` |
| `$(debug-alt) Debug` | 构建并启动调试（需安装 C/C++ 扩展） |

---

## 配置面板

点击活动栏 Qt Pilot 图标打开配置面板。

### 环境状态

顶部状态栏显示三个指示点：
- **VS**（仅 Windows）：Visual Studio DevShell 是否可用
- **Qt**：Qt 是否检测到
- **make/jom**：构建工具是否可用

点击状态栏可展开详情，查看具体版本信息，或点击「刷新检测」重新扫描。

### 项目

显示当前选中的项目名称，点击「切换」可选择其他 `.pro` 文件。

**高级设置**（展开）：
- **C/C++ 标准**：IntelliSense 使用的语言标准
- **排除目录**：生成 IntelliSense 配置时额外跳过的目录
- **QMake TARGET**：覆盖 `.pro` 文件中的 TARGET 名称（留空则使用默认值）
- **生成 IntelliSense 配置**：手动重新生成 `.vscode/c_cpp_properties.json`

### Visual Studio（仅 Windows）

显示当前生效的 DevShell 路径及来源（自动检测 / 手动配置）。

展开「手动覆盖」可：
- 从下拉快速选择 VS 2019/2022 各版本
- 手动输入 `Launch-VsDevShell.ps1` 路径，或点击「浏览」选择

### Qt

显示当前生效的 Qt 路径及来源。

展开「手动覆盖」可：
- 在输入框中直接输入路径
- 点击输入框右侧下拉箭头，从自动扫描到的所有 Qt 版本中选择
- 点击「浏览」选择目录
- 可选配置 `designer.exe` 路径，供右键 `.ui` 文件时直接调用 Qt Designer

> Qt 路径应指向包含 `bin/qmake` 的目录，例如 `C:\Qt\5.15.2\msvc2019`。

---

## 命令

通过命令面板（`Ctrl+Shift+P`）搜索 `Qt Pilot:` 可访问所有命令：

| 命令 | 说明 |
|------|------|
| `Qt Pilot: 选择项目` | 手动选择 `.pro` 文件 |
| `Qt Pilot: 显示操作菜单` | 打开状态栏操作菜单 |
| `Qt Pilot: QMake` | 运行 qmake 生成 Makefile |
| `Qt Pilot: Build` | 编译项目 |
| `Qt Pilot: Clean` | 清理构建产物 |
| `Qt Pilot: Run` | 构建并运行 |
| `Qt Pilot: 停止` | 终止正在运行的程序 |
| `Qt Pilot: 调试` | 构建并启动调试 |
| `Qt Pilot: 用 Qt Designer 打开` | 用 Qt Designer 打开选中的 `.ui` 文件 |

---

## 配置项

在 VSCode 设置（`settings.json`）中可配置：

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `qtPilot.qtPath` | string | Qt 路径（留空自动检测） |
| `qtPilot.designerPath` | string | Qt Designer 可执行文件路径（留空则自动推断） |
| `qtPilot.vsDevShellPath` | string | `Launch-VsDevShell.ps1` 路径（留空自动检测） |
| `qtPilot.selectedProject` | string | 当前选中的 `.pro` 文件记录（扩展内部维护） |
| `qtPilot.manualProPath` | string | 手动指定 `.pro` 文件绝对路径 |
| `qtPilot.qmakeTarget` | string | QMake TARGET 覆盖（留空使用默认） |
| `qtPilot.arch` | `x86`/`x64` | 目标架构，默认 `x86` |
| `qtPilot.cStandard` | string | IntelliSense C 标准，默认 `c11` |
| `qtPilot.cppStandard` | string | IntelliSense C++ 标准，默认 `c++11` |
| `qtPilot.scanExcludeDirs` | string[] | 生成 IntelliSense 时额外排除的目录 |

---

## 注意事项

- **Windows**：需要安装 Visual Studio（含 MSVC 工具链），构建使用 `jom`（Qt 自带）或 `nmake`
- **Run/Debug**：依赖 qmake 生成的 `Makefile` 来确定可执行文件路径，请确保在 Run/Debug 前已执行过 QMake
- **调试**：需要安装 [C/C++ 扩展](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools)
- **Qt Designer**：优先使用 `qtPilot.designerPath`，否则尝试从 `qtPilot.qtPath` 推断
- `.pri`/`.pro` 文件变更后会提示重新运行 QMake

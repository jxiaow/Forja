# Qt Pilot 功能增强设计文档

**日期**: 2025-03-20
**版本**: 1.0

## 概述

Qt Pilot 是一个 VSCode 扩展，为 Qt/C++ Windows 开发提供构建工具。本次增强聚焦于：

1. 简化状态栏交互
2. 自动环境检测
3. 项目自动发现与配置
4. 构建进度可视化
5. 调试支持
6. IntelliSense 配置自动生成

## 架构

```
src/
├── extension.ts        # 入口，激活流程
├── statusBar.ts        # 状态栏 UI
├── buildManager.ts     # 构建任务管理
├── buildProgress.ts    # 新增：进度解析
├── envDetector.ts      # 新增：环境自动检测
├── projectManager.ts   # 新增：项目发现与管理
├── configPanel.ts      # 配置面板（重构）
├── configGenerator.ts  # 新增：VSCode 配置生成
├── debugger.ts         # 新增：调试支持
└── priWatcher.ts       # 文件监听（已有）
```

## 状态栏设计

### 布局

```
[项目名] [模式▼] [▶Run] [🐛Debug] [⚙操作▼]
```

### 按钮说明

| 按钮 | 显示 | 交互 | 功能 |
|------|------|------|------|
| 项目名 | `qt_linux_pc_client` | 只读 | 显示当前项目名称 |
| 模式 | `Debug▼` / `Release▼` | QuickPick | 切换构建模式 |
| Run | `▶Run` / `■Stop` | 点击 | 运行/停止程序 |
| Debug | `🐛Debug` | 点击 | 启动调试器 |
| 操作 | `⚙操作▼` | QuickPick | QMake, Build, Clean |

### Run 按钮状态

| 状态 | 显示 | 点击行为 |
|------|------|----------|
| 空闲 | `▶Run` | 执行 Build + Run |
| 运行中 | `■Stop` | 终止进程 |

### 构建进度显示

构建进行时，状态栏显示：

```
[项目名] [模式] [⟳ mainwindow.cpp 45%] [⚙操作▼]
```

- 显示当前编译文件名
- 显示进度百分比
- 解析 jom/nmake 输出获取进度

## 配置面板设计

### 分组卡片式布局

```
┌─────────────────────────────────────┐
│ 环境状态                  [重新检测] │
│  ✓ Visual Studio 2022    Community  │
│  ✓ Qt 6.5.3              MSVC 2019  │
│  ✓ jom                   并行构建   │
├─────────────────────────────────────┤
│ 项目配置                             │
│  项目: [qt_linux_pc_client.pro    ▼]│
│  架构: [x86] [x64]                  │
├─────────────────────────────────────┤
│ ▶ 高级设置                           │
│   VS DevShell 路径    [浏览]        │
│   Qt 路径             [浏览]        │
└─────────────────────────────────────┘
```

### 功能区域

**环境状态区**：
- 检测 VS 版本和版本类型（Community/Professional/Enterprise）
- 检测 Qt 版本和编译器类型
- 检测 jom/ninja 构建工具
- 提供重新检测按钮

**项目配置区**：
- 项目下拉选择器（扫描所有 .pro 文件）
- 架构切换（x86/x64 按钮）

**高级设置区**（可折叠）：
- VS DevShell 路径（自动检测填充，可手动修改）
- Qt 安装路径（自动检测填充，可手动修改）

## 激活流程

```
工作区打开
    ↓
检查 qtPilot.selectedProject 配置
    ↓
┌─ 已配置且 .pro 存在 → 直接使用，开始工作
│
├─ 已配置但 .pro 不存在 → 重新扫描
│
└─ 未配置 → 扫描 **/*.pro
     ├─ 0 个 → 显示提示，等待手动配置
     ├─ 1 个 → 自动选中并保存
     └─ 多个 → 弹出 QuickPick 选择，保存
              ↓
         解析 .pro 文件
              ↓
         保存到 .vscode/settings.json
              ↓
         检测环境（VS/Qt/jom）
              ↓
         开始工作
```

## 环境自动检测

### Visual Studio 检测

**检测方法**：
1. 注册表查询：`HKLM\SOFTWARE\Microsoft\VisualStudio\{version}`
2. 常见路径扫描：
   - `C:\Program Files\Microsoft Visual Studio\2022\{Community,Professional,Enterprise}`
   - `C:\Program Files (x86)\Microsoft Visual Studio\2019\{Community,Professional,Enterprise}`

**获取信息**：
- 安装路径
- 版本号
- 版本类型
- DevShell 路径：`{installDir}\Common7\Tools\Launch-VsDevShell.ps1`

### Qt 检测

**检测方法**：
1. 环境变量 `QTDIR` / `Qt5_DIR` / `Qt6_DIR`
2. 常见路径扫描：
   - `C:\Qt\{version}\{compiler}`
   - `C:\QtCompile\{compiler}`
   - 用户自定义路径

**获取信息**：
- Qt 版本
- 编译器类型（MSVC 2019/2022, MinGW）
- include 路径
- bin 路径

### 构建工具检测

**jom 检测**：
- PATH 环境变量
- Qt bin 目录
- 常见安装路径

## 配置存储

### settings.json

```json
{
  "qtPilot.selectedProject": "qt_linux_pc_client/qt_linux_pc_client.pro",
  "qtPilot.arch": "x86",
  "qtPilot.buildMode": "debug",
  "qtPilot.vsDevShellPath": "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\Tools\\Launch-VsDevShell.ps1",
  "qtPilot.qtPath": "C:\\QtCompile\\msvc2019-accessible",
  "qtPilot.powershellPath": "powershell.exe"
}
```

### c_cpp_properties.json 自动生成

根据项目和环境自动生成：

```json
{
  "configurations": [{
    "name": "Qt Pilot",
    "includePath": [
      "${workspaceFolder}/${projectDir}/src",
      // ... 扫描项目源码目录
      "${qtPath}/include",
      "${qtPath}/include/QtCore",
      // ... 根据 .pro 分析 Qt 模块
    ],
    "defines": [
      "_DEBUG",
      "UNICODE",
      "QT_CORE_LIB",
      // ... 根据 .pro 分析宏定义
    ],
    "compilerPath": "${vsPath}/VC/Tools/MSVC/*/bin/Hostx64/${arch}/cl.exe",
    "cStandard": "c17",
    "cppStandard": "c++17",
    "intelliSenseMode": "windows-msvc-${arch}"
  }],
  "version": 4
}
```

## 构建进度解析

### jom/nmake 输出解析

解析编译输出，提取：
- 当前编译文件：`cl /c ... mainwindow.cpp` → `mainwindow.cpp`
- 进度计算：已编译文件数 / 总文件数

### 实现方式

```typescript
// buildProgress.ts
interface BuildProgress {
    currentFile: string;
    percentage: number;
    total: number;
    completed: number;
}

function parseBuildOutput(output: string): BuildProgress | null {
    // 匹配 cl /c 编译命令
    // 计算进度
}
```

### 状态栏更新

```typescript
// statusBar.ts
export function setBuildProgress(progress: BuildProgress | null) {
    if (progress) {
        runItem.text = `$(loading~spin) ${progress.currentFile}`;
        runItem.tooltip = `编译进度: ${progress.percentage}%`;
    } else {
        runItem.text = '$(play) Run';
    }
}
```

## 调试支持

### F5 调试

点击 `🐛Debug` 按钮或按 F5：

1. 检查当前模式（Debug/Release）
2. 执行构建（如果需要）
3. 启动 cppvsdbg 调试器

### 调试配置

```typescript
// debugger.ts
export async function startDebug() {
    const config = {
        name: 'Qt Pilot Debug',
        type: 'cppvsdbg',
        request: 'launch',
        program: `${workspaceFolder}/${projectDir}/${mode}/${arch}/${exeName}.exe`,
        cwd: `${workspaceFolder}/${projectDir}/${mode}/${arch}`,
        stopAtEntry: false,
        console: 'integratedTerminal'
    };
    await vscode.debug.startDebugging(undefined, config);
}
```

## .pro 文件解析

### 解析内容

| 字段 | 用途 |
|------|------|
| TARGET | 可执行文件名 |
| QT | Qt 模块列表（用于 include 路径） |
| DEFINES | 宏定义 |
| SOURCES | 源文件列表 |
| HEADERS | 头文件列表 |
| INCLUDEPATH | 包含路径 |
| win32{} / release{} | 条件配置 |

### 解析实现

```typescript
// projectManager.ts
interface ProInfo {
    target: string;
    qtModules: string[];
    defines: string[];
    sourceDirs: string[];
    includeDirs: string[];
}

export function parseProFile(proPath: string): ProInfo {
    const content = fs.readFileSync(proPath, 'utf-8');
    // 正则匹配各字段
    // 处理条件块 win32{} / release{}
}
```

## 操作菜单

### 菜单项

| 操作 | 功能 | 命令 |
|------|------|------|
| QMake | 生成 Makefile | `qmake xxx.pro -spec win32-msvc` |
| Build | 编译项目 | `jom` |
| Clean | 清理构建 | `jom clean` |

### 执行方式

通过 `vscode.tasks` 执行 Shell 任务，使用 PowerShell 调用 VS DevShell。

## 文件监听（已有功能）

保持现有功能：
- 监听 .cpp/.h/.ui 新建，提示添加到 .pri
- 监听 .cpp/.h/.ui 删除，提示从 .pri 移除
- 监听 .pro/.pri 修改，提示重新 QMake

## 错误处理

### 问题匹配器

使用 `$msCompile` 匹配 MSVC 编译错误：
- 解析错误文件路径
- 解析错误行号
- 显示在 Problems 面板
- 点击跳转到源码

## 实现优先级

| 优先级 | 功能 | 复杂度 |
|--------|------|--------|
| P0 | 状态栏重构 | 中 |
| P0 | 项目自动发现 | 低 |
| P1 | 环境自动检测 | 中 |
| P1 | 配置面板重构 | 中 |
| P2 | 构建进度解析 | 中 |
| P2 | 调试支持 | 低 |
| P3 | c_cpp_properties 生成 | 高 |

## 测试要点

1. **激活流程**：空工作区、单个 .pro、多个 .pro
2. **环境检测**：VS 2019/2022、Qt 5/6、有无 jom
3. **状态栏**：模式切换、运行/停止、调试启动
4. **构建**：Debug/Release、x86/x64 组合
5. **配置持久化**：重启后恢复配置

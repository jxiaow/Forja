# 配置数据结构重新设计

## 现状（3 个文件）

```
.compilot/settings.json      — Qt 专属 + 共享字段混在一起（17 字段）
.compilot/sdk-settings.json  — SDK 专属 + 重复的 mode/arch（4 字段）
.compilot/sync-config.json   — 同步配置（3 字段）
```

问题：
- mode/arch 两个文件各存一份，可能不一致
- vsDevShellPath 和 vsDevCmdPath 指向同一个 VS 安装的不同入口，分开存
- 用户感知是"三套配置"

---

## 新设计（1 个文件）

```jsonc
// .compilot/settings.json
{
  // ── Qt 模块 ──
  "qt": {
    "mode": "debug",
    "arch": "x86",
    "vsInstall": "C:\\Program Files\\Microsoft Visual Studio\\18\\Community",
    "qtPath": "C:\\QtCompile\\msvc2019-accessible",
    "jomPath": "C:\\Qt\\Tools\\QtCreator\\bin\\jom\\jom.exe",
    "pinnedProject": null,
    "target": "",
    "cStandard": "c11",
    "cppStandard": "c++11",
    "designerPath": "",
    "qtSourcePath": "",
    "manualProPath": "",
    "rccProjectPath": "",
    "scanExcludeDirs": [],
    "customCommands": [],
    "fileSyncPromptEnabled": true,
    "qmakeReminderEnabled": true
  },

  // ── SDK 模块 ──
  "sdk": {
    "mode": "debug",
    "arch": "x86",
    "vsInstall": "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community",
    "pinnedProject": null,
    "scanDepth": 3
  },

  // ── 远程同步 ──
  "sync": {
    "enabled": false,
    "selectedServer": "",
    "remotePath": "",
    "ignore": [".git", "node_modules", "out", ".compilot", "build", "debug", "release"]
  }
}
```

---

## 设计决策

### 1. vsInstall 替代 vsDevShellPath / vsDevCmdPath

用户只需要配一个 VS 安装路径，两个入口脚本自动推导：
- `Launch-VsDevShell.ps1` = `{vsInstall}/Common7/Tools/Launch-VsDevShell.ps1`
- `VsDevCmd.bat` = `{vsInstall}/Common7/Tools/VsDevCmd.bat`

VS 2017+ 标准安装结构下这两个脚本始终存在于 `Common7/Tools/`。

### 2. mode/arch 各自独立

Qt 和 SDK 可能用不同的构建模式和架构（比如 Qt 用 debug x86，SDK 用 release x64），所以不共享。

### 3. toolchain 各自独立

Qt 和 SDK 可能用不同版本的 VS（比如 Qt 用 VS 18 编译，SDK 用 VS 2022），所以 vsInstall 放在各自模块下。

### 4. 一个文件，按模块分组

- `qt` — Qt 模块的所有配置
- `sdk` — SDK 模块的所有配置
- `sync` — 远程同步配置

结构清晰，不需要记"这个配置在哪个文件里"。

### 5. 向后兼容

首次加载时检测旧格式（3 个文件平铺字段），自动迁移到新结构：
- 读旧 `settings.json` 平铺字段 → 写入 `qt.*`
- 读旧 `sdk-settings.json` → 写入 `sdk.*`
- 读旧 `sync-config.json` → 写入 `sync.*`
- 旧文件重命名为 `*.migrated`

---

## 字段映射（旧 → 新）

| 旧文件 | 旧字段 | 新位置 |
|--------|--------|--------|
| settings.json | mode | qt.mode |
| settings.json | arch | qt.arch |
| settings.json | vsDevShellPath | qt.vsInstall（从路径推导安装根） |
| settings.json | qtPath | qt.qtPath |
| settings.json | jomPath | qt.jomPath |
| settings.json | designerPath | qt.designerPath |
| settings.json | qtSourcePath | qt.qtSourcePath |
| settings.json | pinnedProject | qt.pinnedProject |
| settings.json | target | qt.target |
| settings.json | cStandard | qt.cStandard |
| settings.json | cppStandard | qt.cppStandard |
| settings.json | manualProPath | qt.manualProPath |
| settings.json | rccProjectPath | qt.rccProjectPath |
| settings.json | scanExcludeDirs | qt.scanExcludeDirs |
| settings.json | customCommands | qt.customCommands |
| settings.json | fileSyncPromptEnabled | qt.fileSyncPromptEnabled |
| settings.json | qmakeReminderEnabled | qt.qmakeReminderEnabled |
| sdk-settings.json | mode | sdk.mode |
| sdk-settings.json | arch | sdk.arch |
| sdk-settings.json | vsDevCmdPath | sdk.vsInstall（从路径推导安装根） |
| sdk-settings.json | pinnedProject | sdk.pinnedProject |
| sdk-settings.json | scanDepth | sdk.scanDepth |
| sync-config.json | enabled | sync.enabled |
| sync-config.json | selectedServer | sync.selectedServer |
| sync-config.json | remotePath | sync.remotePath |
| sync-config.json | ignore | sync.ignore |

---

## CLI 兼容

CLI 读同一个文件，按路径取值：
```typescript
const settings = loadSettings(workspace);
const mode = settings.qt.mode;
const qtPath = settings.qt.qtPath;
const sdkProject = settings.sdk.pinnedProject;
```

---

_创建时间: 2025-05-19_

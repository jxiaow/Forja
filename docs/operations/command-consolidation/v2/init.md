# `forja init`

[← 返回总览](index.md)

**职责**：注册 workroot 并配置初始 target。用户通过 `forja init` 明确告诉系统工作根目录，所有后续命令从 cwd 向上查找已注册的 workroot 来解析配置。

**语法**：
```
forja init [--workroot <path>] [--json]
forja init --answers <file> --json
```

**前置条件**：无。`forja init` 是唯一不要求 workroot 已注册的命令。

## 行为

### 新 workroot（未注册）

1. 解析 workroot（`--workroot` flag 或 cwd）
2. **先注册 workroot** 到 `~/.forja/workspaces.json`（确保即使后续步骤失败，workroot 也已注册）
3. 扫描 workroot 下的项目文件（`.pro` / `.sln` / `Makefile` / `CMakeLists.txt`）
4. 检测工具链环境（Qt / VS / jom / make）
5. 交互流程：
   - 选择目标项目
   - 配置工具链（Qt 路径、VS 路径）
   - 选择 mode（debug/release）和 arch（x86/x64）
6. 生成 target profile，写入 `~/.forja/workspaces/<hash>.json`
7. 输出摘要 + `nextAction: forja status`

### 已注册 workroot

1. 显示当前已保存的 targets 列表
2. 提供选项：
   - **添加新 target** → 走完整配置流程
   - **修改现有 target** → 选择已有 target → 重新检测工具链 + mode/arch
   - **退出**

### 三种模式

| 模式 | 触发条件 | 行为 |
|------|----------|------|
| 交互模式 | 无 `--json`、无 `--answers` | 逐步 prompt 用户选择 |
| JSON 模式 | `--json` 且无 `--answers` | 返回 `questions` 数组，等待 AI 填写 |
| Answers 模式 | `--answers <file>` | 从 JSON 文件读取预配置答案 |

## Result

```ts
interface InitResult extends ForjaJsonResult {
    action: 'init';
    workroot?: string;
    registered?: boolean;     // true 表示本次新注册
    target?: TargetProfile;   // 配置完成的 target
}
```

## Target Profile

```ts
interface TargetProfile {
    id: string;               // 如 "qt-app-debug-x64"
    name: string;             // 如 "app debug x64"
    kind: 'qt' | 'sdk';
    project: string;          // workroot 相对路径
    mode: 'debug' | 'release';
    arch: 'x86' | 'x64';
    runAt: 'local' | 'remote';
    toolchain: {
        qtPath?: string;
        qtVersion?: string;
        vsInstall?: string;
        jomPath?: string;
    };
}
```

## Target ID 生成规则

格式：`{kind}-{projectBasename}-{mode}-{arch}`

示例：`qt-app-debug-x64`、`sdk-corelib-release-x86`

冲突时追加短 hash：`qt-app-debug-x64-a3f2b1`

## 存储结构

```
~/.forja/
  workspaces.json            ← workroot 注册表（路径列表）
  workspaces/
    <hash>.json              ← per-workspace 配置（targets + modulePrefs）
```

## 场景示例

**新 workroot 交互模式**：
```
$ forja init
Initializing new workspace
  Work root: C:\Code\myapp
Found projects: 3
? Select a project:
  1. app (app/app.pro)
  2. utils (utils/Makefile)
  3. corelib (sdk/corelib.sln)
> 1
  ✓ app (app/app.pro)
? Select Qt:
  1. 6.5.3 — C:/Qt/6.5.3/msvc2019_64
  2. 5.15.2 — C:/Qt/5.15.2/msvc2019
> 1
? Select mode:
  1. debug
  2. release
> 1
```

**已注册 workroot**：
```
$ forja init
Work root is already registered
  Work root: C:\Code\myapp
  Existing targets:
    * qt-app-debug-x64 [qt] app/app.pro
      sdk-lib-release-x86 [sdk] sdk/lib.sln
? Action:
  1. Add a new target
  2. Modify an existing target
  3. Exit
> 1
```

**JSON 模式（AI 调用）**：
```json
{
    "ok": false,
    "action": "init",
    "workroot": "C:\\Code\\myapp",
    "questions": [
        { "id": "project", "label": "Select a project", "choices": ["app/app.pro", "utils/Makefile"] },
        { "id": "mode", "label": "Select mode", "choices": ["debug", "release"] },
        { "id": "arch", "label": "Select arch", "choices": ["x86", "x64"] }
    ],
    "nextAction": "forja init --answers <answers.json>"
}
```

**成功结果**：
```json
{
    "ok": true,
    "action": "init",
    "workroot": "C:\\Code\\myapp",
    "registered": true,
    "target": {
        "id": "qt-app-debug-x64",
        "name": "app debug x64",
        "kind": "qt",
        "project": "app/app.pro",
        "mode": "debug",
        "arch": "x64",
        "runAt": "local",
        "toolchain": {
            "qtPath": "C:/Qt/6.5.3/msvc2019_64",
            "qtVersion": "6.5.3",
            "vsInstall": "C:/Program Files/Microsoft VS/2019/Professional"
        }
    },
    "nextAction": "forja status"
}
```

**workroot 不存在**：
```json
{
    "ok": false,
    "action": "init",
    "diagnostics": [
        { "level": "error", "message": "Work root not found: /nonexistent" }
    ]
}
```

## 与其他命令的关系

| 命令 | 关系 |
|------|------|
| `forja status` | init 后的推荐下一步 |
| `forja use target` | 切换/添加 target（要求 workroot 已注册） |
| `forja list targets` | 查看已保存和发现的 targets |
| `forja build` | 构建（要求 workroot 已注册且有 active target） |

## 验证点

- `forja init` 在空目录注册 workroot 并配置初始 target
- `forja init` 在已注册 workroot 显示现有 targets 并提供添加/修改选项
- `forja init --json` 返回 questions 供 AI 填写
- `forja init --answers <file>` 从文件读取答案完成配置
- workroot 注册在 config 保存之前（防止崩溃导致孤立配置）
- `forja init` 从子目录运行时正确解析到父目录的 workroot

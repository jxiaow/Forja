# Forja CLI 命令参考 v2

> 12 个意图驱动的顶层命令，基于 workroot 模型管理多 target 配置。

**命令规格（各文件）**：
[init](init.md) · [status](status.md) · [list](list.md) · [use](use.md) · [remote](remote.md) · [server](server.md) · [build](build.md) · [run](run.md) · [stop](stop.md) · [clean](clean.md) · [doctor](doctor.md) · [sync](sync.md)

---

## 1. 命令总览

```
forja init        — 注册 workroot 并配置初始 target
forja status      — 查看就绪状态和下一步建议
forja list        — 列举 targets 和工具链环境
forja use         — 切换 target、mode/arch、工具链、执行位置
forja remote      — 远程配置和仓库操作
forja server      — 管理共享 SSH server
forja build       — 构建当前 target
forja run         — 运行当前 target
forja stop        — 停止运行中的进程
forja clean       — 清理构建产物
forja doctor      — 深度诊断和恢复
forja sync        — 同步变更文件到远程
```

---

## 2. 核心概念

### 2.1 Workroot

用户通过 `forja init` 显式注册 workroot（工作根目录）。所有后续命令从 cwd 向上查找已注册的 workroot 来解析配置。

```
~/.forja/
  workspaces.json            ← workroot 注册表（路径列表）
  workspaces/
    <hash>.json              ← per-workspace 配置（targets + modulePrefs）
  servers.json               ← 全局服务器列表
  config.json                ← 全局配置（lang）
```

**解析规则**：
- 从 cwd 向上逐级查找已注册 workroot，取最深匹配
- 未找到 → 报错，提示 `forja init`
- `forja init` 和 `forja use target`（无 workroot 时）例外：可交互确认注册

### 2.2 Target Profile

每个 workroot 可保存多个 target profiles，其中一个为 active。

```ts
interface TargetProfile {
    id: string;               // 如 "qt-app-debug-x64"
    name: string;
    kind: 'qt' | 'cpp';
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

**快速切换**：`forja use target --project <name|id>` 按 ID/名字匹配已保存 target，直接更新 activeTarget 指针，跳过工具链重新检测。

### 2.3 ActiveTarget

```ts
interface ActiveTarget {
    kind: 'qt' | 'cpp';
    project: string;
    mode: 'debug' | 'release';
    arch: 'x86' | 'x64';
    runAt: 'local' | 'remote';
    qtPath?: string;
    vsInstall?: string;
    jomPath?: string;
    qmakeTarget?: string;
    qtVersion?: string;
}
```

从 workspaceStore 的 active target profile 转换而来。所有执行类命令（build/run/stop/clean）围绕 active target 工作。

### 2.4 Diagnostic

```ts
interface Diagnostic {
    level: 'info' | 'warning' | 'error';
    message: string;
    hint?: string;
    fix?: string;
    params?: Record<string, string>;
}
```

### 2.5 JSON Envelope

```ts
interface ForjaJsonResult {
    ok: boolean;
    action: string;
    workspace?: string;
    activeTarget?: ActiveTarget;
    diagnostics?: Diagnostic[];
    nextAction?: string;
}
```

### 2.6 Readiness

```ts
type ReadinessState = 'ready' | 'configured' | 'blocked' | 'missing' | 'unknown' | 'not-selected';

interface Readiness {
    target?: ReadinessState;
    toolchain?: ReadinessState;
    sync?: ReadinessState;
    remote?: ReadinessState;
    runtime?: ReadinessState;
}
```

---

## 3. 命令边界

| 问题 | 命令 | 理由 |
|------|------|------|
| "有哪些项目？" | `forja list targets` | 文件扫描 + 已保存 targets |
| "有哪些服务器？" | `forja server` | 读配置，纯枚举 |
| "Qt/VS/jom 路径在哪？" | `forja list env` | 路径枚举 |
| "Qt/VS/jom 能用吗？" | `forja doctor` | 健康验证 |
| "当前状态如何？" | `forja status` | readiness 摘要 |
| "怎么初始化？" | `forja init` | 注册 workroot + 配置 target |
| "怎么切换 target？" | `forja use target` | 按名字/ID 快速切换 |

---

## 4. 通用参数

| 参数 | 适用命令 | 含义 |
|------|----------|------|
| `--json` | 所有命令 | 输出结构化 JSON |
| `--workspace <path>` | 所有命令 | 操作根目录（默认 cwd） |
| `--lang <locale>` | 所有命令 | 语言：zh 或 en |
| `--plan` | build/clean/doctor | 仅显示计划，不执行 |
| `--help` | 所有命令 | 显示帮助 |

---

## 5. 典型工作流

### 首次使用

```bash
forja init                                    # 注册 workroot + 配置 target
forja status                                  # 检查就绪状态
forja build                                   # 构建
forja run                                     # 运行
```

### 多 target 切换

```bash
forja list targets                            # 查看所有 targets
forja use target --project qt-app             # 按名字快速切换
forja build
forja use target --project sdk-lib            # 切换到另一个
forja build
```

### 远程构建

```bash
forja server add --name dev --host 192.168.1.10 --username dev
forja remote set --server dev --remote-path /home/dev/workspace
forja use execution --remote
forja sync                                    # 同步文件
forja build                                   # 远程构建
```

---

## 6. 配置优先级

```
CLI 参数 > workspaceStore 配置 > 环境变量 > 自动检测 > 默认值
```

## 7. 支持平台

- Windows (MSVC + jom / MSBuild)
- Linux (GCC + make)

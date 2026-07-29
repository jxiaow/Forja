# `forja list`

[← 返回总览](index.md)

**职责**：只读枚举。列出已保存的 targets、发现的项目候选、工具链环境。不修改配置。

**语法**：
```
forja list targets [--json]
forja list env [--json]
forja list env <qt|vs|jom|make> [--json]
```

**前置条件**：无。workroot 未注册时仍扫描文件系统显示发现的候选，但 saved targets 为空。

## 子命令

### `list targets`

显示两类信息：
1. **Saved targets**（已保存）— 来自 workspaceStore 的 target profiles，标记 `*` 表示 active
2. **Discovered**（已发现，未保存）— 文件系统扫描到的项目文件

```
Targets:
  Saved targets:
  * qt-app-debug-x64    app debug x64    [qt] debug|x64
    sdk-lib-release-x86  SDK Lib Release  [sdk] release|x86

  Discovered (not saved):
    utils/Makefile — utils/Makefile
```

**快速切换**：saved targets 可通过 `forja use target --project <name|id>` 按名字或 ID 前缀快速切换。

### `list env`

列出检测到的工具链环境。

```
Environment:
  Qt:   C:/Qt/6.5.3/msvc2019_64 (6.5.3)
  VS:   C:/Program Files/Microsoft VS/2019/Professional (2019)
  jom:  C:/Qt/Tools/jom/jom.exe
```

可指定子分类：`list env qt`、`list env vs`、`list env jom`、`list env make`。

## Result

```ts
interface ListResult extends ForjaJsonResult {
    action: 'list';
    category: 'targets' | 'env';
    targets?: TargetCandidate[];
    savedTargets?: SavedTargetInfo[];
    env?: EnvSummary;
    envSubCategory?: 'qt' | 'vs' | 'jom' | 'make';
}

interface SavedTargetInfo {
    id: string;
    name: string;
    kind: 'qt' | 'cpp';
    project: string;
    mode: string;
    arch: string;
    active: boolean;
}
```

## nextAction

| 条件 | nextAction |
|------|-----------|
| 无 saved targets | `forja init` |
| 有 saved targets | `forja use target --project <name\|path>` |

## 与其他命令的关系

| 命令 | 关系 |
|------|------|
| `forja init` | 无 saved targets 时的 nextAction |
| `forja use target` | 切换 target |
| `forja status` | 查看就绪状态（list 回答"有什么"，status 回答"能不能用"） |
| `forja doctor` | 深度验证（list 只枚举，doctor 验证可用性） |

## 验证点

- `forja list targets --json` 返回 savedTargets 和 targets 两个数组
- saved targets 中 active target 标记 `active: true`
- `forja list env --json` 返回检测到的工具链路径
- workroot 未注册时 savedTargets 为空，targets 仍显示扫描结果

# `forja build`

[← 返回总览](index.md)

**职责**：编译当前 active target。支持 Qt（qmake → make/jom）和 SDK（MSBuild/CMake）两种项目类型，支持本地和远程执行。

**语法**：
```
forja build [fresh|qmake|rcc] [--plan] [--project <path>] [--json]
```

**前置条件**：workroot 已注册且有 active target。未注册时建议 `forja init`，无 target 时建议 `forja use target`。

## 子动作

| 动作 | 说明 | 适用 |
|------|------|------|
| `build`（默认） | 编译项目 | Qt + SDK |
| `build fresh` | 清理后重新编译 | Qt + SDK |
| `build qmake` | 仅运行 qmake | Qt only |
| `build rcc` | 编译 .qrc 资源文件 | Qt only |

## 行为

### Qt 本地构建流程

1. 检查 Makefile 是否存在且匹配当前 mode/arch
2. 不匹配 → 自动执行 qmake 再构建
3. 构建前终止运行中的同名进程（防止 LNK1104）
4. 组装命令链：VS DevShell → jom/make
5. 执行并提取编译错误

### SDK 本地构建流程

1. Windows: 使用 MSBuild（通过 VS DevCmd）
2. Linux: 使用 make
3. 构建前终止运行中的进程

### 远程构建

1. 通过 `executeRemotePlan` 上传变更文件
2. 在远端执行 `forja build --project <path> --json`
3. `--project` 参数让远端直接构造 target，不依赖远端 active target

### `--project` 快速路径

提供 `--project` 时，从 saved target 复制工具链字段（qtPath/vsInstall/jomPath/qmakeTarget）和 runAt，不依赖 active target。用于远程 bridge 调用。

## Result

```ts
interface BuildResult extends ForjaJsonResult {
    action: 'build';
    buildAction: 'default' | 'fresh' | 'qmake' | 'rcc';
    durationMs?: number;
    exitCode?: number;
    errors?: string[];
    logFile?: string;
    plan?: CommandPlan;
}
```

## nextAction 规则

| 条件 | nextAction |
|------|-----------|
| 有编译错误 | `undefined`（用户改代码） |
| 无错误但构建失败 | `forja doctor` |
| 成功 | `forja run` |

**绝不建议** `forja clean` 或 `forja build` 作为失败时的 nextAction（可能死循环）。

## 与其他命令的关系

| 命令 | 关系 |
|------|------|
| `forja status` | 构建前检查就绪状态 |
| `forja run` | 构建成功后的下一步 |
| `forja clean` | 清理构建产物 |
| `forja doctor` | 构建失败（无编译错误）时的诊断 |

## 验证点

- `forja build --json` 按 active target 路由到 Qt 或 SDK 构建
- `forja build qmake --json` 对 SDK 报错
- `forja build fresh --json` 先 clean 再构建
- `forja build --plan --json` 不执行，只输出命令计划
- `--project` 路径从 saved target 复制工具链字段
- 构建失败有编译错误时 nextAction 为 undefined

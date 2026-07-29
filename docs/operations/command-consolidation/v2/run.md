# `forja run`

[← 返回总览](index.md)

**职责**：编译并运行当前 active target。先终止已运行的进程，再构建，最后启动。支持前台/后台运行、Qt Designer、自定义命令。

**语法**：
```
forja run [--detach] [--plan] [--json]
forja run designer <ui-file>
forja run custom <name>
```

**前置条件**：workroot 已注册且有 active target。SDK target 不支持 `run`（只能 build）。

## 行为

### 默认运行（Qt target）

1. 终止已运行的同名进程（PID 级别，非进程名）
2. 构建项目（同 `forja build`）
3. 启动可执行文件
4. `--detach`：后台运行，返回 PID 和 logFile
5. 前台运行：等待进程退出

### SDK target

返回错误：SDK 项目不支持 `run`，建议 `forja build` 后手动运行。

### `run designer <ui-file>`

打开 Qt Designer 编辑 .ui 文件。从 workspaceStore 读取 designerPath 和 qtPath。

### `run custom <name>`

运行预定义的自定义命令。从 workspaceStore 的 `qtModulePrefs.customCommands` 读取。

## Result

```ts
interface RunResult extends ForjaJsonResult {
    action: 'run';
    runAction: 'default' | 'detach' | 'designer' | 'custom';
    pid?: number;
    executablePath?: string;
    logFile?: string;
    plan?: CommandPlan;
}
```

## 与其他命令的关系

| 命令 | 关系 |
|------|------|
| `forja build` | run 包含 build 步骤 |
| `forja stop` | 停止运行中的进程 |
| `forja status` | 显示运行时状态（PID、logFile） |

## 验证点

- `forja run --json` 构建成功后启动进程
- `forja run --detach --json` 返回 pid 和 logFile
- SDK target 返回错误
- `forja run designer <file>` 从 workspaceStore 读取 designerPath
- `forja run custom <name>` 从 workspaceStore 读取 customCommands

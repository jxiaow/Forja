# `forja use`

[← 返回总览](index.md)

**职责**：写入配置。切换 target、修改 mode/arch、更新工具链、切换执行位置、管理语言设置。

**语法**：
```
forja use target [--project <name|path>] [--mode <debug|release>] [--arch <x86|x64>]
forja use target [--qt <path>] [--vs <path>] [--jom <path>] [--qmake-target <name>]
forja use target [--reset]
forja use target suppress-warnings [<codes>] [--add <code>] [--rm <code>]
forja use execution --local | --remote
forja use lang <zh|en>
forja use                              # 无参数：显示当前配置或弹出交互式选择器
```

**前置条件**：workroot 必须已注册（`forja init`）。未注册时建议 `forja init`。

## 子命令

### `use target`

切换或配置 target。三种路径：

| 条件 | 行为 |
|------|------|
| `--project <name\|path>` | 切换 target。支持按 ID、ID 前缀、名字子串匹配已保存 targets |
| `--mode`/`--arch` | 更新当前 active target 的 mode/arch |
| `--qt`/`--vs`/`--jom` | 更新当前 active target 的工具链路径 |
| `--qmake-target` | 更新当前 active target 的 qmake TARGET |
| `--reset` | 忽略已有配置，强制重新检测 |
| 无 flag | 弹出交互式选择器（有 saved targets 时）或走完整配置流程 |

**快速切换**：按 ID 或名字匹配已保存 target 时，直接更新 activeTarget 指针，跳过工具链重新检测。

```bash
forja use target --project qt-app        # ID 前缀匹配
forja use target --project MyApp         # 名字匹配
forja use target --project app/app.pro   # 完整路径匹配
```

### `use target suppress-warnings`

管理当前 target 的构建警告抑制码。

```bash
forja use target suppress-warnings              # 查看当前抑制列表
forja use target suppress-warnings C4819,C5297  # 覆盖设置
forja use target suppress-warnings --add C4819  # 追加
forja use target suppress-warnings --rm C4819   # 删除
```

### `use execution`

切换本地/远程执行。

```bash
forja use execution --local
forja use execution --remote
```

更新 active target 的 `runAt` 字段。

### `use lang`

设置 CLI 语言。

```bash
forja use lang zh
forja use lang en
```

存储在全局配置 `~/.forja/config.json`。

### `use`（无子命令）

- 有 saved targets 且交互模式 → 弹出 QuickPick 选择器
- 无 saved targets 或选择"添加新目标" → 走完整配置流程
- `--json` 模式 → 显示当前配置摘要

## Result

```ts
interface UseResult extends ForjaJsonResult {
    action: 'use';
    useScope: 'target' | 'execution' | 'lang' | 'show';
    changed: string[];
}
```

## Flag Scope 验证

每个子命令路径只接受自己的 flag：

| 路径 | 接受的 flags |
|------|-------------|
| `use target` | `--project`, `--mode`, `--arch`, `--qt`, `--vs`, `--jom`, `--qmake-target`, `--reset` |
| `use target suppress-warnings` | `--add`, `--rm` |
| `use execution` | `--local`, `--remote` |
| `use lang` | 无 flags |
| `use`（show） | 无 flags |

不属于当前路径的 flags 会报 "Unknown flag(s)" 错误。

## 与其他命令的关系

| 命令 | 关系 |
|------|------|
| `forja init` | workroot 未注册时的 nextAction |
| `forja list targets` | 查看可用 targets |
| `forja status` | 查看就绪状态 |
| `forja build` | 配置完成后的下一步 |

## 验证点

- `forja use target --project <id>` 快速切换已保存 target（跳过工具链检测）
- `forja use target --project <name>` 按名字子串匹配
- `forja use target` 无 flag 时弹出交互式选择器
- `forja use target --local` 在 `use target` 路径下报 unknown flag
- `forja use execution --local` 更新 runAt 字段
- `forja use lang zh` 持久化到全局配置

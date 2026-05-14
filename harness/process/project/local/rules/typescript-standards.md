# TypeScript Standards

## Goal

统一 TypeScript 代码基本风格，降低实现阶段的随机性。

## Naming Conventions

| 类型           | 规范                | 示例                                    |
| -------------- | ------------------- | --------------------------------------- |
| 文件名         | camelCase.ts        | `buildManager.ts`, `configPanel.ts`     |
| 类             | PascalCase          | `ConfigPanel`, `SyncWatcher`            |
| 函数           | camelCase           | `createStatusBar`, `toggleMode`         |
| 私有方法       | 下划线前缀          | `_loadConfig`, `_saveConfig`            |
| 模块级常量     | camelCase           | `actionDefs`, `defaultConfig`           |
| 静态只读属性   | PascalCase          | `ConfigPanel.viewId`                    |
| 类型别名       | PascalCase          | `BuildMode`, `CommandPlan`              |
| 接口           | PascalCase（无 I）  | `PlatformConfig`, `BuildConfig`         |
| 枚举           | PascalCase          | `BuildAction`                           |

## Import Style

```typescript
// 命名空间导入：多导出的模块
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// 具名导入：特定函数或类型
import { createStatusBar, setBuilding, toggleMode } from './statusBar';
import { registerPriWatcher } from './priWatcher';
import type { BuildMode, BuildConfig } from './types';
```

## Type Annotations

- TypeScript strict mode 已启用
- 导出函数必须有显式返回类型
- 函数参数必须有类型注解
- 优先 `string | null` 而非 `string | undefined`（可选返回值）
- 使用 type alias 表达联合类型

```typescript
// Good
export function getMode(): BuildMode { return _mode; }
function findPriOrPro(dir: string, root: string): string | null { ... }
export type BuildMode = 'debug' | 'release';

// Bad
export function getMode() { return _mode; }  // 缺少返回类型
function findPriOrPro(dir, root) { ... }     // 缺少参数类型
```

## Formatting

- 缩进：4 空格
- 引号：单引号（字符串），双引号（JSON/HTML 模板）
- 分号：必须
- 尾逗号：不使用

## Error Handling

- 文件操作使用 try-catch + 静默回退
- 命令处理使用 async/await + .catch()
- 用户可见错误通过 `vscode.window.showErrorMessage()` 展示

```typescript
// 非关键操作：静默回退
function getExeName(proFilePath: string): string {
    try {
        const content = fs.readFileSync(proFilePath, 'utf8');
        // ... 解析逻辑
    } catch {}
    return 'app'; // 默认值
}

// 用户可见错误
const err = (e: Error) => vscode.window.showErrorMessage(e.message);
someAsyncOp().catch(err);
```

## Async Patterns

```typescript
// 优先 async/await
export async function runDebug(): Promise<void> {
    const execution = await vscode.tasks.executeTask(buildTask);
    return new Promise<void>((resolve, reject) => {
        const disposable = vscode.tasks.onDidEndTaskProcess(e => {
            if (e.execution === execution) {
                disposable.dispose();
                e.exitCode === 0 ? resolve() : reject(new Error('Build failed'));
            }
        });
    });
}
```

## Chinese Language

- 用户可见字符串使用中文（命令标题、消息、tooltip）
- 代码中的技术术语保持英文
- 注释可以使用中文

## Design Checklist

- 新类型是否有明确的类型别名或接口定义
- 导出函数是否有返回类型
- 错误处理是否区分了用户可见和静默回退

## Implementation Checklist

- 是否遵循 4 空格缩进
- 是否使用单引号
- 是否有分号
- import 是否按命名空间/具名分组
- 新增导出是否有显式类型

## Common Smells

- 导出函数缺少返回类型注解
- 混用 namespace import 和 default import
- 错误被吞掉但没有默认回退值
- 中英文混用不一致（用户可见字符串用了英文）
- 使用 `any` 而不是具体类型或 `unknown`
